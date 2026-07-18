import { statusToken } from '@backlog-mcp/shared';
import type { SearchOptions } from './types.js';
import { EMBEDDING_DIMENSIONS } from './embedding-service.js';

// ── Orama document types ────────────────────────────────────────────

export type OramaDoc = {
  id: string;
  title: string;
  content: string;
  status: string;
  type: string;
  parent_id: string;
  evidence: string;
  blocked_reason: string;
  references: string;
  search_text: string;
  path: string;
  updated_at: string;  // ADR-0080: for native sortBy
};

export type OramaDocWithEmbeddings = OramaDoc & {
  embeddings: number[];
};

// ── Orama schema definitions ────────────────────────────────────────

export const schema = {
  id: 'string',
  title: 'string',
  content: 'string',
  status: 'enum',
  type: 'enum',
  parent_id: 'enum',
  evidence: 'string',
  blocked_reason: 'string',
  references: 'string',
  search_text: 'string',
  path: 'string',
  updated_at: 'string',  // ADR-0080: enables native sortBy for "recent" mode
} as const;

export const schemaWithEmbeddings = {
  ...schema,
  embeddings: `vector[${EMBEDDING_DIMENSIONS}]`,
} as const;

export type OramaInstance = import('@orama/orama').Orama<typeof schema>;
export type OramaInstanceWithEmbeddings = import('@orama/orama').Orama<typeof schemaWithEmbeddings>;

/** Bump when tokenizer or schema changes to force index rebuild. */
export const INDEX_VERSION = 9;  // REF-0016: compose-don't-replace tokenizer (stemming + stop-words) + cold-write embeddings backfill

// ── Search constants ────────────────────────────────────────────────

/**
 * Text-searchable properties (ADR-0079). Excludes enum fields (status, type, parent_id)
 * which are filtered via `where` clause, not full-text searched.
 * Also excludes updated_at which is only used for sorting.
 *
 * ADR-0083 #4: `id` is excluded. Every ID tokenizes to its type prefix
 * ("TASK-0009" → "task"), so any query containing "task"/"epic" matched every
 * document of that type through the ID field — pure ranking noise. ID-shaped
 * queries are handled *before* BM25 by the query-intent parser (id_lookup
 * short-circuit), which is both exact and cheaper.
 */
export const TEXT_PROPERTIES = ['title', 'content', 'evidence', 'blocked_reason', 'references', 'search_text', 'path'] as const;

/**
 * Properties that should NOT have sort indexes (ADR-0080).
 * Only `updated_at` needs a sort index for native "recent" mode.
 */
export const UNSORTABLE_PROPERTIES = ['id', 'title', 'content', 'evidence', 'blocked_reason', 'references', 'search_text', 'path'] as const;

/**
 * Facet configuration for enum fields (ADR-0080).
 * Orama returns counts per value automatically for enum facets.
 */
export const ENUM_FACETS = { status: {}, type: {}, parent_id: {} } as const;

// ── Where clause builder ────────────────────────────────────────────

/**
 * Build Orama `where` clause from SearchOptions filters and docTypes (ADR-0079).
 * Returns undefined if no filters apply (Orama treats undefined where as no filter).
 *
 * Precedence (ADR-0083 #6, documented behavior): when both `filters.type` and
 * `docTypes` are provided, `docTypes` wins — it is the caller-facing tool
 * parameter, while `filters.type` may come from parsed query intent. Same for
 * `parent_id` is the canonical containment filter.
 */
export function buildWhereClause(filters?: SearchOptions['filters'], docTypes?: import('./types.js').SearchableType[]): Record<string, any> | undefined {
  const where: Record<string, any> = {};
  if (filters?.status?.length) {
    // Declared statuses index as their leading token (BUG-0003), so the
    // filter values normalize through the same shared rule. Values that
    // don't tokenize match nothing (fail-closed, like the wakeup seams).
    where.status = {
      in: filters.status
        .map(value => statusToken(value))
        .filter((token): token is string => token !== undefined),
    };
  }
  if (filters?.type) where.type = { eq: filters.type };
  if (filters?.parent_id) where.parent_id = { eq: filters.parent_id };
  if (docTypes?.length) where.type = { in: docTypes };
  return Object.keys(where).length > 0 ? where : undefined;
}
