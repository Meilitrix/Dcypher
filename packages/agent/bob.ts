import type { ChangePlan, FileDiff, PlannedFileChange, RepoIndex } from '@decypher/core';
import { newId } from '@decypher/core';
import type { FileMap } from '@decypher/diff';
import type { AgentAdapter, ChatReply, ConversationTurn, PlannedWrites, PlanResult } from './adapter';
import { MockAdapter } from './mock';

export interface BobConfig {
  apiBase: string;
  apiKey: string;
  model: string;
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
    model: env.BOB_MODEL?.trim() || 'premium',
    timeoutMs: Number(env.BOB_TIMEOUT_MS ?? 60000),
  };
}

/**
 * Shape of a single message in the OpenAI-compatible messages array.
 * Bob's /chat/completions endpoint uses this format.
 */
interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Minimal slice of the OpenAI chat completions response we actually use. */
interface ChatCompletionResponse {
  choices?: Array<{
    message?: { content?: string };
  }>;
}

function toAction(value: string | undefined): PlannedFileChange['action'] {
  return value === 'create' || value === 'delete' ? value : 'modify';
}

/**
 * Try to parse the assistant's reply as JSON.
 * Bob is asked to return only JSON, but occasionally wraps it in a ```json fence.
 * This helper strips any markdown fence before parsing.
 */
function parseJson<T>(raw: string): T {
  const stripped = raw.trim().replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/, '').trim();
  return JSON.parse(stripped) as T;
}

/**
 * Live IBM Bob 2.0 adapter.
 *
 * Calls Bob's OpenAI-compatible /chat/completions endpoint.
 * Auth header: "Apikey <key>" (IBM Cloud style, not Bearer).
 * Model: "premium" by default (override with BOB_MODEL env var).
 *
 * All three operations (producePlan, applyChange, narrateDiff) use the same
 * chat completions call pattern: system prompt sets the role and JSON contract,
 * user prompt provides the data. On any error the mock adapter is used as
 * fallback so the demo never breaks.
 */
export class BobAdapter implements AgentAdapter {
  readonly kind = 'bob' as const;
  private readonly fallback = new MockAdapter();

  constructor(private readonly config: BobConfig | null) {}

  get live(): boolean {
    return this.config !== null;
  }

  // ── producePlan ──────────────────────────────────────────────────────────

  async producePlan(request: string, index: RepoIndex): Promise<PlanResult> {
    if (!this.config) return this.fallback.producePlan(request, index);
    try {
      const systemPrompt =
        'You are a code-change planning assistant for the Decypher tool. ' +
        'Your job is to analyse a codebase file list and a user request, then produce a structured change plan. ' +
        'Reply with ONLY valid JSON — no prose before or after, no markdown fences. ' +
        'Schema: { "summary": string, "narrative": string, "files": [ { "path": string, "action": "create"|"modify"|"delete", "purpose": string, "description": string, "dependsOn": string[] } ] }. ' +
        '"summary" is one sentence describing the overall change. ' +
        '"narrative" is 2–3 sentences explaining what the change will do and why those files are involved — written for a non-technical user. ' +
        '"files" lists every file that must change. Only include files from the provided list (you may add new files for "create" actions). ' +
        'Do not write any code. Do not modify files. Plan only.';

      const userPrompt =
        `User request: ${request}\n\n` +
        `Repository files:\n${index.filePaths.map((p) => `  ${p}`).join('\n')}`;

      const raw = await this.chat_call([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ]);

      const data = parseJson<{
        summary?: string;
        narrative?: string;
        files?: Array<{ path?: string; action?: string; purpose?: string; description?: string; dependsOn?: string[] }>;
      }>(raw);

      const files = (data.files ?? [])
        .filter((f) => typeof f.path === 'string')
        .map((f) => ({
          path: f.path as string,
          action: toAction(f.action),
          purpose: f.purpose ?? '',
          description: f.description ?? '',
          dependsOn: f.dependsOn ?? [],
        }));

      if (files.length === 0) {
        console.warn('[decypher] Bob returned an empty file list — using mock fallback.');
        return this.fallback.producePlan(request, index);
      }

      const plan: ChangePlan = {
        id: newId('plan'),
        requestId: newId('req'),
        agent: 'bob',
        summary: data.summary?.trim() || `Bob plan for: ${request}`,
        files,
        createdAt: Date.now(),
      };

      const narrative =
        data.narrative?.trim() ||
        `I've planned ${files.length} file change(s) to fulfil: "${request}".`;

      return { plan, narrative };
    } catch (err) {
      console.warn('[decypher] Bob producePlan failed, using mock fallback:', (err as Error).message);
      return this.fallback.producePlan(request, index);
    }
  }

  // ── applyChange ──────────────────────────────────────────────────────────

