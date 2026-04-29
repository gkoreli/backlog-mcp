# 0098. Unified Substrate Architecture — One Declaration Per Entity Type

**Date**: 2026-04-28
**Status**: Accepted
**Triggered by**: Cron entity implementation (ADR 0097 Extension 1), user feedback that substrate concept was decorative — Zod schemas defined but never used, type-specific fields crammed onto the shared `Entity` god-object.
**Completes**: ADR 0088 (Monorepo Structure — Eliminate Type Duplication). ADR 0088 identified `src/substrates/index.ts` as dead code and scheduled deletion. That deletion never happened. This ADR finishes the job and goes further: substrates become the **validation authority**, not just a type registry.

## Context

Before this work, backlog-mcp had multiple parallel systems for per-type knowledge:

| Location | Contained | Status |
|---|---|---|
| `packages/shared/src/entity-types.ts` | Flat `Entity` interface with every type's optional fields mashed together (`due_date`, `content_type`, `path`, `schedule`, `command`, `enabled`, `last_run`, `next_run`), plus `TYPE_PREFIXES` hand-maintained, plus `ID_PATTERN` hardcoded regex | **runtime** |
| `packages/server/src/substrates/index.ts` | Per-type Zod schemas (`TaskSchema`, `EpicSchema`, …), `SUBSTRATES` registry with `validParents` and `hint` | **dead code, never imported** |
| `packages/server/src/core/create.ts` | Hand-rolled validation — 10+ lines per type-specific field check ("if type is not cron and any cron field set, throw") | runtime |
| `packages/server/src/core/update.ts` | Same hand-rolled validation, duplicated | runtime |
| `packages/server/src/tools/backlog-*.ts` | Zod schemas for MCP tool inputs, re-declaring fields a third time | runtime |
| `packages/viewer/type-registry.ts` | UI metadata (icon, gradient, isContainer, hasStatus, opensInPane, extraFields) hand-maintained per type | runtime |
| `packages/server/src/utils/cron.ts` | Cron expression validator — server-only duplicate required because shared couldn't depend on Zod | runtime |

Seven places. Adding a new entity type required editing all seven. The substrate concept (ADR 0065) was supposed to consolidate this; it didn't because the `substrates/` module was wired into nothing.

The immediate trigger: while implementing cron entities, adding five fields to the flat `Entity` god-object (`schedule`, `command`, `enabled`, `last_run`, `next_run`) produced this pattern:

```typescript
// shared/entity-types.ts — the god-object growing
export interface Entity {
  // ... 10 common fields ...
  // Milestone
  due_date?: string;
  // Artifact
  content_type?: string;
  path?: string;
  // Cron
  schedule?: string;
  command?: string;
  enabled?: boolean;
  last_run?: string;
  next_run?: string;
}
```

ADR 0097 commits to entity types multiplying (rule, context, cli_tool, agent, skill, prompt, alarm are in the catalog). Each new type adds more fields to this flat shape. Unmaintainable trajectory.

## Decision

**One substrate module per entity type, in `@backlog-mcp/shared`, as the single source of truth.** Each module declares schema, structural invariants, UX metadata, and agent hints co-located. Everything else (TypeScript types, runtime validation, viewer registry, MCP tool hints) derives from the substrate.

### Structure

```
packages/shared/src/
├── entity-type.ts           # Canonical EntityType enum (split out to break circular imports)
├── entity-types.ts          # Helpers — TYPE_PREFIXES, ID_PATTERN, Entity, ID utils (all derived from SUBSTRATES)
├── cron-expression.ts       # Cron validator — shared (used as Zod refinement)
└── substrates/
    ├── base.ts              # BaseEntitySchema, StatusSchema, ReferenceSchema, SubstrateDefinition interface
    ├── task.ts              # TaskSchema + TaskSubstrate declaration
    ├── epic.ts
    ├── folder.ts
    ├── artifact.ts
    ├── milestone.ts
    ├── cron.ts
    ├── registry.ts          # SUBSTRATES record + EntitySchema = z.discriminatedUnion('type', [...])
    └── index.ts             # barrel
```

### Per-substrate declaration

Every substrate module exports one `<Type>Substrate` object with five aspects:

