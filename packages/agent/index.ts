import type { AgentKind } from '@decypher/core';
import type { AgentAdapter } from './adapter';
import { MockAdapter } from './mock';
import { BobAdapter, readBobConfig } from './bob';

/**
 * @decypher/agent public entry: the adapter contract + a factory that never fails.
 * If "bob" is requested but not configured, it still returns a BobAdapter which
 * internally falls back to the mock, so callers get a working plan either way.
 */
export type { AgentAdapter, PlannedWrites } from './adapter';
export { MockAdapter } from './mock';
export { BobAdapter, readBobConfig } from './bob';

export function createAdapter(kind: AgentKind): AgentAdapter {
  if (kind === 'bob') return new BobAdapter(readBobConfig());
  return new MockAdapter();
}
