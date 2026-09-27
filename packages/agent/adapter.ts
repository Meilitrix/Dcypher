import type { ChangePlan, FileDiff, RepoIndex } from '@decypher/core';
import type { FileMap } from '@decypher/diff';

/**
 * A single turn in a conversation history passed to the chat method.
 */
export interface ConversationTurn {
  role: 'user' | 'assistant';
  text: string;
}

/**
 * Which engine actually produced a chat reply. When the live agent is configured but a
 * call fails, BobAdapter falls back to the mock and reports `source: 'mock'` so the UI
 * can label it honestly instead of silently pretending to be the live AI.
 */
export type ReplySource = 'bob' | 'mock';

/** A chat answer plus the source that produced it. */
export interface ChatReply {
  text: string;
  source: ReplySource;
}

/**
 * Files the agent wants to write during Stage 3.
 * value = new full content; null = delete the file.
 */
export type PlannedWrites = Record<string, string | null>;

/**
 * What the agent returns from producePlan: the structured plan
 * plus a plain-English narrative the user can read in the chat thread.
 */
export interface PlanResult {
  plan: ChangePlan;
  /** One or two sentences explaining what this change will do and why those files are touched. */
  narrative: string;
}

/**
 * The seam between Decypher and whatever does the "heavy AI lifting".
 * Both IBM Bob 2.0 and the deterministic mock implement this. Keeping it tiny and
 * JSON-shaped is what lets the demo swap Bob for the mock instantly when the network
 * or keys misbehave at the event.
 */
export interface AgentAdapter {
  readonly kind: 'mock' | 'bob';

  /** Stage 1: read the repo index + request, produce a change plan and a chat narrative. */
  producePlan(request: string, index: RepoIndex): Promise<PlanResult>;

  /** Stage 3: given the approved plan and current file contents, return the writes to apply. */
  applyChange(plan: ChangePlan, currentFiles: FileMap): Promise<PlannedWrites>;

  /**
   * Stage 3 narration: given the actual changed files (with line diffs), produce a
   * plain-English summary of what concretely changed — what the user will notice.
   */
  narrateDiff(files: FileDiff[]): Promise<string>;

  /**
   * Free-form Q&A: user asks a question about the codebase or anything else.
   * Returns a plain-English answer plus which engine produced it. Does NOT trigger any plan or file write.
   */
  chat(message: string, index: RepoIndex, history: ConversationTurn[]): Promise<ChatReply>;
}
