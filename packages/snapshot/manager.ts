import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { SnapshotRef } from '@decypher/core';
import { newId } from '@decypher/core';
import type { FileMap } from '@decypher/diff';

/** Directories we never copy or index into a snapshot. */
const IGNORED = new Set(['node_modules', '.git', '.decypher-work', 'dist', '.next', 'build']);

/**
 * Git-backed snapshot manager. Decypher never mutates the user's real repo: it copies
 * the target into an isolated workspace, commits the untouched state ("original"), lets
 * the agent apply changes, then commits again ("modified"). Both states stay readable and
 * the working tree can be reverted to "original" at any time.
 */
export class SnapshotManager {
  readonly workspaceDir: string;
  private baseCommit = '';
  private originalRef?: SnapshotRef;

  private constructor(workspaceDir: string) {
    this.workspaceDir = workspaceDir;
  }

  /** Run a git command inside the workspace and return trimmed stdout. */
  private git(args: string[]): string {
    return execFileSync('git', args, {
      cwd: this.workspaceDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  }

  /** Create a fresh workspace by copying the source repo (excluding ignored dirs). */
  static fromRepo(repoRoot: string, workspaceDir: string): SnapshotManager {
    if (existsSync(workspaceDir)) {
      // Recreate deterministically for a clean demo state.
      rmSync(workspaceDir, { recursive: true, force: true });
    }
    mkdirSync(workspaceDir, { recursive: true });
    copyTree(repoRoot, workspaceDir);

    const mgr = new SnapshotManager(workspaceDir);
    mgr.git(['init', '-q']);
    // Pin line endings so a checkout never rewrites files with CRLF and produces
    // phantom diffs. Both snapshots are compared from commit content (always LF).
    mgr.git(['config', 'core.autocrlf', 'false']);
    mgr.git(['config', 'core.eol', 'lf']);
    mgr.git(['config', 'user.email', 'decypher@local']);
    mgr.git(['config', 'user.name', 'Decypher']);
    mgr.git(['add', '-A']);
    mgr.git(['commit', '-q', '-m', 'decypher: original state']);
    mgr.baseCommit = mgr.git(['rev-parse', 'HEAD']);
    return mgr;
  }

  /** Snapshot of the pristine "original" state captured at workspace creation. */
  original(): SnapshotRef {
    if (!this.originalRef) {
      this.originalRef = {
        id: newId('ref'),
        branch: this.git(['rev-parse', '--abbrev-ref', 'HEAD']),
        commit: this.baseCommit,
        fileCount: Object.keys(this.readFileMapAtCommit(this.baseCommit)).length,
        label: 'Original (unchanged)',
      };
    }
    return { ...this.originalRef };
  }

  /** Commit the agent's applied changes on a dedicated branch and return its ref. */
  captureModified(): SnapshotRef {
    // Work on a branch off the base commit so the original stays pinned.
    this.git(['checkout', '-B', 'decypher/modified']);
    this.git(['add', '-A']);
    const status = this.git(['status', '--porcelain']);
    if (status.length > 0) {
      this.git(['commit', '-q', '-m', 'decypher: modified by agent']);
    }
    const commit = this.git(['rev-parse', 'HEAD']);
    return {
      id: newId('ref'),
      branch: 'decypher/modified',
      commit,
      fileCount: Object.keys(this.readFileMapAtCommit(commit)).length,
      label: 'Modified (change applied)',
    };
  }

  /** Read the full file map stored at a specific commit. */
  readFileMapAtCommit(commit: string): FileMap {
    const map: FileMap = {};
    const listing = this.git(['ls-tree', '-r', '--name-only', commit]);
    if (!listing) return map;
    for (const rel of listing.split('\n')) {
      if (!rel) continue;
      try {
        map[rel] = this.git(['show', `${commit}:${rel}`]);
      } catch {
        /* skip */
      }
    }
    return map;
  }

  /** Revert the working tree back to the pristine original state. */
  revertToOriginal(): void {
    this.git(['checkout', '-B', 'decypher/modified', this.baseCommit]);
    this.git(['checkout', `${this.baseCommit}`, '--', '.']);
  }
}

/** Copy a directory tree, skipping ignored directories, into dest. */
function copyTree(src: string, dest: string): void {
  for (const entry of readdirSync(src)) {
    if (IGNORED.has(entry) || entry === '.git') continue;
    const abs = join(src, entry);
    const target = join(dest, entry);
    if (statSync(abs).isDirectory()) {
      mkdirSync(target, { recursive: true });
      copyTree(abs, target);
    } else {
      cpSync(abs, target);
    }
  }
}
