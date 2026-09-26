/**
 * Shared types and data contracts used across the whole Decypher workflow.
 * These interfaces decouple the UI from whatever AI agent does the work (Bob / mock):
 * as long as the agent emits JSON matching these contracts, the
 * plan -> protect -> compare workflow runs stably.
 */

/** Supported agent adapters: mock is deterministic and offline; bob is live IBM Bob 2.0. */
export type AgentKind = 'mock' | 'bob';

/** The kind of operation a plan intends to perform on a single file. */
export type FileAction = 'create' | 'modify' | 'delete';

/** A node (file or directory) in the repository tree. */
export interface FileNode {
  /** Path relative to the repo root, always forward-slash separated. */
  path: string;
  type: 'file' | 'dir';
  /** Only meaningful for files: byte size, used for UI display. */
  size?: number;
}

/** A lightweight index of the target repository, given to the agent as plan context. */
export interface RepoIndex {
  repoRoot: string;
  files: FileNode[];
  /** Convenience: all file paths (relative to root). */
  filePaths: string[];
}

/** Per-file description inside a change plan. */
export interface PlannedFileChange {
  path: string;
  action: FileAction;
  /** What this file does in the project, independent of the current change. */
  description?: string;
  /** Why it is being changed now: the change reason tied to the user's request. */
  purpose: string;
  /** Dependency path: which other files this one depends on / affects. */
  dependsOn: string[];
}

/** Stage 1: the "change plan" the agent produces before any code is written. */
export interface ChangePlan {
  id: string;
  requestId: string;
  agent: AgentKind;
  /** Overall summary of what this plan intends to do. */
  summary: string;
  files: PlannedFileChange[];
  createdAt: number;
}

/** A single user-defined protection boundary (glob matched). */
export interface ProtectedRule {
  id: string;
  /** Glob pattern, e.g. "src/components/**" or "src/theme.css". */
  glob: string;
  /** Human-readable label. */
  label: string;
  locked: boolean;
}

/** Stage 2: one detailed conflict where a plan touches a protected element. */
export interface PlanConflict {
  rule: ProtectedRule;
  /** The planned file that a protection rule matched. */
  file: PlannedFileChange;
  /** Why this change would involve the protected element. */
  why: string;
  /** What the plan would do to that element. */
  proposedChange: string;
}

/** Stage 2 evaluation result for a whole plan. */
export interface ConflictReport {
  planId: string;
  conflicts: PlanConflict[];
  /** True when there are no conflicts and the plan can safely be applied. */
  clear: boolean;
}

/** Line states used to render a diff. */
export type DiffLineKind = 'context' | 'added' | 'removed';

export interface DiffLine {
  kind: DiffLineKind;
  /** Line content (without any +/- prefix). */
  text: string;
  oldLine?: number;
  newLine?: number;
}

/** Diff for a single file, including the "why it changed" explanation. */
export interface FileDiff {
  path: string;
  action: FileAction;
  added: number;
  removed: number;
  lines: DiffLine[];
  /** Explanation (from the agent, or from the plan) of why this file changed. */
  whyChanged: string;
}

/** Stage 3: the full before/after comparison report. */
export interface DiffReport {
  snapshotId: string;
  planId: string;
  changedFiles: FileDiff[];
  /** Reference to the "original" snapshot. */
  before: SnapshotRef;
  /** Reference to the "modified" snapshot. */
  after: SnapshotRef;
  createdAt: number;
}

/** Reference information for a single snapshot. */
export interface SnapshotRef {
  id: string;
  /** Git branch the snapshot lives on. */
  branch: string;
  commit: string;
  fileCount: number;
  label: string;
}

/** Conflict handling choices: allow-and-unlock, keep-and-replan, or cancel. */
export type ConflictResolution = 'allow' | 'keep-and-replan' | 'cancel';

/** Which stage the session is currently in. */
export type SessionStage = 'idle' | 'planned' | 'blocked' | 'ready' | 'applied';

/** A single session object that drives the whole workflow on the frontend. */
export interface DecypherSession {
  id: string;
  repoRoot: string;
  request: string;
  agent: AgentKind;
  index: RepoIndex;
  rules: ProtectedRule[];
  plan?: ChangePlan;
  conflict?: ConflictReport;
  snapshotId?: string;
  diff?: DiffReport;
  stage: SessionStage;
}
