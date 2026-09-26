import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  newId,
  type AgentKind,
  type ChangePlan,
  type ConflictResolution,
  type DecypherSession,
  type RepoIndex,
} from '@decypher/core';
import { createAdapter, type AgentAdapter, type PlannedWrites } from '@decypher/agent';
import { ProtectionManager } from '@decypher/protect';
import { SnapshotManager, indexRepo } from '@decypher/snapshot';
import { DiffEngine, type FileMap } from '@decypher/diff';
import { PreviewManager, type PreviewPorts, type PreviewResult } from './preview';

/** Server-side state per session: the live managers + full before/after file maps. */
interface LiveSession {
  session: DecypherSession;
  snapshot: SnapshotManager;
  protection: ProtectionManager;
  adapter: AgentAdapter;
  originalMap: FileMap;
  modifiedMap?: FileMap;
}

/** Raised for expected user-facing guard failures (returned as HTTP 409). */
export class OrchestratorError extends Error {}

/**
 * Decypher orchestrator: the thin control layer that runs
 *   index -> plan -> protect/resolve -> snapshot+apply -> compare
 * It owns nothing the agent owns; it only gates, sequences, and narrates.
 */
export class DecypherOrchestrator {
  private readonly sessions = new Map<string, LiveSession>();
  private readonly diff = new DiffEngine();
  private readonly preview: PreviewManager;

  constructor(
    private readonly workRoot: string,
    previewRoot: string,
    ports: PreviewPorts,
  ) {
    this.preview = new PreviewManager(previewRoot, ports);
  }

  /** POST /api/session — open a repo, index it, and pin the pristine snapshot. */
  createSession(repoRoot: string, agent: AgentKind): DecypherSession {
    const index: RepoIndex = indexRepo(repoRoot);
    if (index.filePaths.length === 0) {
      throw new OrchestratorError('Repository has no readable files to index.');
    }
    const id = newId('ses');
    const snapshot = SnapshotManager.fromRepo(repoRoot, join(this.workRoot, id));
    const session: DecypherSession = {
      id,
      repoRoot,
      request: '',
      agent,
      index,
      rules: [],
      stage: 'idle',
    };
    this.sessions.set(id, {
      session,
      snapshot,
      protection: new ProtectionManager(),
      adapter: createAdapter(agent),
      originalMap: snapshot.readFileMapAtCommit(snapshot.original().commit),
    });
    return session;
  }

  /** Stage 1 — ask the agent for a change plan, then immediately evaluate protections. */
  async plan(id: string, request: string): Promise<DecypherSession> {
    const live = this.require(id);
    live.session.request = request;
    const plan = await live.adapter.producePlan(request, live.session.index);
    live.session.plan = plan;
    this.reevaluate(live);
    return live.session;
  }

  /** Stage 2 — add a protection boundary and re-check the current plan against it. */
  addProtection(id: string, glob: string, label?: string): DecypherSession {
    const live = this.require(id);
    live.protection.add(glob, label);
    this.syncRules(live);
    if (live.session.plan) this.reevaluate(live);
    return live.session;
  }

  removeProtection(id: string, ruleId: string): DecypherSession {
    const live = this.require(id);
    live.protection.remove(ruleId);
    this.syncRules(live);
    if (live.session.plan) this.reevaluate(live);
    return live.session;
  }

  /** Lock or unlock an exact file path straight from the repo tree. */
  togglePathProtection(id: string, relPath: string): DecypherSession {
    const live = this.require(id);
    live.protection.togglePath(relPath);
    this.syncRules(live);
    if (live.session.plan) this.reevaluate(live);
    return live.session;
  }

  /** Resolve a protection conflict: allow-and-unlock, keep-and-replan, or cancel. */
  resolve(id: string, resolution: ConflictResolution): DecypherSession {
    const live = this.require(id);
    const plan = live.session.plan;
    const conflict = live.session.conflict;
    if (!plan || !conflict) throw new OrchestratorError('No plan or conflict to resolve.');

    if (resolution === 'cancel') {
      live.session.plan = undefined;
      live.session.conflict = undefined;
      live.session.stage = 'idle';
      return live.session;
    }

    if (resolution === 'allow') {
      // Unlock only the rules that actually blocked this plan, then re-check.
      for (const c of conflict.conflicts) live.protection.setLocked(c.rule.id, false);
      this.syncRules(live);
      this.reevaluate(live);
      return live.session;
    }

    // keep-and-replan: drop the protected files from the plan and continue.
    const permitted = live.protection.permittedFiles(plan);
    const replanned: ChangePlan = { ...plan, id: newId('plan'), files: permitted };
    live.session.plan = replanned;
    this.reevaluate(live);
    return live.session;
  }

