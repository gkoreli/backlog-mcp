import type { MemoryEntry } from '@backlog-mcp/memory';

export interface MemoryUsageFields {
  usage_count: number;
  last_used_at?: string;
}

/** Convert the store-boundary metadata shape to entity/usage-signal fields. */
export function memoryUsageFieldsFromEntry(
  entry: MemoryEntry,
): MemoryUsageFields {
  const metadata = entry.metadata ?? {};
  const lastUsedAt = metadata.last_used_at;
  return {
    usage_count: typeof metadata.usageCount === 'number'
      ? metadata.usageCount
      : 0,
    ...(typeof lastUsedAt === 'string'
      ? { last_used_at: lastUsedAt }
      : {}),
  };
}

/** Build the one canonical usage fragment carried by MemoryEntry metadata. */
export function memoryEntryUsageMetadata(
  usageCount: number,
  lastUsedAt: string | undefined,
): Record<string, unknown> {
  return {
    usageCount,
    ...(lastUsedAt === undefined ? {} : { last_used_at: lastUsedAt }),
  };
}
