import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  newId,
  type AgentKind,
  type ChangePlan,
  type ChatFileEntry,
  type ChatMessage,
  type ConflictResolution,
  type DecypherSession,
  type DiffReport,
  type FileDiff,
  type RepoIndex,
} from '@decypher/core';
import { createAdapter, type AgentAdapter, type ConversationTurn, type PlannedWrites } from '@decypher/agent';
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
      chatHistory: [],
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

  /** Free-form chat: ask a question about the codebase; no plan is produced. */
  async chat(id: string, message: string): Promise<{ reply: string; source: 'bob' | 'mock' }> {
    const live = this.require(id);
    const history = assistantHistory(live.session);
    const enriched = this.enrichQuestion(live, message);
    const { text: reply, source } = await live.adapter.chat(enriched, live.session.index, history);
    this.pushChat(live.session, 'assistant', reply, undefined, source);
    return { reply, source };
  }

  /**
   * Chat scoped to the change-control (compare) window. Answers about the applied
   * diff, citing exact line numbers so the user can jump straight to the code.
   */
  async compareChat(id: string, question: string, path?: string): Promise<{ reply: string; source: 'bob' | 'mock' }> {
    const live = this.require(id);
    const report = live.session.diff;
    if (!report) throw new OrchestratorError('No applied changes to discuss yet.');
    const history = assistantHistory(live.session);
    const context = this.buildDiffContext(report, path);
    const { text: reply, source } = await live.adapter.chat(`${question}\n\n${context}`, live.session.index, history);
    this.pushChat(live.session, 'assistant', reply, undefined, source);
    return { reply, source };
  }

  /** Stage 1 — ask the agent for a change plan, then immediately evaluate protections. */
  async plan(id: string, request: string): Promise<DecypherSession> {
    const live = this.require(id);
    live.session.request = request;
    const { plan, narrative } = await live.adapter.producePlan(request, live.session.index);
    live.session.plan = plan;
    // Plain-text narrative (kept for the context panel)
    this.pushChat(live.session, 'plan-narrative', narrative);
    // Structured plan card for the chat thread
    const planFiles: ChatFileEntry[] = plan.files.map((f) => ({
      path: f.path,
      action: f.action,
      purpose: f.purpose,
    }));
    this.pushChat(live.session, 'plan-card', narrative, planFiles);
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

    const diffReport = this.diff.build(live.originalMap, modifiedMap, {
      beforeRef: live.snapshot.original(),
      afterRef,
      planId: plan.id,
      plan: plan.files,
    });
    live.session.diff = diffReport;
    live.session.stage = 'applied';

    // Narrate the diff and append to the chat thread.
    const diffNarrative = await live.adapter.narrateDiff(diffReport.changedFiles);
    this.pushChat(live.session, 'diff-narrative', diffNarrative);
    // Structured diff card for the chat thread
    const diffFiles: ChatFileEntry[] = diffReport.changedFiles.map((f: FileDiff) => ({
      path: f.path,
      action: f.action,
      purpose: f.whyChanged,
      added: f.added,
      removed: f.removed,
    }));
    this.pushChat(live.session, 'diff-card', diffNarrative, diffFiles);

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

  private pushChat(
    session: DecypherSession,
    kind: ChatMessage['kind'],
    text: string,
    files?: ChatFileEntry[],
    source?: 'bob' | 'mock',
  ): void {
    session.chatHistory.push({ kind, text, timestamp: Date.now(), files, source });
  }

  private require(id: string): LiveSession {
    const live = this.sessions.get(id);
    if (!live) throw new OrchestratorError(`Unknown session: ${id}`);
    return live;
  }

  private syncRules(live: LiveSession): void {
    live.session.rules = live.protection.list();
  }

  /**
   * Attach the contents of any files the user's question names, so the agent can
   * actually explain them instead of guessing from a bare file list. Matches by full
   * path, base name, extension-less stem ("store" → src/store.js), or a top-level
   * folder ("web" → every file under web/).
   */
  private enrichQuestion(live: LiveSession, message: string): string {
    const lower = message.toLowerCase();
    const mentions = (name: string): boolean =>
      name.length >= 3 && new RegExp(`(^|[^a-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(lower);
    const isAbout = (p: string): boolean => {
      const base = (p.split('/').pop() ?? p).toLowerCase();
      const stem = base.replace(/\.[^.]+$/, '');
      const top = p.split('/')[0].toLowerCase();
      return (
        lower.includes(p.toLowerCase()) ||
        lower.includes(base) ||
        mentions(stem) ||
        (top !== base && mentions(top))
      );
    };
    const matched = Object.entries(live.originalMap).filter(([p]) => isAbout(p)).slice(0, 5);
    if (matched.length === 0) return message;
    const blocks = matched.map(([p, c]) => `--- ${p} ---\n${truncate(c, 3000)}`).join('\n\n');
    return `${message}\n\nHere are the relevant file contents for context:\n${blocks}`;
  }

  /** Build a line-numbered description of the applied diff for compare-window Q&A. */
  private buildDiffContext(report: DiffReport, path?: string): string {
    const files = path ? report.changedFiles.filter((f) => f.path === path) : report.changedFiles;
    const parts = files.map((f: FileDiff) => {
      const numbered = f.lines
        .filter((l) => l.kind !== 'context')
        .slice(0, 80)
        .map((l) => `line ${l.newLine ?? l.oldLine ?? '?'} [${l.kind}] ${l.text}`)
        .join('\n');
      return `File ${f.path} (${f.action}, +${f.added}/-${f.removed}) — ${f.whyChanged}\n${numbered || '  (no line-level changes)'}`;
    });
    return `The applied change, with line numbers:\n\n${parts.join('\n\n')}\n\nWhen you reference code, cite the exact file and line number shown above.`;
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

/** Assistant turns from the session history, for conversational context. */
function assistantHistory(session: DecypherSession): ConversationTurn[] {
  return session.chatHistory
    .filter((m) => m.kind === 'assistant')
    .map((m) => ({ role: 'assistant' as const, text: m.text }));
}

/** Cap a string for prompt-size safety without breaking the middle of a file. */
function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n… (truncated)` : text;
}
