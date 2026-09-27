import { useState } from 'react';
import type { ProtectedRule, RepoIndex } from '@decypher/core';

interface Props {
  index: RepoIndex;
  rules: ProtectedRule[];
  /** Paths the current plan intends to change — passed through for ContextPanel compatibility. */
  plannedPaths: string[];
  onTogglePath: (path: string) => void;
  onAddGlob: (glob: string) => void;
  onRemove: (ruleId: string) => void;
}

/**
 * Glob-rule manager. The file tree has moved to FileTree (left sidebar).
 * This component handles: add a glob pattern + display the active rule list.
 */
export function ProtectionPanel({ rules, onAddGlob, onRemove }: Props) {
  const [glob, setGlob] = useState('');

  const submitGlob = () => {
    const value = glob.trim();
    if (!value) return;
    onAddGlob(value);
    setGlob('');
  };

  return (
    <div className="protection-panel">
      <div className="row" style={{ marginBottom: 10 }}>
        <input
          type="text"
          placeholder="glob, e.g. web/** or src/store.js"
          value={glob}
          onChange={(e) => setGlob(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submitGlob()}
        />
        <button type="button" className="primary sm" onClick={submitGlob}>
          Lock
        </button>
      </div>

      {rules.length > 0 && (
        <div className="rule-list">
          {rules.map((rule) => (
            <div className="rule" key={rule.id}>
              <span className={`state ${rule.locked ? 'on' : 'off'}`}>
                {rule.locked ? '🔒' : '🔓'}
              </span>
              <span className="g">{rule.glob}</span>
              <span className="rule-label">{rule.label}</span>
              <button type="button" className="sm ghost" onClick={() => onRemove(rule.id)}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {rules.length === 0 && (
        <p className="ctx-hint" style={{ marginTop: 6 }}>
          No active glob rules. Lock individual files via the sidebar, or add a glob above.
        </p>
      )}
    </div>
  );
}
