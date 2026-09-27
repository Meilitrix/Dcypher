import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentKind, ConflictResolution, DecypherSession } from '@decypher/core';
import { matchGlob } from '@decypher/protect';
import { api } from './api';
import { FileTree } from './components/FileTree';
import { ChatPanel } from './components/ChatPanel';
import type { UserMessage } from './components/ChatPanel';
import { ContextPanel } from './components/ContextPanel';
import { CompareView } from './components/CompareView';

export function App() {
  const [session, setSession] = useState<DecypherSession | null>(null);
  const [agent, setAgent] = useState<AgentKind>('mock');
  const [defaultRepo, setDefaultRepo] = useState('');
  const [requestText, setRequestText] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ msg: string; error?: boolean } | null>(null);
  const [userMessages, setUserMessages] = useState<UserMessage[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  /** Path of the file currently open in the right-panel viewer (null = no file open). */
  const [openFile, setOpenFile] = useState<string | null>(null);

  const notify = (msg: string, error = false) => setStatus({ msg, error });

  // Auto-dismiss status toasts after 4 s.
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!status) return;
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setStatus(null), 4000);
    return () => { if (toastTimer.current) clearTimeout(toastTimer.current); };
  }, [status]);

  const startSession = useCallback(async (kind: AgentKind) => {
    setBusy(true);
    try {
      const s = await api.createSession(undefined, kind);
      setSession(s);
      setRequestText('');
      setUserMessages([]);
      setCompareOpen(false);
      setOpenFile(null);
      notify(`Session started on ${kind === 'bob' ? 'IBM Bob 2.0' : 'mock'} agent.`);
    } catch (err) {
      notify((err as Error).message, true);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const h = await api.health();
        setAgent(h.agent);
        setDefaultRepo(h.defaultRepo);
        await startSession(h.agent);
      } catch {
        notify('Cannot reach the Decypher orchestrator. Start it with: npm run dev:server', true);
      }
    })();
  }, [startSession]);

  const guard = <T,>(fn: () => Promise<T>): Promise<void> =>
    fn().then(() => undefined).catch((err: Error) => notify(err.message, true));

  const run = (p: Promise<DecypherSession>) => guard(async () => setSession(await p));

  /**
   * Heuristic: detect whether the user's message is a question/inquiry or a change request.
   * Questions trigger the /chat endpoint (AI Q&A, no plan produced).
   * Everything else triggers the /plan endpoint (the normal change workflow).
   */
  const isQuestion = (text: string): boolean => {
    const t = text.trim();
    if (!t) return false;
    const filePaths = session?.index.filePaths ?? [];
    const lower = t.toLowerCase();
    // A bare file path or file name is a request to talk about that file, not to change it.
    const isBareFile = filePaths.some((p) => {
      const base = (p.split('/').pop() ?? p).toLowerCase();
      return lower === p.toLowerCase() || lower === base;
    });
    if (isBareFile) return true;
    if (t.endsWith('?')) return true;
    if (/^(what|where|who|when|why|how|which|is|are|does|do|can|could|should|would|tell me|explain|show me|find|list|describe|summarise|summarize|analyse|analyze|walk me through)\b/i.test(t)) return true;
    if (/\b(what is|what does|where is|how does|why does|show me|tell me|find me|list|explain|describe|help me understand|walk me through)\b/i.test(t)) return true;
    // Mentioning a known file/folder without an explicit change verb = a question about it.
    const mentionsFile = filePaths.some((p) => lower.includes((p.split('/').pop() ?? p).toLowerCase()));
    const changeVerb = /\b(add|remove|delete|create|update|change|modify|fix|refactor|rename|move|make|implement|replace)\b/i;
    if (mentionsFile && !changeVerb.test(t)) return true;
    return false;
  };

  // Submit: push a user bubble, then decide whether to ask the AI a question or produce a plan.
  const onSubmit = () => {
    if (!session || !requestText.trim()) return;
    const text = requestText.trim();
    setUserMessages((prev) => [...prev, { role: 'user', text, timestamp: Date.now() }]);
    setRequestText('');
    setBusy(true);
    if (isQuestion(text)) {
      guard(async () => {
        const { reply, source } = await api.chat(session.id, text);
        setSession((prev) =>
          prev
            ? {
                ...prev,
                chatHistory: [
                  ...prev.chatHistory,
                  { kind: 'assistant' as const, text: reply, timestamp: Date.now(), source },
                ],
              }
            : prev,
        );
      }).finally(() => setBusy(false));
    } else {
      run(api.plan(session.id, text)).finally(() => setBusy(false));
    }
  };

  const onTogglePath = (path: string) => session && run(api.togglePath(session.id, path));

  const onResolve = (resolution: ConflictResolution) => {
    if (!session) return;
    setBusy(true);
    run(api.resolve(session.id, resolution)).finally(() => setBusy(false));
  };

  const onApply = () => {
    if (!session) return;
    setBusy(true);
    guard(async () => {
      setSession(await api.apply(session.id));
      notify('Change applied within your boundaries.');
    }).finally(() => setBusy(false));
  };

  const onRevert = () => {
    if (!session) return;
    setBusy(true);
    guard(async () => {
      setSession(await api.revert(session.id));
      setCompareOpen(false);
      notify('Reverted to the original state.');
    }).finally(() => setBusy(false));
  };

  const onKeep = () => {
    setCompareOpen(false);
    notify('Kept. You can lock more files and plan again.');
  };

  const isProtected = (path: string) =>
    !!session?.rules.some((r) => r.locked && matchGlob(r.glob, path));

  const plannedPaths = session?.plan?.files.map((f) => f.path) ?? [];
  const repoName = defaultRepo.split(/[\\/]/).pop() ?? 'repo';
  const conflict = session?.conflict && !session.conflict.clear ? session.conflict : null;

  return (
    <div className="ide-shell">

      {/* ── Top bar ── */}
      <header className="ide-topbar">
        <div className="brand">
          <div className="logo">◑</div>
          <div>
            <span className="brand-name">Decypher</span>
            <span className="brand-sub">control &amp; comprehension layer · IBM Bob 2.0</span>
          </div>
        </div>
        <div className="topbar-right">
          <span className="pill">repo: {repoName}</span>
          <div className="agent-toggle">
            <button
              type="button"
              className={`agent-btn${agent === 'mock' ? ' active' : ''}`}
              onClick={() => { setAgent('mock'); void startSession('mock'); }}
              disabled={busy}
              title="Use the deterministic mock agent (always works, no API key needed)"
            >
              Mock
            </button>
            <button
              type="button"
              className={`agent-btn${agent === 'bob' ? ' active live' : ''}`}
              onClick={() => { setAgent('bob'); void startSession('bob'); }}
              disabled={busy}
              title="Use IBM Bob 2.0 (requires BOB_API_KEY in .env)"
            >
              IBM Bob 2.0
            </button>
          </div>
          <button className="ghost sm" onClick={() => startSession(agent)} disabled={busy}>
            New session
          </button>
        </div>
      </header>

      {/* ── Three-column IDE body ── */}
      <div className="ide-body">

        {/* ── Left: file tree ── */}
        <aside className="ide-sidebar">
          <div className="sidebar-header">
            <span className="sidebar-title">Files</span>
            <span className="sidebar-repo">{repoName}</span>
          </div>
          {session && (
            <FileTree
              index={session.index}
              rules={session.rules}
              plannedPaths={plannedPaths}
              onTogglePath={onTogglePath}
              onOpenFile={(path) => setOpenFile(path)}
            />
          )}
        </aside>

        {/* ── Centre: chat ── */}
        <main className="ide-chat">
          <ChatPanel
            userMessages={userMessages}
            chatHistory={session?.chatHistory ?? []}
            busy={busy}
            requestText={requestText}
            onRequestChange={setRequestText}
            onSubmit={onSubmit}
            plan={session?.plan}
            conflict={conflict ?? undefined}
            stage={session?.stage ?? 'idle'}
            onOpenFile={(path) => setOpenFile(path)}
            onToggleLock={onTogglePath}
            isProtected={isProtected}
            onApply={onApply}
            onRevert={onRevert}
            onKeep={onKeep}
            onOpenCompare={() => setCompareOpen(true)}
            onResolve={onResolve}
          />
        </main>

        {/* ── Right: context panel (or file viewer when openFile is set) ── */}
        <aside className="ide-context">
          {session ? (
            <ContextPanel
              sessionId={session.id}
              stage={session.stage}
              plan={session.plan}
              conflict={conflict ?? undefined}
              hasDiff={!!session.diff}
              diffReport={session.diff}
              busy={busy}
              chatHistory={session.chatHistory}
              isProtected={isProtected}
              onTogglePath={onTogglePath}
              onApply={onApply}
              onRevert={onRevert}
              onKeep={onKeep}
              onOpenCompare={() => setCompareOpen(true)}
              onResolve={onResolve}
              openFile={openFile}
              onCloseFile={() => setOpenFile(null)}
            />
          ) : (
            <div className="ctx-panel">
              <div className="ctx-header">Context</div>
              <div className="ctx-empty">
                <span className="spinner" /> Connecting…
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* ── Compare overlay ── */}
      {compareOpen && session?.diff && (
        <div className="compare-overlay">
          <div className="compare-overlay-bar">
            <span className="compare-overlay-title">Compare versions</span>
            <button type="button" className="ghost sm" onClick={() => setCompareOpen(false)}>
              ✕ Close
            </button>
          </div>
          <div className="compare-overlay-body">
            <CompareView sessionId={session.id} report={session.diff} />
            <div className="compare-overlay-actions">
              <button type="button" className="ghost danger" onClick={onRevert} disabled={busy}>
                Revert to original
              </button>
              <button type="button" className="primary" onClick={onKeep} disabled={busy}>
                Keep this version
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ── */}
      {status && (
        <div className={`status${status.error ? ' err' : ''}`}>
          <span>{status.msg}</span>
        </div>
      )}
    </div>
  );
}