```typescript
// substrates/cron.ts
export const CronSchema = BaseEntitySchema.extend({
  type: z.literal('cron'),
  status: StatusSchema.default('open'),
  schedule: z.string().refine(isValidCronExpression, { message: '…' }),
  command: z.string().min(1),
  enabled: z.boolean().default(true),
  last_run: z.string().nullable().optional(),
  next_run: z.string().nullable().optional(),
}).strict();

export type Cron = z.infer<typeof CronSchema>;

export const CronSubstrate = {
  type: 'cron',
  prefix: 'CRON',
  label: 'Cron',
  schema: CronSchema,
  structure: {
    isContainer: false,
    hasStatus: true,
    validParents: ['epic', 'folder'],
  },
  extraFields: ['schedule', 'command', 'enabled', 'last_run', 'next_run'],
  hint: 'Scheduled intake descriptor. Executed by external scheduler (ADR 0097). `enabled` is separate from `status`.',
  ui: {
    gradient: 'linear-gradient(135deg, #17c0ba, #2da44e)',
  },
} as const satisfies SubstrateDefinition<typeof CronSchema>;
```

The declaration composes:
- **Schema (Zod)**: runtime validation authority. `.strict()` rejects unknown keys; `.refine()` for cross-field constraints like cron expression validity.
- **Structure**: `isContainer`, `hasStatus`, `validParents` — invariants consumed by storage and UI.
- **UX**: `gradient`, `opensInPane` — consumed by viewer.
- **extraFields**: ordered list of type-specific field keys to surface in detail UIs.
- **hint**: agent-facing description rendered into MCP tool hints.

### Registry

`packages/shared/src/substrates/registry.ts` composes substrates:

```typescript
export const SUBSTRATES = {
  [EntityType.Task]: TaskSubstrate,
  [EntityType.Epic]: EpicSubstrate,
  [EntityType.Folder]: FolderSubstrate,
  [EntityType.Artifact]: ArtifactSubstrate,
  [EntityType.Milestone]: MilestoneSubstrate,
  [EntityType.Cron]: CronSubstrate,
} as const satisfies Record<EntityType, SubstrateDefinition>;

export const EntitySchema = z.discriminatedUnion('type', [
  TaskSubstrate.schema,
  EpicSubstrate.schema,
  FolderSubstrate.schema,
  ArtifactSubstrate.schema,
  MilestoneSubstrate.schema,
  CronSubstrate.schema,
]);

export type Entity = z.infer<typeof EntitySchema>;
```

`EntitySchema` is the **validation authority** at write boundaries. The discriminated union picks the branch by `type` and enforces that branch's shape — including strict-mode rejection of extra keys, which makes "no cross-type field leakage" a free invariant (e.g., setting `schedule` on a task is rejected automatically because `TaskSchema.strict()` doesn't declare `schedule`).

`Entity` is no longer a flat god-object. It's the discriminated union. Consumers that access type-specific fields must narrow via `.type`:

```typescript
if (entity.type === 'cron') {
  // TypeScript now knows entity.schedule exists
  console.log(entity.schedule);
}
```

### Derivation: one SUBSTRATES → everything

```
SUBSTRATES
├── derives → TYPE_PREFIXES         (entity-types.ts)
├── derives → ID_PATTERN            (entity-types.ts — regex built from prefixes)
├── derives → EntitySchema          (registry.ts — z.discriminatedUnion)
├── derives → Entity type           (registry.ts — z.infer)
├── drives  → core/create.ts        (schema.parse via createTask)
├── drives  → core/update.ts        (EntitySchema.parse on merged entity)
├── drives  → viewer/type-registry  (composes shared data + local icons)
└── drives  → MCP tool hints        (via SUBSTRATES[type].hint)
```

One hand-maintained list: **`EntityType` enum** + **one substrate module** per enum member. That's it.

### Validation flow

**Create** (`core/create.ts`):
```typescript
const task = createTask({ id, title, type, schedule, command, ... });
// createTask calls EntitySchema.parse(raw) internally.
// Zod:
//   - picks the branch matching `type`
//   - applies branch defaults (e.g. Cron.enabled = true)
//   - rejects unknown keys (e.g. `schedule` on TaskSchema.strict())
//   - runs refinements (e.g. isValidCronExpression on Cron.schedule)
//   - returns typed object or throws ZodError
```

**Update** (`core/update.ts`):
```typescript
const merged = { ...existingTask, ...updates, updated_at: now };
const validated = EntitySchema.parse(merged);
// Same discriminator-based branch selection.
// Cross-type field leakage rejected automatically.
await service.save(validated);
```

`ZodError` is caught and translated to `ValidationError` via `formatZodError()` — a small helper that renders `<path>: <message>` pairs.

### What gets deleted

- `packages/server/src/substrates/index.ts` — dead code per ADR 0088. **Gone.**
- `packages/server/src/utils/cron.ts` — moved to `packages/shared/src/cron-expression.ts` so it can be a Zod refinement.
- Hand-rolled "if not cron and any cron field set" guards in `core/create.ts` and `core/update.ts` — now enforced by `.strict()` on substrate schemas.
- Hand-rolled `isValidCronExpression` call in `core/update.ts` — now a Zod refinement on `CronSchema.schedule`.
- Viewer's hand-maintained `TYPE_REGISTRY` duplication — now composed from shared `SUBSTRATES` plus a local icon map (the only thing that can't live in shared because SVG assets need esbuild's file loader).

