/** Registry-owned relation edges shared by integrity and disclosure (ADR 0113.4). */
import type { CompiledSubstrateRelation } from './substrate-intent.types.js';

export interface CompiledSubstrateRelationEdge extends CompiledSubstrateRelation {
  readonly sourceType: string;
  readonly inverse?: string;
}