  async applyChange(plan: ChangePlan, currentFiles: FileMap): Promise<PlannedWrites> {
    if (!this.config) return this.fallback.applyChange(plan, currentFiles);
    try {
      // Only send the files the plan intends to touch — keeps the prompt small.
      const relevantFiles: FileMap = {};
      for (const f of plan.files) {
        if (f.action !== 'create' && f.path in currentFiles) {
          relevantFiles[f.path] = currentFiles[f.path];
        }
      }

      const systemPrompt =
        'You are a code-editing assistant for the Decypher tool. ' +
        'You will receive a change plan and the current contents of every file the plan touches. ' +
        'Apply the plan precisely. Reply with ONLY valid JSON — no prose, no markdown fences. ' +
        'Schema: { "files": { "<relative-path>": "<full new file content as a string>" } }. ' +
        'For a "delete" action set the value to null. ' +
        'For a "create" action provide the full new file content. ' +
        'For a "modify" action provide the complete new file content (not a diff). ' +
        'Include ONLY the files listed in the plan. Do not change any other file.';

      const userPrompt =
        `Change plan summary: ${plan.summary}\n\n` +
        `Files to change:\n${plan.files.map((f) => `  ${f.action} ${f.path} — ${f.purpose}`).join('\n')}\n\n` +
        `Current file contents:\n` +
        Object.entries(relevantFiles)
          .map(([p, c]) => `--- ${p} ---\n${c}`)
          .join('\n\n');

      const raw = await this.chat_call([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ]);

      const data = parseJson<{ files?: PlannedWrites }>(raw);

      if (!data.files || Object.keys(data.files).length === 0) {
        console.warn('[decypher] Bob returned no file writes — using mock fallback.');
        return this.fallback.applyChange(plan, currentFiles);
      }

      // Guard: only emit entries the plan explicitly lists.
      const scoped: PlannedWrites = {};
      for (const f of plan.files) {
        if (f.path in data.files) scoped[f.path] = data.files[f.path];
      }
      if (Object.keys(scoped).length === 0) return this.fallback.applyChange(plan, currentFiles);

      return scoped;
    } catch (err) {
      console.warn('[decypher] Bob applyChange failed, using mock fallback:', (err as Error).message);
      return this.fallback.applyChange(plan, currentFiles);
    }
  }

  // ── chat ─────────────────────────────────────────────────────────────────

  async chat(message: string, index: RepoIndex, history: ConversationTurn[]): Promise<ChatReply> {
    if (!this.config) return this.fallback.chat(message, index, history);
    try {
      const systemPrompt =
        'You are a capable AI coding assistant embedded in a tool called Decypher. ' +
        'The user is working on a real code project and asks you to explain how it works: ' +
        'what a specific file does, where something is implemented, how pieces connect, and what depends on what. ' +
        'Answer like a senior engineer: thorough and specific. Use the file contents and line numbers provided in the message ' +
        'to point to exact locations (e.g. "in src/store.js, line 12..."). Prefer a few clear sentences or a short ' +
        'structured list over a single terse line — do NOT artificially limit yourself to 2-4 sentences. ' +
        'When asked about dependencies or flow, describe which files call which and why. ' +
        'Reply with plain conversational text (Markdown is fine) — never raw JSON for this endpoint. ' +
        'If the user actually wants a code change rather than an explanation, acknowledge it and ask them to send it as a change request.';

      const fileList = index.filePaths.map((p) => `  ${p}`).join('\n');
      const messages: ChatMessage[] = [
        {
          role: 'system',
          content: `${systemPrompt}\n\nProject files:\n${fileList}`,
        },
        // Inject conversation history so Bob has context.
        ...history.map((t) => ({ role: t.role, content: t.text }) satisfies ChatMessage),
        { role: 'user', content: message },
      ];

      const raw = await this.chat_call(messages);
      const text = raw.trim();
      if (!text) return this.fallback.chat(message, index, history);
      return { text, source: 'bob' };
    } catch (err) {
      console.warn('[decypher] Bob chat failed, using mock fallback:', (err as Error).message);
      return this.fallback.chat(message, index, history);
    }
  }

  // ── narrateDiff ──────────────────────────────────────────────────────────

  async narrateDiff(files: FileDiff[]): Promise<string> {
    if (!this.config) return this.fallback.narrateDiff(files);
    try {
      const systemPrompt =
        'You are a code-change narrator for the Decypher tool. ' +
        'You will receive a summary of what changed in a codebase after an AI agent applied a plan. ' +
        'Explain the changes in plain English for a non-technical user: what they will see or notice differently in the running app. ' +
        'Be specific about values, labels, colours, or behaviours that changed. ' +
        'Reply with ONLY valid JSON — no prose, no markdown fences. ' +
        'Schema: { "narrative": string }. ' +
        '"narrative" should be 2–4 sentences.';

      const diffSummary = files
        .map((f) => `${f.action} ${f.path}: +${f.added} -${f.removed} lines. Reason: ${f.whyChanged}`)
        .join('\n');

      const userPrompt = `Changes applied:\n${diffSummary}`;

      const raw = await this.chat_call([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ]);

      const data = parseJson<{ narrative?: string }>(raw);
      const text = data.narrative?.trim();
      if (!text) return this.fallback.narrateDiff(files);
      return text;
    } catch (err) {
      console.warn('[decypher] Bob narrateDiff failed, using mock fallback:', (err as Error).message);
      return this.fallback.narrateDiff(files);
    }
  }

  // ── internal: chat completions call ─────────────────────────────────────

  /**
   * POST to Bob's /chat/completions endpoint (OpenAI-compatible format).
   * Auth: "Apikey <key>" — the IBM Cloud convention, not Bearer.
   * Returns the raw string content of choices[0].message.content.
   * Throws on network error, non-2xx, or empty response — caller catches and falls back.
   */
  private async chat_call(messages: ChatMessage[]): Promise<string> {
    const config = this.config as BobConfig;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const res = await fetch(`${config.apiBase}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Apikey ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          // Ask for a single deterministic completion — temperature 0 makes
          // the JSON output as consistent as possible.
          temperature: 0,
          max_tokens: 4096,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}${errText ? ': ' + errText.slice(0, 120) : ''}`);
      }

      const completion = (await res.json()) as ChatCompletionResponse;
      const content = completion.choices?.[0]?.message?.content?.trim();
      if (!content) throw new Error('Bob returned an empty completion.');
      return content;
    } finally {
      clearTimeout(timer);
    }
  }
}
