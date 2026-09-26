import { useState } from 'react';
import type { ProtectedRule, RepoIndex } from '@decypher/core';
import { matchGlob } from '@decypher/protect';

interface Props {
  index: RepoIndex;
  rules: ProtectedRule[];
  onTogglePath: (path: string) => void;
  onAddGlob: (glob: string) => void;
  onRemove: (ruleId: string) => void;
}

/** Stage 2 controls: browse the repo tree, lock paths, and manage glob rules. */
export function ProtectionPanel({ index, rules, onTogglePath, onAddGlob, onRemove }: Props) {
  const [glob, setGlob] = useState('');
  const files = index.files.filter((f) => f.type === 'file');

  const isLocked = (path: string) => rules.some((r) => r.locked && matchGlob(r.glob, path));

  const submitGlob = () => {
    const value = glob.trim();
    if (!value) return;
    onAddGlob(value);
    setGlob('');
  };

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <input
          type="text"
          placeholder="add a glob, e.g. web/** or src/store.js"
          value={glob}
          onChange={(e) => setGlob(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submitGlob()}
        />
        <button type="button" className="primary" onClick={submitGlob}>
          Lock
        </button>
      </div>

      {rules.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          {rules.map((rule) => (
            <div className="rule" key={rule.id}>
              <span className={`state ${rule.locked ? 'on' : 'off'}`}>
                {rule.locked ? '🔒 locked' : '🔓 off'}
              </span>
              <span className="g">{rule.glob}</span>
              <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)' }}>
                {rule.label}
              </span>
              <button type="button" className="sm ghost" onClick={() => onRemove(rule.id)}>
                remove
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="section-title">Repository files</div>
      <div className="tree">
        {files.map((file) => {
          const locked = isLocked(file.path);
          return (
            <div className="node" key={file.path}>
              <button
                type="button"
                className={`lock-btn sm${locked ? ' locked' : ''}`}
                onClick={() => onTogglePath(file.path)}
                title={locked ? 'Unlock' : 'Lock this file'}
              >
                {locked ? '🔒' : '🔓'}
              </button>
              <span className={locked ? 'active' : ''}>{file.path}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