  /** Stage 3 — snapshot original, apply within boundaries, then build the compare report. */
  async apply(id: string): Promise<DecypherSession> {
    const live = this.require(id);
    const plan = live.session.plan;
    if (!plan) throw new OrchestratorError('Nothing to apply: no approved plan.');
    const report = live.protection.evaluate(plan);
    if (!report.clear) {
      live.session.conflict = report;
      live.session.stage = 'blocked';
      throw new OrchestratorError('Plan still touches protected elements. Resolve the conflict first.');
    }

    const writes = await live.adapter.applyChange(plan, live.originalMap);
    this.writeChanges(live.snapshot.workspaceDir, writes);
    const afterRef = live.snapshot.captureModified();
    // Read the after-state from the commit (same source as the before-state) so EOL
    // normalization on the working tree can never create phantom diffs.
    const modifiedMap = live.snapshot.readFileMapAtCommit(afterRef.commit);
    live.modifiedMap = modifiedMap;

    live.session.diff = this.diff.build(live.originalMap, modifiedMap, {
      beforeRef: live.snapshot.original(),
      afterRef,
      planId: plan.id,
      plan: plan.files,
    });
    live.session.stage = 'applied';
    return live.session;
  }

  /** Revert the working tree to the pristine original and drop the diff. */
  revert(id: string): DecypherSession {
    const live = this.require(id);
    this.preview.stop(id);
    live.snapshot.revertToOriginal();
    live.modifiedMap = undefined;
    live.session.diff = undefined;
    live.session.stage = live.session.plan ? 'planned' : 'idle';
    return live.session;
  }

  /** Live before/after preview: boot two interactive servers for a session. */
  async startPreview(id: string): Promise<PreviewResult> {
    const live = this.require(id);
    if (!live.modifiedMap) {
      return { status: 'unavailable', reason: 'Apply a change before using live preview.' };
    }
    return this.preview.start(id, live.originalMap, live.modifiedMap);
  }

  stopPreview(id: string): void {
    this.preview.stop(id);
  }

  /** Shut down every live preview server (used on process exit). */
  stopAllPreviews(): void {
    this.preview.stopAll();
  }

  /** Fetch a single file's full content from the before or after snapshot. */
  fileContent(id: string, ref: 'before' | 'after', path: string): string {
    const live = this.require(id);
    const map = ref === 'before' ? live.originalMap : live.modifiedMap ?? {};
    if (!(path in map)) {
      throw new OrchestratorError(`No "${ref}" content for ${path}`);
    }
    return map[path];
  }

  get(id: string): DecypherSession {
    return this.require(id).session;
  }

  // ---- internal helpers -------------------------------------------------

  private require(id: string): LiveSession {
    const live = this.sessions.get(id);
    if (!live) throw new OrchestratorError(`Unknown session: ${id}`);
    return live;
  }

  private syncRules(live: LiveSession): void {
    live.session.rules = live.protection.list();
  }

  private reevaluate(live: LiveSession): void {
    const plan = live.session.plan;
    if (!plan) {
      live.session.stage = 'idle';
      return;
    }
    const report = live.protection.evaluate(plan);
    live.session.conflict = report;
    live.session.stage = report.clear ? 'planned' : 'blocked';
  }

  private writeChanges(workspaceDir: string, writes: PlannedWrites): void {
    for (const [relPath, content] of Object.entries(writes)) {
      if (containsPathEscape(relPath)) continue;
      const abs = join(workspaceDir, relPath);
      if (content === null) {
        rmSync(abs, { force: true });
        continue;
      }
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content, 'utf8');
    }
  }
}

/** Guard against a plan trying to write outside the workspace via ../ segments. */
function containsPathEscape(relPath: string): boolean {
  return relPath.split(/[\\/]/).some((seg) => seg === '..');
}
