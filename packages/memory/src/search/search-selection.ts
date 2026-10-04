/** Constructed query selection shared by cached predicates and backend lowering (ADR 0136 R4). */
import { statusToken } from '@backlog-mcp/shared';
import type { SearchFilters, SearchableType } from './types.js';

/** Normalized vocabulary; explicit empty allowed sets select nothing. */
export interface SearchSelection {
  readonly types: { readonly mode: 'only' | 'except'; readonly values: readonly SearchableType[] };
  readonly statuses?: readonly string[];
  readonly parentId?: string;
}

/** Query mode supplies defaults; exact-ID navigation has no implicit memory exclusion. */
export interface SearchSelectionPolicy {
  readonly defaultExcludedTypes?: readonly SearchableType[];
  readonly entityOnly?: boolean;
}

/** Caller types override inferred type, exclusions intersect, and input arrays are copied. */
export function createSearchSelection(
  filters?: SearchFilters,
  docTypes?: readonly SearchableType[],
  policy: SearchSelectionPolicy = {},
): SearchSelection {
  const selected = docTypes ?? (filters?.type === undefined ? undefined : [filters.type]);
  const excluded = new Set(filters?.excludeTypes ?? []);
  // Historical entity-selection contract: an exclusion without a positive
  // type selection searches entities only. Explicit resource selection still
  // works; entity-only search never admits resources even if requested.
  if (policy.entityOnly || (selected === undefined && excluded.size > 0)) excluded.add('resource');
  if (selected === undefined) {
    for (const type of policy.defaultExcludedTypes ?? []) excluded.add(type);
  }
  const values = selected === undefined
    ? [...excluded]
    : [...new Set(selected)].filter(function eligible(type) { return !excluded.has(type); });
  const statuses = filters?.status === undefined ? undefined : [...new Set(filters.status.flatMap(function token(value) {
    const token = statusToken(value);
    return token === undefined ? [] : [token];
  }))];
  return Object.freeze({
    types: Object.freeze({ mode: selected === undefined ? 'except' as const : 'only' as const, values: Object.freeze(values) }),
    ...(statuses === undefined ? {} : { statuses: Object.freeze(statuses) }),
    // Empty parent text retains the indexed contract: no containment selection.
    ...(filters?.parent_id ? { parentId: filters.parent_id } : {}),
  });
}

/** Evaluate the same normalized selection that the backend lowers. */
export function matchesSearchSelection(
  item: { status?: unknown; parent_id?: unknown },
  type: SearchableType,
  selection: SearchSelection,
): boolean {
  const hasType = selection.types.values.includes(type);
  const status = statusToken(item.status);
  return (selection.types.mode === 'only' ? hasType : !hasType)
    && (selection.parentId === undefined || item.parent_id === selection.parentId)
    && (selection.statuses === undefined || (status !== undefined && selection.statuses.includes(status)));
}
