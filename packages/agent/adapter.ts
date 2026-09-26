import type { ChangePlan, RepoIndex } from '@decypher/core';
import type { FileMap } from '@decypher/diff';

/**
 * Files the agent wants to write during Stage 3.
 * value = new full content; null = delete the file.
 */
export type PlannedWrites = Record<string, string | null>;

/**
 * The seam between Decypher and whatever does the "heavy AI lifting".
 * Both IBM Bob 2.0 and the deterministic mock implement this. Keeping it tiny and
 * JSON-shaped is what lets the demo swap Bob for the mock instantly when the network
 * or keys misbehave at the event.
 */
export interface AgentAdapter {
  readonly kind: 'mock' | 'bob';

  /** Stage 1: read the repo index + request, produce a human-readable change plan. */
  producePlan(request: string, index: RepoIndex): Promise<ChangePlan>;

  /** Stage 3: given the approved plan and current file contents, return the writes to apply. */
  applyChange(plan: ChangePlan, currentFiles: FileMap): Promise<PlannedWrites>;
}
