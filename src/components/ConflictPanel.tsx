import type { ConflictReport, ConflictResolution } from '@decypher/core';

interface Props {
  conflict: ConflictReport;
  busy: boolean;
  onResolve: (resolution: ConflictResolution) => void;
}

/**
 * The boundary-enforcement moment: Decypher stopped the agent because the plan touches
 * something protected. It names each element, why, and what would change, then hands the
 * decision back to the user.
 */
export function ConflictPanel({ conflict, busy, onResolve }: Props) {
  return (
    <div className="conflict-box">
      <h3>⚠ Change blocked by a protected element</h3>
      {conflict.conflicts.map((c, i) => (
        <div className="conflict-row" key={`${c.file.path}-${c.rule.id}-${i}`}>
          <div className="cf">
            <strong>{c.file.path}</strong> · {c.file.action}
          </div>
          <div>{c.why}</div>
          <div style={{ color: 'var(--muted)', marginTop: 2 }}>{c.proposedChange}</div>
        </div>
      ))}
      <div className="row" style={{ marginTop: 12 }}>
        <button type="button" disabled={busy} onClick={() => onResolve('allow')}>
          Allow &amp; unlock
        </button>
        <button type="button" className="primary" disabled={busy} onClick={() => onResolve('keep-and-replan')}>
          Keep protection &amp; re-plan
        </button>
        <button type="button" className="danger ghost" disabled={busy} onClick={() => onResolve('cancel')}>
          Cancel change
        </button>
      </div>
    </div>
  );
}
