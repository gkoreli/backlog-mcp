/** Deterministic correction plan over a complete, freshly locked corpus. */
import type { Memory } from '@backlog-mcp/shared';
import { isMemoryLive } from './memory-validity.js';

export interface MemoryCorrectionPlan {
  successor: Memory;
  closures: Array<{ before: Memory; after: Memory }>;
}

/** Select each live predecessor once; preserve bodies and ADD-only lineage. */
export function planMemoryCorrection(successor: Memory, corpus: readonly Memory[], now: number): MemoryCorrectionPlan {
  const closedAt = new Date(now).toISOString();
  const closures = corpus.filter(function isPredecessor(memory) {
    return memory.id !== successor.id && isMemoryLive(memory, now)
      && (memory.id === successor.supersedes || (successor.state_key !== undefined && memory.state_key === successor.state_key));
  }).sort(function stableOrder(left, right) { return left.id.localeCompare(right.id); })
    .map(function closePredecessor(before) {
      return { before, after: { ...before, valid_until: closedAt, updated_at: closedAt } };
    });
  return { successor, closures };
}
