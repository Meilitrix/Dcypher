import type { ChangePlan, PlannedFileChange, RepoIndex } from '@decypher/core';
import { newId } from '@decypher/core';
import type { FileMap } from '@decypher/diff';
import type { AgentAdapter, PlannedWrites } from './adapter';
import { MockAdapter } from './mock';

export interface BobConfig {
  apiBase: string;
  apiKey: string;
  model?: string;
  timeoutMs: number;
}

/** Read Bob settings from the environment. Returns null when not fully configured. */
export function readBobConfig(env: NodeJS.ProcessEnv = process.env): BobConfig | null {
  const apiBase = env.BOB_API_BASE?.trim();
  const apiKey = env.BOB_API_KEY?.trim();
  if (!apiBase || !apiKey) return null;
  return {
    apiBase: apiBase.replace(/\/+$/, ''),
    apiKey,
    model: env.BOB_MODEL?.trim() || undefined,
    timeoutMs: Number(env.BOB_TIMEOUT_MS ?? 60000),
  };
}

/** Minimal shape we ask Bob to return for a plan. */
interface BobPlanResponse {
  summary?: string;
  files?: Array<{ path?: string; action?: string; purpose?: string; dependsOn?: string[] }>;
}

function toAction(value: string | undefined): PlannedFileChange['action'] {
  return value === 'create' || value === 'delete' ? value : 'modify';
}

/**
 * Live IBM Bob 2.0 adapter. It performs the heavy lifting (repo understanding + code
 * generation) through Bob's agent endpoints and maps the response onto Decypher's
 * contracts. Crucially, if Bob is not configured or a call fails, it transparently
 * delegates to the deterministic MockAdapter so the demo never breaks on event day.
 */
export class BobAdapter implements AgentAdapter {
  readonly kind = 'bob' as const;
  private readonly fallback = new MockAdapter();

  constructor(private readonly config: BobConfig | null) {}

  get live(): boolean {
    return this.config !== null;
  }

  async producePlan(request: string, index: RepoIndex): Promise<ChangePlan> {
    if (!this.config) return this.fallback.producePlan(request, index);
    try {
      const data = await this.call<BobPlanResponse>('/plan', {
        model: this.config.model,
        request,
        files: index.filePaths,
        // Ask for a strict, human-readable plan the UI can render verbatim.
        instruction:
          'Return JSON: { summary: string, files: [{ path, action: create|modify|delete, purpose, dependsOn: string[] }] }. Do not edit any files yet.',
      });
      const files = (data.files ?? [])
        .filter((f) => typeof f.path === 'string')
        .map((f) => ({
          path: f.path as string,
          action: toAction(f.action),
          purpose: f.purpose ?? '',
          dependsOn: f.dependsOn ?? [],
        }));
      if (files.length === 0) return this.fallback.producePlan(request, index);
      return {
        id: newId('plan'),
        requestId: newId('req'),
        agent: 'bob',
        summary: data.summary ?? `Bob plan for: ${request}`,
        files,
        createdAt: Date.now(),
      };
    } catch (err) {
      console.warn('[decypher] Bob producePlan failed, using mock fallback:', (err as Error).message);
      return this.fallback.producePlan(request, index);
    }
  }

  async applyChange(plan: ChangePlan, currentFiles: FileMap): Promise<PlannedWrites> {
    if (!this.config) return this.fallback.applyChange(plan, currentFiles);
    try {
      // Contract: Bob returns { files: { "<path>": "<new content>" | null } }.
      const data = await this.call<{ files?: PlannedWrites }>('/apply', {
        model: this.config.model,
        plan,
        files: currentFiles,
      });
      if (!data.files || Object.keys(data.files).length === 0) {
        return this.fallback.applyChange(plan, currentFiles);
      }
      return data.files;
    } catch (err) {
      console.warn('[decypher] Bob applyChange failed, using mock fallback:', (err as Error).message);
      return this.fallback.applyChange(plan, currentFiles);
    }
  }

  /** POST to a Bob endpoint with a timeout and bearer auth. Throws on non-2xx. */
  private async call<T>(path: string, body: unknown): Promise<T> {
    const config = this.config as BobConfig;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const res = await fetch(`${config.apiBase}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}
