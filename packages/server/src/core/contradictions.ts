import { isMemoryLive } from './memory-validity.js';
/**
 * Contradiction detection — R-9 of the agentic memory initiative
 * (ADR 0092.13, implementing ADR 0092.5 R-9).
 *
 * The deterministic half of contradiction surfacing: a read-only fold that
 * finds memories which violate the state_key invariant. Per ADR 0092.5 R-2
 * (verified in memory-store-contract.test.ts), writing a memory with a
 * state_key soft-expires every live previous holder — so there is AT MOST
 * one live holder per key. Two live holders is the invariant breached
 * (direct store write, import, or a bug bypassing `remember`): a real
 * conflict worth a human's eyes.
 *
 * Detection only. Resolution is NEVER automatic (R-9, MemPalace's
 * 13-months-unshipped lesson): the agent/human acts through the existing
 * `remember` (supersedes / state_key) or `forget` verbs. This module has
 * no write path — it can show a contradiction, never revise a belief.
 *
 * Semantic collision candidates have their own advisory owner (ADR 0120);
 * they never become structural contradiction verdicts.
 */

import type { Memory } from '@backlog-mcp/shared';
import type { EntityCorpusReadPort } from './entity-corpus.contract.js';
import { readMemoryAnalysisView } from './memory-analysis.js';
import { createMemoryAnalysisView, type MemoryAnalysisView } from './memory-analysis-view.js';
import type {
  ContradictionGroup,
  ContradictionMember,
  ContradictionsResult,
} from './types.js';

function toMember(m: Memory): ContradictionMember {
  return {
    id: m.id,
    title: m.title,
    created_at: m.created_at,
    ...(m.valid_until ? { valid_until: m.valid_until } : {}),
    entity_refs: [...(m.entity_refs ?? [])],
    ...(m.source ? { source: m.source } : {}),
  };
}

/**
 * Pure fold (ADR 0092.13): group LIVE memories by state_key; keep groups of
 * ≥2 — each is a breach of the one-live-holder-per-key invariant (R-2), i.e.
 * a contradiction set. Members are ordered newest-first so the most recent
 * (likely-correct) belief leads; groups are ordered by their newest member,
 * most recent contradiction first, then by key for stability.
 */
export function groupByStateKey(
  memories: readonly Memory[],
  opts: { now: number },
): ContradictionGroup[] {
  return contradictionGroups(createMemoryAnalysisView(memories, opts.now));
}

/** Structural fold over one complete observation, sharing its live-holder index. */
export function contradictionGroups(view: MemoryAnalysisView): ContradictionGroup[] {
  const groups: ContradictionGroup[] = [];
  for (const state_key of view.stateKeys) {
    const members = view.holders(state_key);
    if (members.length < 2) continue;
    const sorted = [...members].sort(function newestFirst(a, b) {
      return Date.parse(b.created_at) - Date.parse(a.created_at);
    });
    const newest = sorted[0];
    if (newest === undefined) continue;
    groups.push({ state_key, members: sorted.map(toMember), count: sorted.length, newest_created_at: newest.created_at });
  }
  groups.sort(function newestGroupFirst(a, b) {
    const difference = Date.parse(b.newest_created_at) - Date.parse(a.newest_created_at);
    return difference !== 0 ? difference : a.state_key.localeCompare(b.state_key);
  });
  return groups;
}

/**
 * Complete-read orchestration at a supplied observation time; no display-list fallback.
 */
export async function detectContradictions(
  reader: Partial<EntityCorpusReadPort>,
  now: number,
): Promise<ContradictionsResult> {
  const view = await readMemoryAnalysisView(reader, now);
  const groups = contradictionGroups(view);
  return {
    groups,
    total_live_keyed: view.live.filter(function keyed(memory) { return Boolean(memory.state_key); }).length,
    contradiction_count: groups.length,
  };
}

/**
 * The OTHER live holders of a memory's state_key — the per-memory view that
 * powers the viewer's `contradicts` field and contradiction chip. Empty when
 * the memory has no key, is expired, or is the sole holder (no conflict).
 */
export async function contradictsFor(
  reader: Partial<EntityCorpusReadPort>,
  memory: Memory,
  now: number,
): Promise<string[]> {
  if (!memory.state_key || !isMemoryLive(memory, now)) return [];
  return contradictsInView(await readMemoryAnalysisView(reader, now), memory);
}

/** Detail authority may be newer than the corpus; compare its key against observed holders. */
export function contradictsInView(view: MemoryAnalysisView, memory: Memory): string[] {
  if (!memory.state_key || !isMemoryLive(memory, view.now)) return [];
  return view.holders(memory.state_key).filter(function other(holder) { return holder.id !== memory.id; })
    .map(function identity(holder) { return holder.id; });
}
