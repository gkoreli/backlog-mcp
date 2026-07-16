import type { z } from 'zod';

export type JsonScalar = string | number | boolean | null;
export type JsonValue =
  | JsonScalar
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type SubstrateRelationCardinality =
  | 'one'
  | 'zero-or-one'
  | 'many';

export interface CompiledFieldBinding {
  readonly input: string;
  readonly field: string;
}

export interface CompiledSubstrateRelation {
  readonly field: string;
  readonly cardinality: SubstrateRelationCardinality;
  readonly targets: readonly string[];
}

export interface CompiledSubstrateTransition {
  readonly field: string;
  readonly from: readonly JsonScalar[];
  readonly to: JsonScalar;
}

export type CompiledSubstrateIntentOperation =
  | {
    readonly kind: 'create';
    /** Invocation-controlled values applied before fixedFields. */
    readonly fields: readonly CompiledFieldBinding[];
    /** Compiler-owned assignments applied last and therefore unoverrideable. */
    readonly fixedFields: Readonly<Record<string, JsonValue>>;
  }
  | {
    readonly kind: 'transition';
    readonly subjectInput: 'id';
    readonly transition: CompiledSubstrateTransition;
    readonly fields: readonly CompiledFieldBinding[];
  }
  | {
    readonly kind: 'set-field';
    readonly subjectInput: 'id';
    readonly field: string;
    readonly value: JsonScalar;
  }
  | {
    readonly kind: 'relate' | 'append-relation';
    readonly sourceInput: string;
    readonly targetInput: string;
    readonly relation: CompiledSubstrateRelation;
  }
  | {
    readonly kind: 'relate-and-transition';
    readonly sourceInput: string;
    readonly targetInput: string;
    readonly relation: CompiledSubstrateRelation;
    readonly targetTransition: CompiledSubstrateTransition;
  };

/**
 * Safe compiler output consumed by the server's intent registry port.
 *
 * Names, input validation, and operation mechanics are resolved here so
 * transports never reopen project-authored declarations.
 */
export interface CompiledSubstrateIntent {
  readonly sourcePath: string;
  readonly substrateType: string;
  readonly verb: string;
  readonly toolName: string;
  readonly description: string;
  readonly intentInputSchema: z.ZodObject;
  readonly operation: CompiledSubstrateIntentOperation;
}
