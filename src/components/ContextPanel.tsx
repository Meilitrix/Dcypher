import type { ChangePlan, ChatMessage, ConflictReport, ConflictResolution, DiffReport, SessionStage } from '@decypher/core';
import { PlanView } from './PlanView';
import { ConflictPanel } from './ConflictPanel';
import { FileViewer } from './FileViewer';

interface Props {
  sessionId: string;
  stage: SessionStage;
  plan?: ChangePlan;
  conflict?: ConflictReport;
  hasDiff: boolean;
  /** Full before/after report — used to show highlighted diffs in the file viewer. */
  diffReport?: DiffReport;
  busy: boolean;
  /** Latest AI-generated narrative messages — shown inline in the panel. */
  chatHistory: ChatMessage[];
  /* Protection */
  onTogglePath: (path: string) => void;
  isProtected: (path: string) => boolean;
  /* Actions */
  onApply: () => void;
  onRevert: () => void;
  onKeep: () => void;
  onOpenCompare: () => void;
  onResolve: (r: ConflictResolution) => void;
  /** When set, the right panel shows this file's content (like a tab overlay). */
  openFile: string | null;
  onCloseFile: () => void;
}

/** Pull the most recent message of a given kind from the history. */
function latest(history: ChatMessage[], kind: ChatMessage['kind']): string | undefined {
  return [...history].reverse().find((m) => m.kind === kind)?.text;
}

/**
 * Right-hand context panel.
 * When `openFile` is set, the entire panel body becomes a file viewer (tab-like).
 * Otherwise, content switches based on the current session stage:
 *   idle      → hint to use the chat
 *   planned   → "What will change" (plan) + lock globs + Apply button
 *   blocked   → conflict resolution
 *   applied   → applied confirmation + Open change control + Keep / Revert
 */
export function ContextPanel({
  sessionId,
  plan,
  conflict,
  hasDiff,
  diffReport,
  busy,
  chatHistory,
  onTogglePath,
  isProtected,
  onApply,
  onRevert,
  onKeep,
  onOpenCompare,
  onResolve,
  openFile,
  onCloseFile,
}: Props) {
  const hasConflict = !!conflict && !conflict.clear;
  const planNarrative = latest(chatHistory, 'plan-narrative');
  const diffNarrative = latest(chatHistory, 'diff-narrative');

  // ── File viewer overlay ────────────────────────────────────────────────
  // When a file path is active, show FileViewer as the primary content
  // (replaces stage content like a tab). The header still shows context.
  if (openFile) {
    const openDiff = diffReport?.changedFiles.find((f) => f.path === openFile);
    const isChanged = !!openDiff;
    return (
      <div className="ctx-panel">
        <FileViewer
          sessionId={sessionId}
          path={openFile}
          isChanged={isChanged}
          diff={openDiff}
          onClose={onCloseFile}
        />
      </div>
    );
  }

  /* ── Idle / no plan ── */
  if (!plan) {
    return (
      <div className="ctx-panel">
        <div className="ctx-header">Context</div>
        <div className="ctx-empty">
          <p>No plan yet.</p>
          <p>Type a request in the chat and press Enter — the agent will plan what to change before writing anything.</p>
        </div>
      </div>
    );
  }

  /* ── Applied — show summary + compare button ── */
  if (hasDiff) {
    return (
      <div className="ctx-panel">
        <div className="ctx-header">Change applied</div>
        <div className="ctx-body ctx-scroll">
          {diffNarrative && (
            <div className="ctx-narrative diff-narrative">
              <div className="ctx-narrative-label">What changed</div>
              <p>{diffNarrative}</p>
            </div>
          )}
          {!diffNarrative && (
            <p className="ctx-hint">The change has been applied within your locked boundaries.</p>
          )}
          <button type="button" className="primary full-w" style={{ marginTop: 12 }} onClick={onOpenCompare}>
            See versions compared ↗
          </button>
          <div className="ctx-actions">
            <button type="button" className="ghost danger" onClick={onRevert} disabled={busy}>
              Revert to original
            </button>
            <button type="button" className="primary" onClick={onKeep} disabled={busy}>
              Keep this version
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Blocked by conflict ── */
  if (hasConflict) {
    return (
      <div className="ctx-panel">
        <div className="ctx-header ctx-header--warn">⚠ Protected file conflict</div>
        <div className="ctx-body">
          <ConflictPanel conflict={conflict!} busy={busy} onResolve={onResolve} />
        </div>
      </div>
    );
  }

  /* ── Planned / ready — main planning view ── */
  return (
    <div className="ctx-panel">
      <div className="ctx-header">What will change</div>
      <div className="ctx-body ctx-scroll">
        {planNarrative && (
          <div className="ctx-narrative plan-narrative">
            <div className="ctx-narrative-label">Agent explanation</div>
            <p>{planNarrative}</p>
          </div>
        )}
        <PlanView plan={plan} isProtected={isProtected} onToggleLock={onTogglePath} />
      </div>
      <div className="ctx-footer">
        <button type="button" className="primary full-w" onClick={onApply} disabled={busy}>
          {busy ? <span className="spinner" /> : null}
          Apply change
        </button>
      </div>
    </div>
  );
}
