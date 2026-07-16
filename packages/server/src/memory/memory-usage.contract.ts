/** Durable usage fields consumed by memory ranking and feedback. */
export interface MemoryUsageSummary {
  usageCount: number;
  lastUsedAt?: string;
}

/** Storage boundary for a home's durable memory-usage summaries. */
export interface MemoryUsageSummaryStore {
  get(id: string): MemoryUsageSummary | undefined;
  set(id: string, summary: MemoryUsageSummary): void;
}