### Why Zod in shared (reversing ADR 0088 preference)

ADR 0088 said shared should have "no Zod (server dependency) — plain interfaces only." We're reversing that. Reasons:

1. **Substrate schemas ARE the source of truth.** Keeping them out of shared means duplicating shape definitions in two places or leaving substrates decorative (the pre-0098 state).
2. **Zod is ~8 KB gzipped.** Viewer bundle impact is negligible. Zod schemas also tree-shake well when only inferred types are used.
3. **Viewer may benefit.** Form validation, API request shaping, future per-type authoring UX — all benefit from having substrate schemas available browser-side.

### Breaking the circular import

Substrate modules need `EntityType` (for `type: z.literal(EntityType.Task)`). The registry imports each substrate. `entity-types.ts` derives helpers from the registry. This creates a cycle:

```
entity-types.ts → substrates/registry.ts → substrates/task.ts → entity-type.ts
```

We split `EntityType` enum into its own pure file: `packages/shared/src/entity-type.ts`. That file depends on nothing. Both `entity-types.ts` (helpers) and substrate modules (registry branches) import from there. Cycle broken.

## Consequences

### Benefits

- **Adding a new entity type cost**: one substrate module (~40 LOC) + one line in `EntityType` enum + one line in `SUBSTRATES` registry. No edits to `TYPE_PREFIXES`, `ID_PATTERN`, viewer registry, MCP tool schemas, storage iteration logic, or validation code.
- **Cross-type field leakage rejected for free**: Zod discriminated union + `.strict()` catches `schedule: "..."` on a task without any hand-rolled check.
- **Single place to look** when answering "what fields does X have, what's valid, what parents can it have?" Everything co-located in the substrate module.
- **Declarative UI composition**: viewer `TYPE_REGISTRY` is now built by mapping over `SUBSTRATES`, not hand-maintained. Impossible to drift.
- **Agent hints centralized**: `SUBSTRATES[type].hint` feeds MCP tool descriptions directly. No duplicate hint text.
- **ADR 0088 resolved**: the dead `src/substrates/index.ts` is deleted. The intended consolidation is complete.

### Trade-offs

- **Consumers that access type-specific fields without narrowing must narrow.** TypeScript compiler drove this list — 6 sites total across server + memory packages. All fixed (adapter-level casts to `AnyEntity = Entity & Record<string, unknown>` for storage code that legitimately handles every type uniformly).
- **Base schema compromise**: `status`, `blocked_reason`, `evidence` live on `BaseEntitySchema` (optional) even though they're semantically task-ish. Moving them to TaskSchema only would force narrowing at ~50 call sites that legitimately treat these as universal (list rendering, search indexing). Pragmatic placement wins — the substrate still has final say (e.g., folder's schema doesn't set `status` default, so newly-created folders won't have one).
- **Zod in shared is new.** Bundle size impact monitored going forward.
- **Lenient reads, strict writes.** Storage `rowToEntity` / YAML reader uses type-erased `AnyEntity` cast — legacy data on disk isn't re-validated on load. Only writes go through `EntitySchema.parse`. This matches the "be conservative in what you send, liberal in what you accept" invariant and avoids breaking deployments with pre-refactor data.

### Follow-up opportunities (not done here)

- **MCP tool schemas compose from substrates.** `backlog-create.ts` and `backlog-update.ts` still hand-declare their Zod input schemas. Future refactor: derive tool input shapes from substrate schemas (probably via `z.object({ title: ..., ... }).merge(SubstrateSchema.partial())`).
- **Substrate `validParents` enforcement.** Currently declared but not enforced. A follow-up can wire this as a refinement at create/update time ("parent of CRON-X must be EPIC or FOLDR").
- **Humanized schedule rendering for cron** (deferred from cron ship).
- **Aggregate endpoint + `<aggregate-chart>`** (ADR 0097 Extension 2).

## References

- ADR 0065 — Unified Entity Model Substrates (original generalization, partially implemented)
- ADR 0066 — Frontend Type Registry for Substrates Viewer UI (viewer side)
- ADR 0067 — Substrates Backend Integration (storage integration)
- ADR 0088 — Monorepo Structure — Eliminate Type Duplication (completed by this ADR)
- ADR 0097 — Agentic Storage Engine Positioning (trajectory that requires this consolidation)
