/** Explicit search eligibility shared by fast paths and indexed queries. */
import { matchesDeclaredStatus } from '@backlog-mcp/shared';
import type { SearchOptions, SearchableType } from './types.js';

/** Caller types override inferred type; exclusions always intersect selection. */
export function matchesSearchSelection(
  item: { status?: unknown; parent_id?: unknown },
  type: SearchableType,
  filters?: SearchOptions['filters'],
  docTypes?: readonly SearchableType[],
): boolean {
  const types = docTypes ?? (filters?.type === undefined ? undefined : [filters.type]);
  return (types === undefined || types.includes(type))
    && !filters?.excludeTypes?.includes(type)
    && (filters?.parent_id === undefined || item.parent_id === filters.parent_id)
    && (filters?.status === undefined || filters.status.some(function matches(status) {
      return matchesDeclaredStatus(item.status, status);
    }));
}
