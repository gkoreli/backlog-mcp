/** Authoritative detail reads and optional same-observation memory analysis. */
import type { AnyEntity, Memory } from '@backlog-mcp/shared';
import type { MemoryEntry } from '@backlog-mcp/memory';
import type { IBacklogService } from './backlog-service.contract.js';
import type { MemoryAnalysisReader } from './memory-analysis.js';
import { createEntityReferenceReader } from './entity-references.js';
import { readMemoryAnalysisView } from './memory-analysis.js';
import type { MemoryAnalysisView } from './memory-analysis-view.js';
import { contradictsInView } from './contradictions.js';
import { collisionCandidatesInView } from './collision-candidates.js';
import type { CollisionCandidate } from './types.js';
import { isMemoryLive } from './memory-validity.js';
import { asBuiltinEntity } from './substrates/index.js';
import { memoryUsageFieldsFromEntry } from './memory-entry-usage.js';
import { usageSeries, hasUsage } from './usage-series.js';

/** Bounded children, authoritative references and complete analysis are distinct reads. */
export type EntityDetailReader = Pick<IBacklogService, 'get' | 'getMarkdown' | 'list'> & MemoryAnalysisReader;
export interface EntityDetailObservation {
  now: number;
  childLimit: number;
  readUsageLines?: () => string[];
  mintMemoryEntry?: (memory: Memory, now: number) => MemoryEntry;
}
export interface EntityDetail {
  entity: AnyEntity;
  raw: string | null;
  children: AnyEntity[];
  parentTitle?: string;
  contradicts?: string[];
  collision_candidates?: CollisionCandidate[];
  usage_series?: number[];
}

/** Usage summaries take precedence, including removal of a stale native last-used value. */
export function projectEntityUsage(
  entity: AnyEntity,
  mint: EntityDetailObservation['mintMemoryEntry'],
  now: number,
): AnyEntity {
  const builtin = asBuiltinEntity(entity);
  if (builtin?.type !== 'memory' || mint === undefined) return entity;
  const memory = { ...builtin };
  delete memory.usage_count;
  delete memory.last_used_at;
  return Object.assign(memory, memoryUsageFieldsFromEntry(mint(builtin, now)));
}

/** Reusable by cold consumers; HTTP alone attaches provenance and response presentation. */
export async function readEntityDetail(
  reader: EntityDetailReader,
  id: string,
  observation: EntityDetailObservation,
): Promise<EntityDetail | undefined> {
  const reference = createEntityReferenceReader(reader);
  let observed: Promise<MemoryAnalysisView> | undefined;
  function memoryView(): Promise<MemoryAnalysisView> {
    observed ??= readMemoryAnalysisView(reader, observation.now);
    return observed;
  }
  const entity = await reference(id);
  if (entity === undefined) return undefined;
  const raw = await reader.getMarkdown(id);
  const children = await reader.list({ parent_id: id, limit: observation.childLimit });
  const parentId = typeof entity.parent_id === 'string' ? entity.parent_id : undefined;
  const parentTitle = parentId ? (await reference(parentId))?.title : undefined;
  const detail: EntityDetail = { entity, raw, children, parentTitle };
  if (entity.type === 'memory') {
    const memory = entity as Memory;
    // Live keyed analysis is required. Do not move this read into advisory recovery.
    if (memory.state_key && isMemoryLive(memory, observation.now)) {
      const conflicts = contradictsInView(await memoryView(), memory);
      if (conflicts.length > 0) detail.contradicts = conflicts;
    }
    try {
      detail.collision_candidates = await collisionCandidatesInView(reader, await memoryView(), id);
    } catch {
      // Missing complete reads/search are advisory here. Omit rather than claim a clean scan.
    }
    if (observation.readUsageLines !== undefined) {
      const series = usageSeries(observation.readUsageLines(), id, { now: observation.now });
      if (hasUsage(series)) detail.usage_series = series;
    }
  }
  detail.entity = projectEntityUsage(entity, observation.mintMemoryEntry, observation.now);
  return detail;
}
