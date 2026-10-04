/** Pure read projection, including the named malformed-date policy. */
import type { Memory } from '@backlog-mcp/shared';
import type { MemoryEntry, MemoryLayer } from '@backlog-mcp/memory';
import { memoryValidity } from './memory-validity.js';
import { memoryEntryUsageMetadata } from './memory-entry-usage.js';
export interface MemoryUsageSummary { usageCount: number; lastUsedAt?: string }

export function mintMemoryEntry(
  m: Memory,
  usageSummary?: MemoryUsageSummary,
  now: number = Date.now(),
): MemoryEntry {
  const validity = memoryValidity(m.valid_until, now);
  const usageCount = usageSummary?.usageCount ?? m.usage_count ?? 0;
  const lastUsedAt = usageSummary === undefined
    ? m.last_used_at
    : usageSummary.lastUsedAt;
  return {
    id: m.id,
    title: m.title,
    content: m.content,
    layer: (m.layer ?? 'episodic') as MemoryLayer,
    source: m.source ?? 'unknown',
    ...(m.parent_id ? { context: m.parent_id } : {}),
    ...(m.tags ? { tags: [...m.tags] } : {}),
    // Corrupt created_at reads as "now" (age 0) — the single malformed-date
    // policy for all read surfaces; never epoch, which would grant a broken
    // record ~56 years of "age".
    createdAt: Number.isNaN(Date.parse(m.created_at)) ? now : Date.parse(m.created_at),
    ...(validity.expiresAt === undefined ? {} : { expiresAt: validity.expiresAt }),
    metadata: {
      ...(validity.state === 'invalid' ? { invalid_valid_until: m.valid_until } : {}),
      ...(m.entity_refs?.[0] ? { entity_id: m.entity_refs[0] } : {}),
      ...(m.entity_refs ? { entity_refs: [...m.entity_refs] } : {}),
      ...(m.supersedes ? { supersedes: m.supersedes } : {}),
      ...(m.state_key ? { state_key: m.state_key } : {}),
      ...(m.kind ? { memory_kind: m.kind } : {}),
      ...(m.occurred_at ? { occurred_at: m.occurred_at } : {}),
      ...(m.derived === true ? { derived: true } : {}),
      ...memoryEntryUsageMetadata(usageCount, lastUsedAt),
      ...(m.tags?.includes('completion') ? { kind: 'completion' } : m.tags?.includes('artifact') ? { kind: 'artifact' } : {}),
    },
  };
}
