import type { JsonScalar } from './substrate-intent.types.js';
import type { CompiledSubstrateRelationEdge } from './substrate-relation.types.js';

export interface CompiledSubstrateSearchDisclosure {
  readonly fields: readonly string[];
}

export interface CompiledSubstrateRecallDisclosure {
  readonly projection: readonly string[];
}

export interface CompiledSubstrateGetDisclosure {
  readonly relations: readonly string[];
}

export interface CompiledSubstrateWakeupDisclosure {
  readonly section: string;
  readonly includeStatuses: readonly JsonScalar[];
  readonly limit: number;
  readonly projection: readonly string[];
}

/** Safe, field-resolved progressive-disclosure plan for one substrate. */
export interface CompiledSubstrateDisclosure {
  readonly discovery?: { readonly projection: readonly string[] };
  readonly search?: CompiledSubstrateSearchDisclosure;
  readonly recall?: CompiledSubstrateRecallDisclosure;
  readonly get?: CompiledSubstrateGetDisclosure;
  readonly wakeup?: CompiledSubstrateWakeupDisclosure;
}

/**
 * One declared relation exposed through `get(context: true)`.
 *
 * The registry owns this resolved edge table so retrieval code never reopens
 * project-authored definitions or hardcodes flagship substrate relations.
 */
export type CompiledDisclosureRelation = CompiledSubstrateRelationEdge;
