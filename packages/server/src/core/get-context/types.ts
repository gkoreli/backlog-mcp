/**
 * Types for the relational-context stubs attached to `backlog_get` (ADR 0114).
 *
 * ADR 0114 folded the ADR 0074–0078 hydration pipeline's surviving stages
 * (relational expansion, cross-reference traversal, semantic enrichment)
 * into `get(context: true)`. The stages still speak `ContextEntity` /
 * `ContextResource` internally; the composer normalizes their output into
 * `ContextStub`s — id + title + status + type, hydratable with another get.
 */

import type { Status, EntityType } from '@backlog-mcp/shared';

// ── Stage currency (internal to the stages) ─────────────────────────

export type Fidelity = 'full' | 'summary' | 'reference';

export interface ContextEntity {
  id: string;
  title: string;
  status?: Status;
  type: EntityType;
  parent_id?: string;
  fidelity: Fidelity;
  /** Present when fidelity is 'full' */
  content?: string;
  /** Present when fidelity is 'full' and entity has evidence */
  evidence?: string[];
  /** Present when fidelity is 'full' and entity has blocked_reason */
  blocked_reason?: string[];
  /** Present when fidelity is 'full' or 'summary' and entity has references */
  references?: { url: string; title?: string }[];
  created_at?: string;
  updated_at?: string;
  /** Relevance score from semantic search. Present only for semantically discovered entities. */
  relevance_score?: number;
  /** Distance from focal entity in the relational graph (1 = direct, 2 = two hops). */
  graph_depth?: number;
}

export interface ContextResource {
  uri: string;
  title: string;
  /** Path relative to data directory */
  path: string;
  fidelity: Fidelity;
  /** Brief excerpt. Present at 'summary' and 'full' fidelity. */
  snippet?: string;
  /** Full content. Present at 'full' fidelity only. */
  content?: string;
  /** Relevance score from semantic search. Present only for semantically discovered resources. */
  relevance_score?: number;
}

// ── Composer output (the `get(context: true)` surface) ──────────────

/** One relational neighbor, minimal by design — hydrate with another get. */
export interface ContextStub {
  id: string;
  title: string;
  status?: string;
  /** Open substrate type — builtin (task/epic/...) or runtime (adr/requirement/...). */
  type: string;
  /** Compliance — present only on requirement stubs (ADR 0113.1 R-3): a violated constraint reads red without hydration. */
  compliance?: string;
  /** Relevance score — present only for semantically discovered stubs. */
  relevance_score?: number;
  /** Hops from the focal entity — present only for depth-2 relations. */
  graph_depth?: number;
}

/**
 * The focal entity's relational neighborhood, grouped by role (ADR 0114 R-1).
 * Groups are omitted when empty; `ancestors`/`descendants` appear only at depth 2.
 */
export interface ContextStubs {
  parent?: ContextStub;
  children?: ContextStub[];
  siblings?: ContextStub[];
  /** Entities the focal entity's references[] point to (forward). */
  references?: ContextStub[];
  /** Entities whose references[] point to the focal entity (reverse). */
  referenced_by?: ContextStub[];
  /** Semantically related entities not in the relational graph. */
  related?: ContextStub[];
  /** Ancestors beyond the direct parent — depth 2 only, closest-first. */
  ancestors?: ContextStub[];
  /** Descendants beyond direct children — depth 2 only. */
  descendants?: ContextStub[];
  /**
   * Typed relations declared as frontmatter fields (ADR 0113.1 R-3), keyed
   * by role — forward roles use the declared field name (respects, spawned,
   * violated_by…), reverse roles the computed counterpart (respected_by,
   * spawned_by…). Omitted when no typed relations touch the focal entity.
   */
  relations?: Record<string, ContextStub[]>;
}
