import type { MemoryUsageSummary } from '../core/memory-entry.js';
export type { MemoryUsageSummary } from '../core/memory-entry.js';

/** Storage boundary for a home's durable memory-usage summaries. */
export interface MemoryUsageSummaryStore {
  get(id: string): MemoryUsageSummary | undefined;
  set(id: string, summary: MemoryUsageSummary): void;
}
