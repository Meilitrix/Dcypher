/**
 * @decypher/core 的统一出口：共享类型 + 极少量跨包复用的小工具。
 */
export * from './types';

/** Generate a short id for plans / rules / sessions and other entities. */
export function newId(prefix = 'id'): string {
  const rand = Math.random().toString(36).slice(2, 8);
  const time = Date.now().toString(36).slice(-4);
  return `${prefix}_${time}${rand}`;
}
