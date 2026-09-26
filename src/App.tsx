import { useCallback, useEffect, useState } from 'react';
import type { AgentKind, ConflictResolution, DecypherSession } from '@decypher/core';
import { matchGlob } from '@decypher/protect';
import { api } from './api';
import { StageRail } from './components/StageRail';
import { PlanView } from './components/PlanView';
import { ProtectionPanel } from './components/ProtectionPanel';
import { ConflictPanel } from './components/ConflictPanel';
import { CompareView } from './components/CompareView';

const SUGGESTIONS = [
  'Add due dates to tasks',
  'Refresh the visual theme of the inbox',
  'Add a search box to filter tasks',
];

export function App() {
  const [session, setSession] = useState<DecypherSession | null>(null);
  const [agent, setAgent] = useState<AgentKind>('mock');
  const [defaultRepo, setDefaultRepo] = useState('');
  const [requestText, setRequestText] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ msg: string; error?: boolean } | null>(null);

  const notify = (msg: string, error = false) => setStatus({ msg, error });

  const startSession = useCallback(
    async (kind: AgentKind) => {
      setBusy(true);
      try {
        const s = await api.createSession(undefined, kind);
        setSession(s);
        setRequestText('');
        notify(`Session started on ${kind === 'bob' ? 'IBM Bob 2.0' : 'mock'} agent.`);
      } catch (err) {
        notify((err as Error).message, true);
      } finally {
        setBusy(false);
      }
    },
    [],
  );

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

  // Every mutation returns the fresh session object, which drives the whole UI.
  const guard = <T,>(fn: () => Promise<T>): Promise<void> =>
    fn()
      .then(() => undefined)
      .catch((err: Error) => notify(err.message, true));

  const run = (p: Promise<DecypherSession>) => guard(async () => setSession(await p));

  const onPlan = () => {
    if (!session || !requestText.trim()) return;
    setBusy(true);
    run(api.plan(session.id, requestText.trim())).finally(() => setBusy(false));
  };

  const onTogglePath = (path: string) => session && run(api.togglePath(session.id, path));
  const onAddGlob = (glob: string) => session && run(api.protect(session.id, glob));
  const onRemove = (ruleId: string) => session && run(api.removeProtection(session.id, ruleId));

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
      notify('Reverted to the original state.');
    }).finally(() => setBusy(false));
  };

  const isProtected = (path: string) =>
    !!session?.rules.some((r) => r.locked && matchGlob(r.glob, path));

  const conflict = session?.conflict && !session.conflict.clear ? session.conflict : null;
  const repoName = defaultRepo.split(/[\\/]/).pop() ?? 'repo';

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <div className="logo">◑</div>
          <div>
            <h1>Decypher</h1>
            <p>A control &amp; comprehension layer over AI code changes · IBM Bob 2.0</p>
          </div>
        </div>
        <div className="row">
          <span className={`pill ${agent === 'bob' ? 'live' : ''}`}>
            agent: {agent === 'bob' ? 'IBM Bob 2.0' : 'mock (deterministic)'}
          </span>
          <span className="pill">repo: {repoName}</span>
          <select
            className="pill"
            value={agent}
            onChange={(e) => {
              const next = e.target.value as AgentKind;
              setAgent(next);
              void startSession(next);
            }}
          >
            <option value="mock">mock</option>
            <option value="bob">bob</option>
          </select>
        </div>
      </header>

      <StageRail
        stage={session?.stage ?? 'idle'}
        hasPlan={!!session?.plan}
        hasDiff={!!session?.diff}
      />

      <div className="grid">
        <div className="card">
          <div className="section-title">Your request</div>
          <textarea
            rows={3}
            placeholder="Describe the change you want the AI to make…"
            value={requestText}
            onChange={(e) => setRequestText(e.target.value)}
          />
          <div className="row" style={{ marginTop: 12 }}>
            <button className="primary" onClick={onPlan} disabled={busy || !requestText.trim()}>
              {busy ? <span className="spinner" /> : null}
              {session?.plan ? 'Re-plan' : 'Ask agent to plan'}
            </button>
            <button className="ghost" onClick={() => startSession(agent)} disabled={busy}>
              New session
            </button>
          </div>
          <div className="chips">
            {SUGGESTIONS.map((s) => (
              <span key={s} className="chip" onClick={() => setRequestText(s)}>
                {s}
              </span>
            ))}
          </div>

          <div style={{ height: 18 }} />

          {!session?.plan && (
            <div className="empty">
              No plan yet. Ask the agent to plan — nothing changes until you approve it.
            </div>
          )}

          {session?.plan && (
            <>
              <div className="section-title">Proposed change plan</div>
              <PlanView
                plan={session.plan}
                isProtected={isProtected}
                onToggleLock={onTogglePath}
              />
            </>
          )}

          {conflict && <ConflictPanel conflict={conflict} busy={busy} onResolve={onResolve} />}

          {session?.plan && !conflict && !session.diff && (
            <div className="row" style={{ marginTop: 16 }}>
              <button className="primary" onClick={onApply} disabled={busy}>
                {busy ? <span className="spinner" /> : null}
                Approve &amp; apply change
              </button>
            </div>
          )}

          {session?.diff && (
            <>
              <div className="section-title" style={{ marginTop: 18 }}>
                Before / after
              </div>
              <CompareView sessionId={session.id} report={session.diff} />
              <div className="row" style={{ marginTop: 16 }}>
                <button className="ghost danger" onClick={onRevert} disabled={busy}>
                  Revert to original
                </button>
                <button className="primary" onClick={() => notify('Kept. You can lock more files and plan again.')}>
                  Keep this version
                </button>
              </div>
            </>
          )}
        </div>

        <aside className="card">
          <div className="section-title">Protect what matters</div>
          <p className="hint">
            Lock files or use globs. Protected elements are hard boundaries — the agent cannot
            change them without asking you.
          </p>
          {session && (
            <ProtectionPanel
              index={session.index}
              rules={session.rules}
              onTogglePath={onTogglePath}
              onAddGlob={onAddGlob}
              onRemove={onRemove}
            />
          )}
        </aside>
      </div>

      <footer className="foot">
        Plan before change · Protect what matters · Compare before and after
      </footer>

      {status && (
        <div className={`status ${status.error ? 'err' : ''}`}>
          <span>{status.msg}</span>
        </div>
      )}
    </div>
  );
}
