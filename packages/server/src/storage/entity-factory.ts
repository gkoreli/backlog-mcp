/**
 * entity-factory.ts — Server-only factory for creating entities.
 *
 * Validation authority: shared `EntitySchema` (discriminated union of all
 * substrate schemas). The factory assembles a plain object with the requested
 * type, then `EntitySchema.parse()` verifies shape, applies substrate
 * defaults (e.g. Cron.enabled = true), and rejects cross-type field leakage.
 *
 * The input type is DERIVED from the union (`z.input<typeof EntitySchema>`)
 * rather than hand-maintained — the union is the single source of truth for
 * which fields each type accepts. See ADR 0106.2 §3.
 *
 * Types and ID utilities live in @backlog-mcp/shared.
 */
import { z } from 'zod';
import { EntitySchema, EntityType, type Entity } from '@backlog-mcp/shared';

/** The raw input shape of the whole union (pre-parse, pre-defaults). */
type EntityInput = z.input<typeof EntitySchema>;

/**
 * Union of every key across every union member. `keyof (A | B)` yields only the
 * *common* keys; distributing over a naked type parameter yields `keyof A |
 * keyof B`. (Conditional types only distribute over naked params, not concrete
 * aliases — hence the generic `T`.)
 */
type KeysOfUnion<T> = T extends unknown ? keyof T : never;

/** Value type of key `K` across whichever union members of `T` carry it. */
type ValueOfUnion<T, K extends PropertyKey> =
  T extends unknown ? (K extends keyof T ? T[K] : never) : never;

type AllEntityInputKeys = KeysOfUnion<EntityInput>;

/**
 * Input to {@link createEntity}.
 *
 * MECHANICALLY DERIVED from the discriminated union's *input* shape — the keys
 * and their value types are projected from `z.input<typeof EntitySchema>`, so
 * the union is the single source of truth and this type cannot drift from the
 * substrates (the original complaint in ADR 0106 / 0106.2 §3). All fields are
 * optional except `id`/`title`; cross-type leakage is rejected at parse time
 * by the strict substrate schema, not by this type.
 *
 * Server-stamped fields (`created_at`/`updated_at`) are excluded — the factory
 * applies them. `type` is optional and defaults to Task.
 */
export type CreateEntityInput = {
  [K in Exclude<AllEntityInputKeys, 'created_at' | 'updated_at' | 'id' | 'title' | 'type'>]?:
    ValueOfUnion<EntityInput, K>;
} & {
  id: string;
  title: string;
  type?: EntityType;
};

/**
 * Assemble an entity from inputs and validate against the substrate schema.
 * Throws ZodError if the input doesn't match the substrate for the given type.
 *
 * Undefined-stripping: `EntitySchema` branches are `.strict()`, and zod rejects
 * unknown keys even when their value is `undefined`. Generic callers
 * (core/create.ts) spread a superset object whose non-matching fields are
 * `undefined`. We drop undefined-valued keys in one pass before `.parse()` so a
 * per-type-shaped object reaches the strict schema cleanly — this replaces the
 * old hand-maintained `if (x !== undefined)` ladder. (ADR 0106.2 §3, Step-0 F1)
 */
export function createEntity(input: CreateEntityInput): Entity {
  const now = new Date().toISOString();
  const type = input.type ?? EntityType.Task;

  const raw: Record<string, unknown> = { ...input, type, created_at: now, updated_at: now };

  for (const key of Object.keys(raw)) {
    if (raw[key] === undefined) delete raw[key];
  }

  return EntitySchema.parse(raw);
}
