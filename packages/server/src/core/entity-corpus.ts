/** Complete-read capability checks and pure eligibility (ADR 0135 R1). */
import { matchesDeclaredStatus, type AnyEntity } from '@backlog-mcp/shared';
import type { EntityCorpusFilter, EntityCorpusReadPort } from './entity-corpus.contract.js';

export class CorpusReadUnavailableError extends Error {
  constructor() {
    super('This runtime cannot read the complete entity corpus; use a local backlog home.');
    this.name = 'CorpusReadUnavailableError';
  }
}

/** Never substitute a bounded display page for a complete repository read. */
export async function readEntityCorpus(
  reader: Partial<EntityCorpusReadPort>,
  filter?: EntityCorpusFilter,
): Promise<AnyEntity[]> {
  if (reader.scan === undefined) throw new CorpusReadUnavailableError();
  return reader.scan(filter);
}

/** Select eligible entities before ordering or pagination. */
export function selectEntityCorpus(
  entities: Iterable<AnyEntity>,
  filter: EntityCorpusFilter = {},
): AnyEntity[] {
  return Array.from(entities).filter(function isEligible(entity) {
    return matchesEntityFilter(entity, filter);
  });
}

/** Eligibility shared by document pagination and complete snapshots. */
export function matchesEntityFilter(entity: AnyEntity, filter: EntityCorpusFilter): boolean {
  return (filter.type === undefined || entity.type === filter.type)
    && (filter.parent_id === undefined || entity.parent_id === filter.parent_id)
    && !filter.excludeTypes?.includes(entity.type)
    && (filter.status === undefined || filter.status.some(function matches(status) {
      return matchesDeclaredStatus(entity.status, status);
    }));
}
