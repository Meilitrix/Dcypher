import type { AgentKind, ConflictResolution, DecypherSession } from '@decypher/core';

// Default to same-origin relative paths: the built UI is served by the orchestrator itself
// (single tunnel URL, no CORS), and Vite forwards /api to :8787 in dev. Set VITE_API_BASE
// only when the API lives on a different origin.
const API_BASE = import.meta.env.VITE_API_BASE ?? '';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

/** Thin typed client over the Decypher orchestrator API. */
export const api = {
  health: () => request<{ ok: boolean; agent: AgentKind; defaultRepo: string }>('/api/health'),

  /** Resolve a GitHub URL or local folder path → { localPath }. */
  repoFromUrl: (source: string) =>
    request<{ localPath: string }>('/api/repo/from-url', {
      method: 'POST',
      body: JSON.stringify({ source }),
    }),

  /** Upload a .zip file and extract it → { localPath }. */
  repoFromZip: async (file: File): Promise<{ localPath: string }> => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${API_BASE}/api/repo/from-zip`, { method: 'POST', body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string }).error ?? `Upload failed (${res.status})`);
    return data as { localPath: string };
  },

  createSession: (repoRoot?: string, agent?: AgentKind) =>
    request<DecypherSession>('/api/session', {
      method: 'POST',
      body: JSON.stringify({ repoRoot, agent }),
    }),
  chat: (id: string, message: string) =>
    request<{ reply: string; source: 'bob' | 'mock' }>(`/api/session/${id}/chat`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),
  /** Chat scoped to the change-control window; answers cite diff line numbers. */
  compareChat: (id: string, question: string, path?: string) =>
    request<{ reply: string; source: 'bob' | 'mock' }>(`/api/session/${id}/compare-chat`, {
      method: 'POST',
      body: JSON.stringify({ question, path }),
    }),
  plan: (id: string, text: string) =>
    request<DecypherSession>(`/api/session/${id}/plan`, {
      method: 'POST',
      body: JSON.stringify({ request: text }),
    }),
  protect: (id: string, glob: string, label?: string) =>
    request<DecypherSession>(`/api/session/${id}/protect`, {
      method: 'POST',
      body: JSON.stringify({ glob, label }),
    }),
  togglePath: (id: string, path: string) =>
    request<DecypherSession>(`/api/session/${id}/protect/toggle`, {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),
  removeProtection: (id: string, ruleId: string) =>
    request<DecypherSession>(`/api/session/${id}/protect/${ruleId}`, { method: 'DELETE' }),
  resolve: (id: string, resolution: ConflictResolution) =>
    request<DecypherSession>(`/api/session/${id}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ resolution }),
    }),
  apply: (id: string) => request<DecypherSession>(`/api/session/${id}/apply`, { method: 'POST' }),
  revert: (id: string) => request<DecypherSession>(`/api/session/${id}/revert`, { method: 'POST' }),
  startPreview: (id: string) =>
    request<PreviewResult>(`/api/session/${id}/preview/start`, { method: 'POST' }),
  stopPreview: (id: string) =>
    request<{ ok: true }>(`/api/session/${id}/preview/stop`, { method: 'POST' }),
  fileUrl: (id: string, ref: 'before' | 'after', path: string) =>
    `${API_BASE}/api/session/${id}/file?ref=${ref}&path=${encodeURIComponent(path)}`,
};

/** Result of asking the orchestrator to boot live before/after servers. */
export type PreviewResult =
  | { status: 'ready'; before: string; after: string }
  | { status: 'unavailable'; reason: string };
