import { useEffect, useState } from 'react';
import type { DiffReport } from '@decypher/core';
import { api, type PreviewResult } from '../api';
import { DiffBlock } from './DiffBlock';

interface Props {
  sessionId: string;
  report: DiffReport;
}

type Mode = 'source' | 'live';

/** Stage 3: what changed and why, plus an interactive before/after source view. */
export function CompareView({ sessionId, report }: Props) {
  const [mode, setMode] = useState<Mode>('source');
  const [selected, setSelected] = useState(report.changedFiles[0]?.path ?? '');
  const [before, setBefore] = useState('');
  const [after, setAfter] = useState('');

  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const selectedFile = report.changedFiles.find((f) => f.path === selected);

  useEffect(() => {
    if (mode !== 'source' || !selected) return;
    let active = true;
    const load = async (ref: 'before' | 'after') => {
      try {
        const text = await fetch(api.fileUrl(sessionId, ref, selected)).then((r) =>
          r.ok ? r.text() : `(no ${ref} version of this file)`,
        );
        if (active) (ref === 'before' ? setBefore : setAfter)(text);
      } catch {
        if (active) (ref === 'before' ? setBefore : setAfter)('');
      }
    };
    void load('before');
    void load('after');
    return () => {
      active = false;
    };
  }, [sessionId, mode, selected]);

  // Reset the live preview whenever this comparison unmounts or is re-run.
  useEffect(() => {
    return () => {
      void api.stopPreview(sessionId).catch(() => undefined);
    };
  }, [sessionId]);

  const openLive = async () => {
    setMode('live');
    if (preview?.status === 'ready') return;
    setPreviewLoading(true);
    try {
      setPreview(await api.startPreview(sessionId));
    } catch (err) {
      setPreview({ status: 'unavailable', reason: (err as Error).message });
    } finally {
      setPreviewLoading(false);
    }
  };

  return (
    <div>
      <div className="toggle" role="tablist">
        <button
          type="button"
          className={`toggle-btn${mode === 'source' ? ' active' : ''}`}
          onClick={() => setMode('source')}
        >
          Source diff
        </button>
        <button
          type="button"
          className={`toggle-btn${mode === 'live' ? ' active' : ''}`}
          onClick={openLive}
        >
          Live preview
        </button>
      </div>

      <div className="summary">
        {report.before.fileCount} files before → {report.after.fileCount} after ·{' '}
        {report.changedFiles.length} file(s) changed. Both states are preserved.
      </div>

      {mode === 'live' && (
        <LivePreview loading={previewLoading} result={preview} onFallback={() => setMode('source')} />
      )}

      {mode === 'source' && (
        <>
          <div className="row" style={{ marginBottom: 16 }}>
            {report.changedFiles.map((f) => (
              <button
                key={f.path}
                type="button"
                className={`chip${f.path === selected ? ' active' : ''}`}
                style={
                  f.path === selected
                    ? { color: 'var(--text)', borderStyle: 'solid', borderColor: 'var(--accent)' }
                    : undefined
                }
                onClick={() => setSelected(f.path)}
              >
                {f.path}
              </button>
            ))}
          </div>

          {selectedFile && (
            <>
              <DiffBlock file={selectedFile} />
              <div className="compare">
                <div className="pane original">
                  <header>
                    <span>Original</span>
                    <span>{selected}</span>
                  </header>
                  <pre>{before}</pre>
                </div>
                <div className="pane modified">
                  <header>
                    <span>Modified</span>
                    <span>{selected}</span>
                  </header>
                  <pre>{after}</pre>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** Renders the two interactive iframes, or a non-crashing fallback. */
function LivePreview({
  loading,
  result,
  onFallback,
}: {
  loading: boolean;
  result: PreviewResult | null;
  onFallback: () => void;
}) {
  if (loading) {
    return (
      <div className="empty">
        <span className="spinner" /> Starting preview servers…
      </div>
    );
  }

  if (!result || result.status === 'unavailable') {
    return (
      <div className="fallback">
        <p>
          Live preview unavailable. Showing source diff instead.
          {result ? ` (${result.reason})` : ''}
        </p>
        {result && (
          <button type="button" className="ghost sm" onClick={onFallback}>
            Back to source diff
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="preview-grid">
      <div className="preview-col">
        <div className="preview-label">Before</div>
        <iframe className="preview-frame" title="Before" src={result.before} />
      </div>
      <div className="preview-col">
        <div className="preview-label">After</div>
        <iframe className="preview-frame" title="After" src={result.after} />
      </div>
    </div>
  );
}
