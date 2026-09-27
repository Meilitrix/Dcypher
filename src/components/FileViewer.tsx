import { useEffect, useState } from 'react';
import type { FileDiff } from '@decypher/core';
import { api } from '../api';

interface Props {
  sessionId: string;
  /** Relative path within the repo. */
  path: string;
  /** Whether this file was changed — shows "after" state if true, else "before". */
  isChanged?: boolean;
  /** When present, the file is rendered as a highlighted before/after diff. */
  diff?: FileDiff;
  onClose: () => void;
}

const SIGN = { added: '+', removed: '-', context: ' ' } as const;

/**
 * Right-panel file viewer.
 * - If a `diff` is supplied (a changed file), renders the unified diff with the same
 *   green/red line highlighting used in the change-control window.
 * - Otherwise, shows the raw content of the file with line numbers (read-only editor tab).
 */
export function FileViewer({ sessionId, path, isChanged, diff, onClose }: Props) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const ref = isChanged ? 'after' : 'before';

  useEffect(() => {
    setLoading(true);
    setError(null);
    setContent(null);

    fetch(api.fileUrl(sessionId, ref, path))
      .then((r) => {
        if (!r.ok) throw new Error(`Could not load file (${r.status})`);
        return r.text();
      })
      .then((text) => {
        setContent(text);
      })
      .catch((err: Error) => {
        setError(err.message);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [sessionId, path, ref]);

  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const lines = content !== null ? content.split('\n') : [];

  return (
    <div className="file-viewer">
      <div className="fv-header">
        <div className="fv-title">
          <span className="fv-icon">📄</span>
          <span className="fv-path" title={path}>{path}</span>
          {isChanged && <span className="fv-badge-changed">modified</span>}
        </div>
        <button type="button" className="ghost sm fv-close" onClick={onClose} title="Close file viewer">
          ✕
        </button>
      </div>

      {/* Changed file: show the highlighted before/after diff (same as change control). */}
      {diff ? (
        <div className="fv-body fv-diff-body">
          <div className="fv-diff-why">{diff.whyChanged}</div>
          <div className="diff">
            {diff.lines.map((line, i) => (
              <div key={i} className={`line ${line.kind}`}>
                <span className="no">{line.oldLine ?? ''}</span>
                <span className="no">{line.newLine ?? ''}</span>
                <span className="sign">{SIGN[line.kind]}</span>
                <span className="code">{line.text}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
      <div className="fv-body">
        {loading && (
          <div className="fv-state">
            <span className="spinner" /> Loading…
          </div>
        )}
        {error && (
          <div className="fv-state fv-error">{error}</div>
        )}
        {!loading && !error && content !== null && (
          <div className={`fv-code lang-${ext}`}>
            <table className="fv-table">
              <tbody>
                {lines.map((line, i) => (
                  <tr key={i} className="fv-line">
                    <td className="fv-ln">{i + 1}</td>
                    <td className="fv-lc">{line || '\u00a0'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
