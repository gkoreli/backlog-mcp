/**
 * Base substrate primitives — shared Zod schema fragments, Status enum, Reference.
 *
 * Pure Zod/TypeScript. Every substrate extends BaseEntitySchema to get common fields.
 */
import { z } from 'zod';

// ============================================================================
// Status — canonical workflow states
// ============================================================================

export const STATUSES = ['open', 'in_progress', 'blocked', 'done', 'cancelled'] as const;
export type Status = (typeof STATUSES)[number];

export const StatusSchema = z.enum(STATUSES);

// ============================================================================
// Reference — outbound links attached to any entity
// ============================================================================

export const ReferenceSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
});

export type Reference = z.infer<typeof ReferenceSchema>;

// ============================================================================
// BaseEntitySchema — fields every entity has
//
// Note: status is NOT on the base. Some types don't carry status (folder,
// artifact). Types that do status add it in their own substrate via
// `.extend({ status: StatusSchema.default('open') })`.
//
// Note: type is NOT on the base. Per-substrate adds `type: z.literal(...)` so
// discriminated-union narrowing works.
// ============================================================================

export const BaseEntitySchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  description: z.string().optional(),
  status: StatusSchema.optional(),
  parent_id: z.string().optional(),
  // Legacy field — kept for backward compatibility with tasks created before
  // parent_id was introduced. New code should use parent_id.
  epic_id: z.string().optional(),
  references: z.array(ReferenceSchema).optional(),
  // blocked_reason/evidence are semantically task-ish but are widely accessed
  // generically (list filtering, search indexing). Keeping them on the base
  // as optional avoids narrowing churn everywhere a caller reads them.
  blocked_reason: z.array(z.string()).optional(),
  evidence: z.array(z.string()).optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

// ============================================================================
// SubstrateDefinition — the unified contract every substrate module exports
//
// One declaration per entity type. Drives:
//   - TypeScript types (via z.infer of schema)
//   - Runtime validation (schema.parse at storage boundary)
//   - Storage structural invariants (structure.validParents)
//   - Viewer/agent metadata (label, hint, extraFields, ui)
// ============================================================================

export interface SubstrateStructure {
  /** Can this type contain children in the navigation sense? */
  readonly isContainer: boolean;
  /** Does this type carry a `status` field? */
  readonly hasStatus: boolean;
  /** Which entity types are valid parents (via parent_id)? */
  readonly validParents: readonly string[];
}

export interface SubstrateUI {
  /** CSS gradient for the type badge. */
  readonly gradient: string;
  /** Does selecting this type open a dedicated viewer pane? */
  readonly opensInPane?: boolean;
}

export interface SubstrateDefinition<TSchema extends z.ZodTypeAny = z.ZodTypeAny> {
  /** Canonical string key (matches EntityType enum value). */
  readonly type: string;
  /** 4-char uppercase ID prefix (TASK, EPIC, …). */
  readonly prefix: string;
  /** Human-facing type label (singular). */
  readonly label: string;
  /** Zod schema — validation authority for this type's shape. */
  readonly schema: TSchema;
  /** Structural/relationship invariants. */
  readonly structure: SubstrateStructure;
  /** Ordered list of type-specific field keys to surface in detail UIs. */
  readonly extraFields: readonly string[];
  /** Description for agents — rendered into MCP tool hints. */
  readonly hint: string;
  /** UI-facing rendering metadata. */
  readonly ui: SubstrateUI;
}
