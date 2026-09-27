import { useEffect, useRef, useState } from 'react';
import type { DiffReport } from '@decypher/core';
import { api, type PreviewResult } from '../api';
import { DiffBlock } from './DiffBlock';

interface Props {
  sessionId: string;
  report: DiffReport;
}

type Mode = 'source' | 'live';

/**
 * Can this page embed the preview servers running on the server host's own localhost?
 * Only when the UI itself is served over plain http from localhost — i.e. local dev.
 * Over a tunnel / https / remote deploy this is false, so we show a labelled dummy
 * instead of iframes the browser would block (mixed content) or resolve to the wrong box.
 */
const canEmbedLive =
  typeof window !== 'undefined' &&
  window.location.protocol === 'http:' &&
  /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);

interface ChatTurn {
  role: 'user' | 'agent';
  text: string;
  source?: 'bob' | 'mock';
}

/** Stage 3: change control — a left rail of view controls, the code/diff, and a right-side chat. */
export function CompareView({ sessionId, report }: Props) {
  const [mode, setMode] = useState<Mode>('source');
  const [selected, setSelected] = useState(report.changedFiles[0]?.path ?? '');
  const [before, setBefore] = useState('');
  const [after, setAfter] = useState('');
  const [railOpen, setRailOpen] = useState(true);

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
    // Over a tunnel/https this can never embed, so don't even boot throwaway servers.
    if (!canEmbedLive) return;
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
    <div className="cc-wrap">
      {/* ── Left rail: hamburger controls (view modes, summary, file list) ── */}
      <aside className={`cc-rail${railOpen ? '' : ' collapsed'}`}>
        <button
          type="button"
          className="cc-rail-toggle"
          onClick={() => setRailOpen((o) => !o)}
          title={railOpen ? 'Collapse panel' : 'Expand panel'}
        >
          ☰
        </button>

        <div className="cc-rail-inner">
          <div className="cc-rail-label">View</div>
          <button
            type="button"
            className={`cc-nav-btn${mode === 'source' ? ' active' : ''}`}
            onClick={() => setMode('source')}
            title="Code view"
          >
            {'</>'}
            {railOpen && <span className="cc-nav-text">Code view</span>}
          </button>
          <button
            type="button"
            className={`cc-nav-btn${mode === 'live' ? ' active' : ''}`}
            onClick={openLive}
            title="See the live running app, before vs after"
          >
            ▶
            {railOpen && <span className="cc-nav-text">See live app view</span>}
          </button>

          {railOpen && (
            <>
              <div className="cc-rail-label">Summary</div>
              <div className="cc-summary">
                {report.before.fileCount} files before → {report.after.fileCount} after ·{' '}
                {report.changedFiles.length} file(s) changed. Both states are preserved.
              </div>

              <div className="cc-rail-label">Changed files</div>
              <div className="cc-filelist">
                {report.changedFiles.map((f) => (
                  <button
                    key={f.path}
                    type="button"
                    className={`cc-file${f.path === selected ? ' active' : ''}`}
                    onClick={() => {
                      setSelected(f.path);
                      setMode('source');
                    }}
                    title={f.path}
                  >
                    <span className={`badge ${f.action}`}>{f.action}</span>
                    <span className="cc-file-path">{f.path}</span>
                    <span className="cc-file-counts">
                      <span className="add">+{f.added}</span>
                      <span className="rem">−{f.removed}</span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </aside>

      {/* ── Main: the code / diff (kept as-is) or the live preview ── */}
      <main className="cc-main">
        {mode === 'live' && (
          <LivePreview loading={previewLoading} result={preview} onFallback={() => setMode('source')} />
        )}

        {mode === 'source' && (
          <>
            <div className="cc-selected-path">{selected}</div>
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
      </main>

      {/* ── Right: an IDE-style chat about this comparison ── */}
      <CompareChat sessionId={sessionId} selected={mode === 'source' ? selected : undefined} />
    </div>
  );
}

/** Renders the two interactive iframes when possible, else an honest labelled dummy. */
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

  // A real, viewable preview needs bootable servers AND a page that can embed them.
  if (result && result.status === 'ready' && canEmbedLive) {
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

  // Otherwise: clearly-labelled illustrative placeholder — never a fake "real" screenshot.
  let reason: string;
  if (!canEmbedLive) {
    reason =
      'The running-app view boots the app on the server itself, which a secured or shared ' +
      'connection (this tunnel/https page) cannot embed. It works when you run Decypher locally.';
  } else if (!result) {
    reason = 'Live preview is starting…';
  } else {
    reason = result.status === 'unavailable' ? result.reason : 'The preview servers could not be embedded here.';
  }

  return (
    <div className="lp-fallback">
      <div className="lp-fallback-head">
        <span className="lp-badge">Illustrative preview · not live</span>
        <button type="button" className="ghost sm" onClick={onFallback}>
          Back to code comparison ↗
        </button>
      </div>
      <p className="lp-reason">{reason}</p>
      <div className="lp-dummies">
        <DummyFrame label="Before" />
        <DummyFrame label="After" accent />
      </div>
      <p className="lp-note">
        The code diff is fully live — only the running-app preview is out of scope in this deployment.
      </p>
    </div>
  );
}

/** A faux browser window used as a placeholder when the real preview can't run. */
function DummyFrame({ label, accent = false }: { label: string; accent?: boolean }) {
  return (
    <div className="lp-dummy">
      <div className="lp-dummy-bar">
        <span className="lp-dot r" />
        <span className="lp-dot y" />
        <span className="lp-dot g" />
        <span className="lp-dummy-url">app preview ({label.toLowerCase()})</span>
      </div>
      <div className="lp-dummy-body">
        <div className="lp-wire lp-wire-title" />
        <div className="lp-wire lp-wire-line" />
        <div className="lp-wire lp-wire-item" />
        <div className="lp-wire lp-wire-item" />
        <div className="lp-wire lp-wire-item short" />
        {accent && <div className="lp-wire lp-wire-added" />}
      </div>
      <div className="lp-dummy-tag">{label} · sample</div>
    </div>
  );
}

/**
 * A chat scoped to the change-control window. The agent has the applied diff with line
 * numbers, so it can tell the user exactly which line to look at and what changed.
 */
function CompareChat({ sessionId, selected }: { sessionId: string; selected?: string }) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns.length, busy]);

  const send = () => {
    const question = input.trim();
    if (!question || busy) return;
    setTurns((prev) => [...prev, { role: 'user', text: question }]);
    setInput('');
    setBusy(true);
    api
      .compareChat(sessionId, question, selected)
      .then(({ reply, source }) => setTurns((prev) => [...prev, { role: 'agent', text: reply, source }]))
      .catch((err: Error) => setTurns((prev) => [...prev, { role: 'agent', text: err.message }]))
      .finally(() => setBusy(false));
  };

  return (
    <aside className="cc-chat">
      <div className="cc-chat-header">Ask about this change</div>
      <div className="cc-chat-msgs">
        {turns.length === 0 && (
          <div className="cc-chat-empty">
            Ask which lines changed, why, what the new behaviour is, or what fell back —
            the answers point to exact line numbers in the diff.
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`cc-chat-row ${t.role}`}>
            <div className={`cc-chat-bubble ${t.role}`}>
              {t.role === 'agent' && t.source === 'mock' && (
                <div className="cc-chat-src mock" title="Live IBM Bob is unreachable — this came from the offline fallback.">
                  ⚠ offline mock
                </div>
              )}
              {t.role === 'agent' && t.source === 'bob' && (
                <div className="cc-chat-src live" title="Answered live by IBM Bob 2.0.">● IBM Bob</div>
              )}
              {t.text}
            </div>
          </div>
        ))}
        {busy && (
          <div className="cc-chat-row agent">
            <div className="cc-chat-bubble agent thinking">
              <span className="spinner" /> Thinking…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div className="cc-chat-input-row">
        <textarea
          className="cc-chat-input"
          rows={2}
          placeholder="e.g. What changed on which lines?"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          disabled={busy}
        />
        <button type="button" className="chat-send" onClick={send} disabled={busy || !input.trim()} title="Send">
          {busy ? <span className="spinner" /> : '↑'}
        </button>
      </div>
    </aside>
  );
}
