import { useEffect, useRef } from 'react';
import type { ChangePlan, ChatMessage, ConflictReport, ConflictResolution } from '@decypher/core';

/** A user-typed message in the local thread (not persisted to session). */
export interface UserMessage {
  role: 'user';
  text: string;
  timestamp: number;
}

/** Union of what can appear in the visible thread. */
type ThreadEntry =
  | { kind: 'user'; text: string; timestamp: number }
  | (ChatMessage & { timestamp: number });

const SUGGESTIONS = [
  'What files are in this project?',
  'Add due dates to tasks',
  'How does the task store work?',
  'Add a search box to filter tasks',
];

interface Props {
  userMessages: UserMessage[];
  chatHistory: ChatMessage[];
  busy: boolean;
  requestText: string;
  onRequestChange: (v: string) => void;
  onSubmit: () => void;
  /** Current plan — needed for plan-card action buttons. */
  plan?: ChangePlan;
  /** Current conflict — needed to show conflict prompt inside the bubble. */
  conflict?: ConflictReport;
  stage: string;
  onOpenFile: (path: string) => void;
  onToggleLock: (path: string) => void;
  isProtected: (path: string) => boolean;
  onApply: () => void;
  onRevert: () => void;
  onKeep: () => void;
  onOpenCompare: () => void;
  onResolve: (r: ConflictResolution) => void;
}

const ACTION_BADGE: Record<string, string> = {
  create: 'create',
  modify: 'modify',
  delete: 'delete',
};

/**
 * IDE-style chat panel.
 * User messages appear on the right; agent narratives + structured cards on the left.
 * Plan-card and diff-card bubbles contain clickable file rows and action buttons.
 */
