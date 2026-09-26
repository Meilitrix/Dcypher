import type { ChangePlan } from '@decypher/core';

interface Props {
  plan: ChangePlan;
  /** Returns true when a path currently has an active lock, to render its state. */
  isProtected: (path: string) => boolean;
  onToggleLock: (path: string) => void;
}

/** Stage 1 output: the human-readable change plan, with inline lock controls. */
export function PlanView({ plan, isProtected, onToggleLock }: Props) {
  return (
    <div>
      <div className="summary">{plan.summary}</div>
      {plan.files.map((file) => {
        const locked = isProtected(file.path);
        return (
          <div className="file-item" key={file.path}>
            <span className={`badge ${file.action}`}>{file.action}</span>
            <div className="meta">
              <div className="path">{file.path}</div>
              <div className="purpose">
                <span className="tag">Change</span>
                {file.purpose}
              </div>
              <div className="filedesc">
                <span className="tag">File</span>
                {file.description && file.description.trim() ? file.description : 'No description available'}
              </div>
              {file.dependsOn.length > 0 && (
                <div className="deps">depends on: {file.dependsOn.join(', ')}</div>
              )}
            </div>
            <button
              type="button"
              className={`lock-btn${locked ? ' locked' : ''}`}
              title={locked ? 'Unlock this file' : 'Protect this file'}
              onClick={() => onToggleLock(file.path)}
            >
              {locked ? '🔒' : '🔓'}
            </button>
          </div>
        );
      })}
    </div>
  );
}
