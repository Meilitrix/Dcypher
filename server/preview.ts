import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { FileMap } from '@decypher/diff';

export interface PreviewPorts {
  before: number;
  after: number;
}

export type PreviewResult =
  | { status: 'ready'; before: string; after: string }
  | { status: 'unavailable'; reason: string };

interface Running {
  procs: ChildProcess[];
  dir: string;
}

/** The file a runnable static+API server needs for the sample target app. */
const RUNNABLE_ENTRY = 'src/server.js';

/** Best-effort recursive delete. On Windows a killed child can briefly still hold its cwd,
 *  so we never let a failed cleanup throw into the request flow. */
function safeRemove(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* locked by an exiting process; leave it, a new run uses a fresh dir */
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Spins up two throwaway servers so the user can interact with the original and the
 * modified app side by side. Each snapshot's file map is written into its own fresh temp
 * directory (equivalent to checking out that commit) and served there.
 *
 * Best-effort by design: if the repo isn't runnable as-is, or a server fails to boot, it
 * reports "unavailable" and the UI falls back to the source diff. It never throws into the
 * main flow and never leaves orphan servers bound to the preview ports.
 */
export class PreviewManager {
  private readonly running = new Map<string, Running>();

  constructor(
    private readonly previewRoot: string,
    private readonly ports: PreviewPorts,
  ) {}

  /** Write a file map to disk as a directory tree under baseDir. */
  private materialize(baseDir: string, map: FileMap): void {
    mkdirSync(baseDir, { recursive: true });
    for (const [rel, content] of Object.entries(map)) {
      const abs = join(baseDir, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content, 'utf8');
    }
  }

  /** Boot both preview servers for a session. Safe to call repeatedly. */
  async start(sessionId: string, before: FileMap, after: FileMap): Promise<PreviewResult> {
    // Preview ports are fixed, so only one preview runs at a time: clear any existing
    // servers (from this or another session) and let them release the ports first.
    this.stopAll();
    await delay(300);

    // We can only preview apps we know how to serve. For the sample target that means it
    // ships a self-contained Node server (src/server.js). Anything else -> source diff.
    if (!(RUNNABLE_ENTRY in before) || !(RUNNABLE_ENTRY in after)) {
      return { status: 'unavailable', reason: 'No runnable server found in the target app.' };
    }

    // A unique run directory avoids ever deleting (or colliding with) a still-locked dir.
    const runDir = join(this.previewRoot, sessionId, `${Date.now()}`);
    const beforeDir = join(runDir, 'before');
    const afterDir = join(runDir, 'after');
    try {
      this.materialize(beforeDir, before);
      this.materialize(afterDir, after);
    } catch (err) {
      safeRemove(runDir);
      return { status: 'unavailable', reason: `Could not prepare preview files: ${(err as Error).message}` };
    }

    const beforeProc = this.serve(beforeDir, this.ports.before);
    const afterProc = this.serve(afterDir, this.ports.after);
    this.running.set(sessionId, { procs: [beforeProc, afterProc], dir: runDir });

    // Give the servers a moment; treat an immediate crash as unavailable.
    if (await this.waitForBoot([beforeProc, afterProc])) {
      this.stop(sessionId);
      return { status: 'unavailable', reason: 'Preview servers exited on startup.' };
    }

    return {
      status: 'ready',
      before: `http://localhost:${this.ports.before}`,
      after: `http://localhost:${this.ports.after}`,
    };
  }

  private serve(cwd: string, port: number): ChildProcess {
    // process.execPath keeps us on the same Node binary that runs Decypher itself.
    return spawn(process.execPath, [RUNNABLE_ENTRY], {
      cwd,
      env: { ...process.env, PORT: String(port) },
      stdio: 'ignore',
      windowsHide: true,
    });
  }

  /** Resolve true if any process exits within the grace window (i.e. it failed to start). */
  private waitForBoot(procs: ChildProcess[], graceMs = 1500): Promise<boolean> {
    return new Promise((resolve) => {
      let failed = false;
      for (const p of procs) {
        p.once('exit', () => {
          failed = true;
        });
        p.once('error', () => {
          failed = true;
        });
      }
      setTimeout(() => resolve(failed), graceMs);
    });
  }

  /** Kill servers for a session and best-effort clean its temp dir. Never throws. */
  stop(sessionId: string): void {
    const entry = this.running.get(sessionId);
    if (!entry) return;
    for (const p of entry.procs) {
      if (!p.killed) p.kill();
    }
    this.running.delete(sessionId);
    safeRemove(entry.dir);
  }

  /** Kill everything (used on a new start and on shutdown). */
  stopAll(): void {
    for (const id of [...this.running.keys()]) this.stop(id);
  }
}