export function ChatPanel({
  userMessages,
  chatHistory,
  busy,
  requestText,
  onRequestChange,
  onSubmit,
  plan,
  conflict,
  stage,
  onOpenFile,
  onToggleLock,
  isProtected,
  onApply,
  onRevert,
  onKeep,
  onOpenCompare,
  onResolve,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  const hasConflict = !!conflict && !conflict.clear;

  // Merge and sort user messages + agent messages chronologically.
  // Filter out plan-narrative and diff-narrative — their structured cards replace them.
  const thread: ThreadEntry[] = [
    ...userMessages.map((m) => ({ kind: 'user' as const, text: m.text, timestamp: m.timestamp })),
    ...chatHistory
      .filter((m) => m.kind !== 'plan-narrative' && m.kind !== 'diff-narrative')
      .map((m) => ({ ...m })),
  ].sort((a, b) => a.timestamp - b.timestamp);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thread.length]);

  return (
    <div className="chat-panel">
      <div className="chat-messages">
        {thread.length === 0 && (
          <div className="chat-empty">
            <p>Ask a question about the project, or describe a change you want to make.</p>
            <p>Questions get an AI answer instantly. Change requests trigger a plan — the agent shows which files will be touched before writing anything.</p>
            <div className="chat-chips">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="chat-chip"
                  onClick={() => onRequestChange(s)}
                  disabled={busy}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {thread.map((entry, i) => {
          if (entry.kind === 'user') {
            return (
              <div key={i} className="msg-row user">
                <div className="msg-bubble user">{entry.text}</div>
              </div>
            );
          }

          if (entry.kind === 'assistant') {
            return (
              <div key={i} className="msg-row agent">
                <div className="msg-bubble agent assistant">
                  <div className="msg-label">
                    Assistant
                    {entry.source === 'mock' && (
                      <span className="msg-source mock" title="Live IBM Bob is unreachable, so this answer came from the offline fallback — not the AI.">
                        ⚠ offline mock · Bob unreachable
                      </span>
                    )}
                    {entry.source === 'bob' && (
                      <span className="msg-source live" title="Answered live by IBM Bob 2.0.">● IBM Bob</span>
                    )}
                  </div>
                  <p className="msg-text">{entry.text}</p>
                </div>
              </div>
            );
          }

          if (entry.kind === 'plan-card') {
            return (
              <div key={i} className="msg-row agent">
                <div className="msg-bubble agent plan-card">
                  <div className="msg-label">Plan</div>
                  <p className="msg-text">{entry.text}</p>

                  {entry.files && entry.files.length > 0 && (
                    <div className="card-file-list">
                      {entry.files.map((f) => {
                        const locked = isProtected(f.path);
                        return (
                          <div key={f.path} className={`card-file-row${locked ? ' locked' : ''}`}>
                            <span className={`badge ${ACTION_BADGE[f.action] ?? 'modify'}`}>
                              {f.action}
                            </span>
                            <button
                              type="button"
                              className="card-file-path"
                              title="View file content"
                              onClick={() => onOpenFile(f.path)}
                            >
                              {f.path}
                            </button>
                            <span className="card-file-purpose">{f.purpose}</span>
                            <button
                              type="button"
                              className={`ft-lock card-lock${locked ? ' on' : ''}`}
                              title={locked ? 'Unlock this file' : 'Lock this file'}
                              onClick={() => onToggleLock(f.path)}
                            >
                              {locked ? '🔒' : '🔓'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Conflict prompt inline */}
                  {hasConflict && stage === 'blocked' && (
                    <div className="card-conflict">
                      <div className="card-conflict-title">⚠ Protected file conflict</div>
                      {conflict!.conflicts.map((c, ci) => (
                        <div key={ci} className="card-conflict-row">
                          <span className="card-conflict-path">{c.file.path}</span>
                          <span className="card-conflict-why">{c.why}</span>
                        </div>
                      ))}
                      <div className="card-actions">
                        <button type="button" className="sm" disabled={busy} onClick={() => onResolve('allow')}>
                          Allow &amp; unlock
                        </button>
                        <button type="button" className="sm primary" disabled={busy} onClick={() => onResolve('keep-and-replan')}>
                          Keep &amp; re-plan
                        </button>
                        <button type="button" className="sm ghost danger" disabled={busy} onClick={() => onResolve('cancel')}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Apply button — only when planned and clear */}
                  {stage === 'planned' && plan && (
                    <div className="card-actions">
                      <button
                        type="button"
                        className="primary"
                        onClick={onApply}
                        disabled={busy}
                      >
                        {busy ? <span className="spinner" /> : null}
                        Apply change
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          }

          if (entry.kind === 'diff-card') {
            return (
              <div key={i} className="msg-row agent">
                <div className="msg-bubble agent diff-card">
                  <div className="msg-label">Applied</div>
                  <p className="msg-text">{entry.text}</p>

                  {entry.files && entry.files.length > 0 && (
                    <div className="card-file-list">
                      {entry.files.map((f) => (
                        <div key={f.path} className="card-file-row diff">
                          <span className={`badge ${ACTION_BADGE[f.action] ?? 'modify'}`}>
                            {f.action}
                          </span>
                          <button
                            type="button"
                            className="card-file-path"
                            title="View changed file"
                            onClick={() => onOpenFile(f.path)}
                          >
                            {f.path}
                          </button>
                          <span className="card-diff-counts">
                            {f.added !== undefined && <span className="add">+{f.added}</span>}
                            {f.removed !== undefined && <span className="rem">−{f.removed}</span>}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="card-actions">
                    <button type="button" className="sm" onClick={onOpenCompare} disabled={busy}>
                      See versions compared ↗
                    </button>
                    <button type="button" className="sm primary" onClick={onKeep} disabled={busy}>
                      Keep
                    </button>
                    <button type="button" className="sm ghost danger" onClick={onRevert} disabled={busy}>
                      Revert
                    </button>
                  </div>
                </div>
              </div>
            );
          }

          return null;
        })}

        {busy && (
          <div className="msg-row agent">
            <div className="msg-bubble agent thinking">
              <span className="spinner" /> Thinking…
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="chat-input-row">
        <textarea
          className="chat-input"
          rows={2}
          placeholder="Ask a question or describe a change… (Enter to send, Shift+Enter for newline)"
          value={requestText}
          onChange={(e) => onRequestChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSubmit();
            }
          }}
          disabled={busy}
        />
        <button
          type="button"
          className="chat-send"
          onClick={onSubmit}
          disabled={busy || !requestText.trim()}
          title="Send"
        >
          {busy ? <span className="spinner" /> : '↑'}
        </button>
      </div>
    </div>
  );
}
