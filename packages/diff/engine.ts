import type { DiffReport, FileAction, FileDiff, PlannedFileChange, SnapshotRef } from '@decypher/core';
import { newId } from '@decypher/core';
import { collapseContext, diffLines } from './lcs';

/** Map of relative path -> file content (string). Missing key means the file is absent. */
export type FileMap = Record<string, string>;

/**
 * Stage 3 helper: turns "before" and "after" file maps into a readable report that
 * lists which files changed, what changed in each, and (from the plan) why.
 */
export class DiffEngine {
  /** Build the changed-file set by union-ing paths present in either snapshot. */
  private changedPaths(before: FileMap, after: FileMap): string[] {
    const paths = new Set<string>([...Object.keys(before), ...Object.keys(after)]);
    const changed: string[] = [];
    for (const path of paths) {
      if ((before[path] ?? '') !== (after[path] ?? '')) changed.push(path);
    }
    return changed.sort((a, b) => a.localeCompare(b));
  }

  private actionFor(path: string, before: FileMap, after: FileMap, plan?: PlannedFileChange[]): FileAction {
    const planned = plan?.find((p) => p.path === path);
    if (planned) return planned.action;
    if (!(path in before)) return 'create';
    if (!(path in after)) return 'delete';
    return 'modify';
  }

  private whyFor(path: string, action: FileAction, plan?: PlannedFileChange[]): string {
    const planned = plan?.find((p) => p.path === path);
    if (planned?.purpose) return planned.purpose;
    switch (action) {
      case 'create':
        return 'Created as part of the approved plan.';
      case 'delete':
        return 'Removed as part of the approved plan.';
      default:
        return 'Modified as part of the approved plan.';
    }
  }

  /** Produce the full before/after diff report for a session. */
  build(
    before: FileMap,
    after: FileMap,
    opts: { beforeRef: SnapshotRef; afterRef: SnapshotRef; planId: string; plan?: PlannedFileChange[] },
  ): DiffReport {
    const changedFiles: FileDiff[] = this.changedPaths(before, after).map((path) => {
      const action = this.actionFor(path, before, after, opts.plan);
      const lines = collapseContext(diffLines(before[path] ?? '', after[path] ?? ''));
      const added = lines.filter((l) => l.kind === 'added').length;
      const removed = lines.filter((l) => l.kind === 'removed').length;
      return {
        path,
        action,
        added,
        removed,
        lines,
        whyChanged: this.whyFor(path, action, opts.plan),
      };
    });

    return {
      snapshotId: newId('snap'),
      planId: opts.planId,
      changedFiles,
      before: opts.beforeRef,
      after: opts.afterRef,
      createdAt: Date.now(),
    };
  }
}
