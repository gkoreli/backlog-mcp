---
title: "0113. User-Defined Substrates — Substrate Definitions as Data"
date: 2026-07-16
status: Proposed
spawned_by: "PROMPT 0001 — docs/prompts/0001-tasks-and-vision.md"
extends: 0098-unified-substrate-architecture.md
relates_to:
  - 0104-local-first-deployment-posture.md
  - 0106-semantic-intent-tools-at-mcp-boundary.md
  - 0112-docs-native-project-scoped-backlog.md
  - 0114-memory-context-surface-disposition.md
---

# 0113. User-Defined Substrates — Substrate Definitions as Data

## Decision summary

A project may define a substrate with a JSON document in the definition discovery
location established by ADR 0112. The definition declares a portable JSON Schema,
document semantics, lifecycle, relations, safe semantic intents, progressive-disclosure
behavior, and presentation metadata. backlog-mcp validates the definition against a
versioned meta-schema and compiles it into a project-scoped runtime registry.

This extends ADR 0098 without pretending the compiled TypeScript union can remain the
whole world:

- Existing built-in substrates remain statically typed Zod definitions, but register
  through the same runtime registry contract.
- Runtime substrates are validated dynamically and represented as open
  `RuntimeEntity` records.
- Core code addresses both through a registry contract rather than a closed enum,
  module-level regex, or exhaustive viewer map.
- ADR and Requirement ship as pre-installed JSON definitions and therefore dogfood
  the same mechanism available to a project.
- Prompt is the third, smaller candidate substrate: a chronological, verbatim human
  directive with append-only lineage to the work it caused.

The ADR and Requirement definitions are the flagship proof. They must bolt onto both
this repository's older ADR corpus and Aime's newer corpus without moving or rewriting
the documents.

## Context

ADR 0098 made the substrate declaration the source of truth for each entity type. That
was the right architectural move, but the declaration is still compiled application
code:

- `SubstrateDefinition` carries schema, structure, extra fields, hint, and UI metadata
  in `packages/shared/src/substrates/base.ts:68-101`.
- `SUBSTRATES` is a closed record over `EntityType`, and `EntitySchema` is a closed Zod
  discriminated union in `packages/shared/src/substrates/registry.ts:30-58`.
- `EntityType` itself is a seven-member enum in
  `packages/shared/src/entity-type.ts:11-21`.
- `TYPE_PREFIXES` and the process-wide ID regex are built once from that compiled
  registry in `packages/shared/src/entity-types.ts:22-52`.
- The viewer still has an exhaustive icon record and a compiled
  `Record<EntityType, TypeConfig>` in `packages/viewer/type-registry.ts:14-52`.
- MCP inputs still use compile-time `z.enum(ENTITY_TYPES)` in
  `packages/server/src/tools/backlog-create.ts:14-25` and
  `packages/server/src/tools/backlog-list.ts:12-19`.
- Search has another closed type union in `packages/memory/src/search/types.ts:13-17`.

That architecture makes adding a built-in cheap for a maintainer. It does not let a
project teach backlog-mcp a type it did not know when the package was built.

### The bolt-on test is stricter than "parse our newest files"

The two ADR corpora are materially different:

- This repository has 137 `docs/adr/*.md` files; only 34 begin with YAML
  frontmatter. Older ADRs derive identity and title primarily from the filename and
  first heading.
- Aime has 38 ADRs and all 38 carry frontmatter, but the vocabulary is intentionally
  open: `parent`, `artifact_kind`, `relates_to`, `grounds_in`, `spawned_by`,
  `supersedes_claim`, and other fields occur alongside the common
  `title`/`date`/`status`.
- Status values are not a clean enum in either corpus. Besides proposed/accepted/
  superseded, the documents contain draft, living, summary, in-progress prose, and
  accepted values with annotations.
- Threading is encoded most reliably in filenames: this repo has substantial
  `0013.x`, `0092.x`, `0097.x`, and `0106.x` threads; Aime has `0023.x` and
  `0024.x`.

The 103 bare ADRs must still index usefully. Title falls back from frontmatter to the
first H1 and then the filename slug. Chronology is explicitly provenance-bearing:
frontmatter `date` is authoritative; otherwise the catalog may expose Git first-add
time, then filesystem modification time, as `inferred_date` plus `date_source`.
Derived chronology is useful for sorting but is never written back or represented as
the ADR's authored date.

A strict read validator would reject the historical corpus on day zero. A permissive
write validator would make the substrate definition decorative. The design therefore
separates **lossless reads** from **canonical writes**.

### Zod 4 helps, but is not the portable contract

The installed Zod runtime exposes both `z.toJSONSchema()` and
`z.fromJSONSchema()`. Zod 4 documents native JSON Schema conversion and targets Draft
2020-12 by default. It also documents important limits: transforms/custom values have
no JSON Schema representation, and `z.fromJSONSchema()` is currently experimental.
See the official [Zod JSON Schema documentation](https://zod.dev/json-schema).

Therefore JSON Schema is the declaration language and validation contract for runtime
substrates. Zod conversion is an adapter opportunity, not the persistence format or a
stability boundary we make projects depend on.

## Rulings

### R1. A substrate definition is a versioned JSON envelope containing JSON Schema

The project-authored file is data, never executable code. Its top-level envelope
contains:

| Section | Purpose |
|---|---|
| `definitionVersion` | Version of the backlog-mcp substrate meta-schema. |
| `type`, `label`, and `folder` | Stable machine key, singular/plural human labels, and the validated docs-relative storage claim. |
| `replaces` / `extendsDefinition` | Explicit relationship to a packaged declarative definition. |
| `identity` | Type-local identity requirements consumed by ADR 0112's identity service. |
| `schema` | Draft 2020-12 JSON Schema for the normalized entity projection. |
| `readPolicy` | How external/bare documents are ingested without mutation or data loss. |
| `body` | Markdown-body requirements and optional heading rules. |
| `workflow` | Substrate-specific state vocabulary, external-read normalization, and allowed transitions. |
| `relations` | Typed outbound links with target types and cardinality. |
| `structure` | Container/parent semantics from ADR 0098. |
| `intents` | Optional safe operation declarations for semantic MCP tools. |
| `disclosure` | Search, recall, wakeup, and contextual-expansion behavior. |
| `hint` and `ui` | Agent discovery text and allowlisted presentation metadata. |

The meta-schema accepts a deliberately bounded JSON Schema subset: JSON primitives,
objects, arrays, enums/const, required properties, numeric/string bounds, formats
from a fixed allowlist,
`oneOf`/`anyOf`/`allOf`, and local `#/$defs` references.

Project-authored `pattern` is excluded from v1. JavaScript's native regex engine has
no reliable compile-time safety proof, and heuristic checkers leave ReDoS bypasses.
A future measured need may add patterns behind an isolated or linear-time engine.

The following are rejected:

- remote `$ref` fetching;
- executable expressions or JavaScript hooks;
- transforms, preprocessors, or custom Zod refinements;
- arbitrary filesystem paths;
- arbitrary HTML, SVG, CSS, or color values;
- dynamically loaded validators or format packages.

Cross-field constraints that fit JSON Schema use `if`/`then`/`else`,
`dependentRequired`, and composition. A constraint that cannot be expressed safely
does **not** get a code escape hatch in a project definition. It requires a compiled
core capability identified by a versioned name, such as
`"invariants": ["relation-target-exists@1"]`. Unknown capabilities make the definition
invalid. No definition may point at a local module.

The intended validator is Ajv's Draft 2020-12 build in strict mode, behind the
meta-schema gate—not direct compilation of arbitrary project JSON. Ajv explicitly
warns that untrusted schemas can cause excessive compile/validation work and ReDoS,
so size/depth limits, rejection of project-authored patterns, bounded arrays/strings,
local refs only, and production validation without `allErrors` are part of the
contract, not optional hardening. See Ajv's official
[Draft 2020-12 support](https://ajv.js.org/json-schema.html) and
[security guidance](https://ajv.js.org/security.html). Date/date-time formats use
small backlog-mcp-owned validators rather than loading an open format plugin set.

### R2. Definitions compile into a project-scoped registry, not the closed union

The active registry is composed at project activation:

```text
compiled built-in registry
  + packaged declarative definitions
  + discovered project definitions
  = ProjectSubstrateRegistry
```

The compiled built-in registry owns the statically typed
task/epic/folder/artifact/milestone/cron/memory validators. ADR, Requirement, and
Prompt ship as packaged declarative definitions and go through the runtime compiler.
This is one registry with two validator implementations, not two service paths.
For declarative substrates, **built-in means pre-installed**, not privileged: the
packaged ADR/REQ/Prompt files are validated and compiled exactly like project files,
with virtual source paths and the same diagnostics. Existing Zod substrates keep their
compiled refinements but receive no special generic storage/viewer/tool path.

Project definitions do not win by load order. To customize a packaged declarative
definition, the file must explicitly declare `replaces: "builtin:adr@1"` or
`extendsDefinition: "builtin:adr@1"`. A same-type declaration without that relationship
is a collision and is quarantined. Project definitions may not shadow a compiled
built-in type in v1; a project `task.json` therefore cannot silently replace Task.

The runtime contract is conceptually:

```ts
type SubstrateType = string;

interface RuntimeEntity {
  id: string;
  type: SubstrateType;
  title: string;
  content?: string;
  [field: string]: unknown;
}

type AnyEntity = BuiltinEntity | RuntimeEntity;
```

Per-substrate Zod validators remain useful for built-in branches; the closed
`EntitySchema` union stops being the universal write router. A
`ProjectSubstrateRegistry.validate(type, candidate, mode)` router selects the
registered Zod validator or runtime JSON Schema validator. Generic core/storage code
is migrated directly to that contract; there is no long-lived old/new validation
path or deprecation ceremony.

This is an honest loss of compile-time exhaustiveness for user-defined types. Code
that needs a built-in's special field continues to narrow to that built-in. Generic
storage, search, list, relation, and viewer code uses the registry and open record.

### R3. Runtime identity and type parsing become registry services

`TYPE_PREFIXES`, `ID_PATTERN`, `parseEntityId()`, and `getTypeFromId()` currently
assume a process-wide, prefix-shaped ID space. `getTypeFromId()` even falls back to
Task for unknown values (`packages/shared/src/entity-types.ts:78-82`), which would
misclassify a runtime document.

ADR 0112 owns discovery, layout, filename grammar, and ID allocation. ADR 0113 owns
the semantic requirements a substrate places on that identity. The seam is a parsed
document identity:

```ts
interface DocumentIdentity {
  sourcePath: string;
  pathKey?: string;
  declaredId?: string;
  slug?: string;
  threadRootKey?: string;
  threadParentKey?: string;
  observedDate?: string;
  dateSource?: 'git-first-add' | 'filesystem-mtime';
}
```

This is ADR 0112's neutral record, consumed rather than duplicated here. An ADR
definition may require the `numbered-threaded` strategy; a Requirement may require
`prefixed-number`; a Prompt may use a numbered filename with the display identity
`PROMPT 0001`. ADR 0113 validates `declaredId` against the path identity, assigns the
substrate meaning/display, and maps thread keys to relations. It does not rebuild a
universal regex or allocate the number.

Duplicate type keys, overlapping folder claims, identity prefixes, generated intent
names, or incompatible identity strategies are deterministic load errors. No
filesystem-order winner is chosen: every conflicting project definition is
quarantined and the diagnostic cites all source paths. An unaffected packaged/built-in
definition remains active unless an explicit, valid replacement compiled successfully.

### R4. Reads are lenient and lossless; writes are strict and canonical

Read mode:

1. Discover the markdown document through ADR 0112.
2. Parse filename identity, optional frontmatter, first H1, and body.
3. Apply external-read mappings into a projection without rewriting the file.
4. Preserve unknown frontmatter keys verbatim.
5. Validate known fields and emit diagnostics for missing/invalid canonical fields.
6. Index and render the document even when it is externally nonconforming.
7. Derive non-authoritative chronology from catalog metadata when `date` is absent,
   retaining `inferred_date` and `date_source`.

Write mode:

1. Build the complete normalized entity.
2. Validate strictly against the substrate schema, workflow, relation, and body rules.
3. Serialize canonical frontmatter ordering and filename identity.
4. Reject unknown fields unless the definition explicitly allows them.

External/bare documents remain readable forever without migration. Once backlog-mcp
is asked to mutate one, that user-authorized write adopts the document into the
canonical substrate form in one operation: canonical fields are written, external
read mappings disappear, unknown source metadata moves under the declared
`extensions` bag, and the body is preserved. A project that wants an extension to be
first-class adds it to its project definition. The server does not maintain dual write
formats.

This directly continues ADR 0098's accepted **"Lenient reads, strict writes"**
trade-off (`docs/adr/0098-unified-substrate-architecture.md`, Consequences). The
current markdown reader still returns a type-erased entity projection
(`packages/server/src/storage/local/filesystem-storage.ts:39-44`), while update writes
validate the merged entity before saving (`packages/server/src/core/update.ts:55-63`).
ADR 0113 generalizes that precedent from built-in entities to discovered project
documents. The leniency is at the external read boundary, not permission to preserve
legacy aliases or compatibility branches in our own code.

### R5. Workflow vocabulary belongs to the substrate

The global task-shaped `STATUSES` list
(`packages/shared/src/substrates/base.ts:12-15`) cannot remain the status model for
all substrates.

A definition declares:

- the status field name;
- canonical states and human labels;
- which states are initial and terminal;
- allowed transitions;
- external-read mappings/normalizers;
- optional transition side effects drawn from the safe operation algebra.

Generic list/search APIs accept strings and validate them against the selected
substrate at runtime. Cross-substrate queries may either omit status or use a
registry-defined status class (`active`, `terminal`, `attention`) rather than assume
that `done` is meaningful everywhere.

### R6. Relations are typed data; thread is both identity and relation

Each relation declares target substrate types, scalar/list cardinality, requiredness,
and an optional inverse label. Relation targets are resolved through the project
document catalog, not assumed to be `TASK-`-shaped IDs.

For ADRs:

- the filename's base number and optional thread ordinal establish thread identity;
- `0092.3` means child 3 of the `0092` thread, never floating-point 92.3;
- the normalized entity exposes `thread_of` and `thread_ordinal`;
- external fields such as `parent` or `thread_root` may confirm or supply the
  relation when the filename cannot;
- thread membership is not navigation containment and does not become `parent_id`.

The identity makes the relationship obvious outside backlog-mcp. The normalized
relation makes it queryable inside backlog-mcp. Both are required.

### R7. Substrate definitions may declare semantic intents; the server never guesses them

A schema alone does not imply good verbs. Defining `adr` must not automatically invent
`backlog_create_adr`, `backlog_update_adr`, and every CRUD permutation.

A definition may explicitly declare semantic intents using a closed operation algebra:

- `create`;
- `set-field`;
- `transition`;
- `relate`;
- `relate-and-transition`;
- `append-relation`;
- `search`;
- `recall`.

Each intent provides a verb, Tool Search description, input fields, defaults, and the
safe operation it maps to. The server generates a thin MCP adapter only from that
declaration. Examples:

- `backlog_propose_adr`;
- `backlog_accept_adr`;
- `backlog_supersede_adr`;
- `backlog_capture_requirement`;
- `backlog_capture_prompt`.

Compilation resolves the complete consumer contract. It owns the final tool name,
builds a strict intent-only Zod input object, lowers invocation fields into explicit
input-to-field bindings, separates caller defaults from unoverrideable fixed create
fields, and resolves transition/relation names into field/state/cardinality/target-type
mechanics. Two-entity declarations explicitly name `sourceInput` and `targetInput`;
input ordering has no meaning. The consumer supplies its reserved static MCP names so
compiler-wide collision quarantine covers both generated and hand-written tools.

`set-field` is deliberately narrower than generic update. Version one assigns one
declaration-fixed scalar value to one canonical scalar field; invocation supplies
only the entity ID. Compilation rejects `id`, `type`, the workflow field, and declared
relation fields, and the executor validates the complete post-mutation entity through
the project registry. Cron therefore declares pause and resume as
`enabled = false` and `enabled = true`, not as status transitions: `enabled` remains
independent from workflow status.

`relate-and-transition` may span two entities. Version one does not claim a filesystem
transaction, batch primitive, or cross-process mutex that the local service does not
have. The executor loads both preimages, validates every precondition and both
postimages before writing, writes the source relation first, then applies the target
transition. If the second write fails it attempts to restore the source preimage.
Success is published only after both writes; failure reports whether compensation
succeeded, and failed compensation is an explicit partial failure naming both
entities. Relation append is deduplicated and an already-completed matching transition
is accepted so retry is idempotent. A transactional storage implementation may later
replace this best-effort execution behind the same compiled intent contract if real
contention or failure evidence justifies it.

The generated tool description is the discovery surface:

> Use when recording a proposed architectural decision in the current project. Creates
> a numbered ADR using the project's ADR substrate and validates its required context,
> decision, and trade-off structure.

All generated tools call one transport-free core intent executor. A definition cannot
embed business logic. Rich behavior outside the safe algebra requires a compiled core
feature, but never project code execution.

If generic create/update/list/search operations remain, they are intentional
low-level escape hatches backed by the runtime registry, not preserved legacy
surfaces. We do not ship parallel deprecated and canonical tool contracts. This
follows ADR 0106: intent at the port, substrate abstraction in core.

### R8. UI metadata is allowlisted and the viewer receives the runtime registry

The viewer cannot import the project registry from `@backlog-mcp/shared`; it must
receive a serializable registry projection from the active server.

Definitions select:

- an icon from a packaged semantic icon catalog;
- an accent role from a Tsa token-backed allowlist;
- summary/detail field order;
- whether the document opens in a pane;
- status labels and status classes.

They cannot provide raw gradients, colors, CSS, HTML, or SVG. Unknown types use a
generic document icon and neutral Tsa accent instead of falling back to Task.

The existing generic metadata renderer already preserves much of this value:
`packages/viewer/components/metadata-card.ts:28-94` renders arbitrary scalars,
arrays, objects, and recognized entity references. Runtime substrate work should
extend that generic path rather than create one component per user type.

### R9. Invalid definitions fail locally, visibly, and without disabling the project

Loading follows ADR 0105's graceful-degradation posture:

- parse, meta-schema, compile, collision, and unsupported-capability errors are
  caught per definition file;
- one structured warning includes source path, definition type if known, and all
  actionable diagnostics;
- the invalid definition is quarantined for the session;
- other definitions and built-ins continue loading;
- its markdown documents remain readable as generic resources;
- no startup path rewrites or deletes the invalid file.

Limits apply to file size, nesting depth, property count, regex length/complexity, and
local `$ref` depth. Remote `$ref` resolution is disabled. Definition and document
paths are supplied by ADR 0112 and cannot escape project roots.

### R10. The first release is local-first and needs no D1 parity

User-defined project substrates depend on project-local discovery, markdown files,
runtime registry projection, and local search indexing. Per ADR 0104, v1 targets the
Node/local mode. The D1 satellite continues to expose the compiled built-in
types; runtime substrate support is not blocked on a remote schema/storage design.

## Meta-schema worked example: `docs/substrates/adr.json`

The following is a complete definition, not executable configuration. The exact
published URI of the meta-schema is an implementation detail; `definitionVersion`
is the runtime compatibility gate.

```json
{
  "$schema": "urn:backlog-mcp:schema:substrate-definition:1",
  "definitionVersion": 1,
  "replaces": "builtin:adr@1",
  "type": "adr",
  "label": {
    "singular": "ADR",
    "plural": "ADRs"
  },
  "folder": "adr",
  "identity": {
    "strategy": "numbered-threaded",
    "minimumDigits": 4,
    "displayTemplate": "ADR {key}"
  },
  "schema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "maxLength": 200
      },
      "type": {
        "const": "adr"
      },
      "title": {
        "type": "string",
        "minLength": 1,
        "maxLength": 300
      },
      "content": {
        "type": "string",
        "minLength": 1,
        "maxLength": 2000000
      },
      "date": {
        "type": "string",
        "format": "date"
      },
      "inferred_date": {
        "type": "string",
        "format": "date-time",
        "readOnly": true
      },
      "date_source": {
        "type": "string",
        "enum": [
          "frontmatter",
          "git-first-add",
          "filesystem-mtime"
        ],
        "readOnly": true
      },
      "status": {
        "type": "string",
        "enum": [
          "draft",
          "proposed",
          "accepted",
          "living",
          "deferred",
          "rejected",
          "superseded"
        ]
      },
      "artifact_kind": {
        "type": "string",
        "maxLength": 100
      },
      "thread_of": {
        "type": "string",
        "maxLength": 200
      },
      "thread_ordinal": {
        "type": "integer",
        "minimum": 1
      },
      "supersedes": {
        "type": "array",
        "maxItems": 100,
        "items": {
          "type": "string",
          "maxLength": 200
        },
        "uniqueItems": true
      },
      "extends": {
        "type": "array",
        "maxItems": 100,
        "items": {
          "type": "string",
          "maxLength": 200
        },
        "uniqueItems": true
      },
      "implements": {
        "type": "array",
        "maxItems": 100,
        "items": {
          "type": "string",
          "maxLength": 200
        },
        "uniqueItems": true
      },
      "backlog_item": {
        "type": "array",
        "maxItems": 100,
        "items": {
          "type": "string",
          "maxLength": 200
        },
        "uniqueItems": true
      },
      "spawned_by": {
        "type": "array",
        "maxItems": 100,
        "items": {
          "type": "string",
          "maxLength": 200
        },
        "uniqueItems": true
      },
      "respects": {
        "type": "array",
        "maxItems": 100,
        "items": {
          "type": "string",
          "maxLength": 200
        },
        "uniqueItems": true
      },
      "violates": {
        "type": "array",
        "maxItems": 100,
        "items": {
          "type": "string",
          "maxLength": 200
        },
        "uniqueItems": true
      },
      "references": {
        "type": "array",
        "maxItems": 100,
        "items": {
          "type": "object",
          "properties": {
            "url": {
              "type": "string",
              "maxLength": 2000
            },
            "title": {
              "type": "string",
              "maxLength": 300
            }
          },
          "required": [
            "url"
          ],
          "additionalProperties": false
        }
      },
      "extensions": {
        "type": "object",
        "description": "Preserved external metadata that is not yet declared as a first-class ADR field.",
        "maxProperties": 100,
        "additionalProperties": true
      }
    },
    "required": [
      "id",
      "type",
      "title",
      "content",
      "date",
      "status"
    ],
    "additionalProperties": false
  },
  "readPolicy": {
    "missingFrontmatter": "allow-with-diagnostics",
    "unknownFields": "preserve",
    "missingRequired": "allow-with-diagnostics",
    "deriveTitleFrom": [
      "frontmatter.title",
      "heading.h1",
      "identity.slug"
    ],
    "deriveChronologyFrom": [
      "frontmatter.date",
      "catalog.gitFirstAddedAt",
      "catalog.modifiedAt"
    ],
    "externalReadMappings": {
      "backlog": "backlog_item",
      "parent": "thread_of",
      "thread_root": "thread_of"
    },
    "coerceScalarToArray": [
      "supersedes",
      "extends",
      "implements",
      "backlog_item",
      "spawned_by",
      "respects",
      "violates"
    ],
    "statusNormalization": {
      "mode": "case-insensitive-prefix",
      "preserveRaw": true,
      "mappings": {
        "in progress": "living",
        "summary": "living"
      }
    },
    "adoptUnknownFieldsInto": "extensions"
  },
  "body": {
    "format": "markdown",
    "required": true,
    "recommendedHeadings": [
      "Context",
      "Decision",
      "Consequences"
    ]
  },
  "workflow": {
    "field": "status",
    "initial": [
      "draft",
      "proposed",
      "living"
    ],
    "terminal": [
      "rejected",
      "superseded"
    ],
    "transitions": [
      {
        "name": "propose",
        "from": [
          "draft",
          "deferred"
        ],
        "to": "proposed"
      },
      {
        "name": "accept",
        "from": [
          "draft",
          "proposed",
          "living"
        ],
        "to": "accepted"
      },
      {
        "name": "defer",
        "from": [
          "draft",
          "proposed"
        ],
        "to": "deferred"
      },
      {
        "name": "reject",
        "from": [
          "draft",
          "proposed",
          "deferred"
        ],
        "to": "rejected"
      },
      {
        "name": "supersede",
        "from": [
          "accepted",
          "living"
        ],
        "to": "superseded",
        "requiresRelation": "superseded_by"
      }
    ]
  },
  "relations": {
    "thread_of": {
      "targets": [
        "adr"
      ],
      "cardinality": "zero-or-one",
      "derivedFromIdentity": true
    },
    "supersedes": {
      "targets": [
        "adr"
      ],
      "cardinality": "many",
      "inverse": "superseded_by"
    },
    "extends": {
      "targets": [
        "adr"
      ],
      "cardinality": "many"
    },
    "implements": {
      "targets": [
        "adr",
        "requirement",
        "task"
      ],
      "cardinality": "many"
    },
    "backlog_item": {
      "targets": [
        "task",
        "epic",
        "artifact"
      ],
      "cardinality": "many"
    },
    "spawned_by": {
      "targets": [
        "prompt",
        "requirement"
      ],
      "cardinality": "many"
    },
    "respects": {
      "targets": [
        "requirement"
      ],
      "cardinality": "many"
    },
    "violates": {
      "targets": [
        "requirement"
      ],
      "cardinality": "many",
      "attention": "warning"
    }
  },
  "structure": {
    "isContainer": false,
    "hasStatus": true,
    "validParents": []
  },
  "intents": [
    {
      "verb": "propose",
      "operation": "create",
      "description": "Use when recording a proposed architectural decision in the current project.",
      "requiredInputs": [
        "title",
        "content"
      ],
      "optionalInputs": [
        "extends",
        "implements",
        "backlog_item",
        "spawned_by",
        "respects",
        "violates"
      ],
      "defaults": {
        "status": "proposed"
      }
    },
    {
      "verb": "accept",
      "operation": "transition",
      "description": "Use when ratifying an existing proposed ADR.",
      "requiredInputs": [
        "id"
      ],
      "transition": "accept"
    },
    {
      "verb": "supersede",
      "operation": "relate-and-transition",
      "description": "Use when a newer ADR replaces an accepted or living ADR while preserving lineage.",
      "requiredInputs": [
        "replacement_id",
        "superseded_id"
      ],
      "relation": "supersedes",
      "sourceInput": "replacement_id",
      "targetInput": "superseded_id",
      "targetTransition": "supersede"
    }
  ],
  "disclosure": {
    "search": {
      "enabled": true,
      "fields": [
        "title",
        "content",
        "status",
        "artifact_kind"
      ]
    },
    "recall": {
      "enabled": true,
      "projection": [
        "id",
        "title",
        "status",
        "date"
      ]
    },
    "get": {
      "context": true,
      "groupByRole": true,
      "relations": [
        "thread_of",
        "supersedes",
        "extends",
        "implements",
        "backlog_item",
        "spawned_by",
        "respects",
        "violates"
      ]
    },
    "wakeup": {
      "section": "decisions",
      "includeStatuses": [
        "proposed",
        "living"
      ],
      "limit": 5,
      "projection": [
        "id",
        "title",
        "status"
      ]
    }
  },
  "extraFields": [
    "date",
    "artifact_kind",
    "thread_of",
    "supersedes",
    "extends",
    "implements",
    "backlog_item",
    "spawned_by",
    "respects",
    "violates"
  ],
  "hint": "Architectural decision record. Use ADR intents to propose, accept, supersede, thread, and connect decisions to requirements and work.",
  "ui": {
    "icon": "decision",
    "accent": "violet",
    "opensInPane": true,
    "summaryFields": [
      "status",
      "date",
      "thread_of"
    ]
  }
}
```

## ADR substrate specification

### ADR is its own substrate, not an Artifact subtype

An ADR is still a markdown artifact in the ordinary-language sense, but it is not the
generic Artifact substrate with a label. It has independent lifecycle, lineage,
threading, requirement relations, semantic verbs, and wakeup/search behavior.

Memory established the precedent: rich semantics justified a first-class substrate and
verbs instead of forcing everything through the generic path. ADR meets the same bar.
Composition preserves the useful commonality: both ADR and Artifact share the base
markdown-document capabilities rather than an inheritance hierarchy.

### Canonical lifecycle

New ADR writes use:

```text
draft → proposed → accepted → superseded
                    ↘
draft/proposed → deferred → proposed
draft/proposed/deferred → rejected
living → accepted or superseded
```

`living` is retained because the Aime corpus uses ADR threads as evidence ledgers,
maps, and evolving methods. It is not silently normalized to accepted. `summary` and
annotated external values remain readable through the ingestion projection but are not
canonical new-write states.

Supersession is a relation plus lifecycle operation:

- the newer ADR records `supersedes`;
- the older ADR becomes `superseded`;
- the inverse `superseded_by` is derived;
- neither body is deleted or rewritten.

### Canonical relations

| Relation | Meaning |
|---|---|
| `thread_of` | This ADR is a numbered child in another ADR's exploration/decision thread. |
| `supersedes` | This decision replaces earlier decisions while preserving history. |
| `extends` | This ADR adds a compatible ruling without replacing the earlier ADR. |
| `implements` | This record implements a prior ADR or fulfills part of a Requirement. |
| `backlog_item` | Task/epic/artifact work associated with the decision. |
| `spawned_by` | Human Prompt or Requirement that caused the ADR. |
| `respects` | Requirements explicitly preserved by the decision. |
| `violates` | Requirements knowingly violated; always an attention warning. |

External freeform fields remain visible. The canonical relation set does not attempt to
erase useful corpus-specific vocabulary such as `relates_to`, `grounds_in`, or
`supersedes_claim`.

### Ingestion acceptance

The ADR substrate passes the bolt-on test when it can:

- derive `0092.13`, thread root `0092`, ordinal `13`, and title from this repo's
  filename/H1 even if frontmatter is absent;
- index a bare ADR without inventing an authored date, while retaining a labeled
  Git/mtime-derived chronology when available;
- read this repo's scalar `extends`, `implements`, `backlog_item`, and mixed-case
  statuses without rewriting them;
- read Aime's `parent: ADR-0023`, `artifact_kind`, multiline `relates_to`, living
  status, and open-ended evidence metadata;
- preserve every unknown field and exact markdown body;
- create a new ADR in one canonical form.

## Requirement substrate specification

Requirement captures the human need before architecture chooses how to satisfy it.
Aime's `docs/requirements/README.md` defines the correct seam: REQ answers "what does
Goga want and why?", while ADR answers "what did we decide and why?"

### Canonical fields

| Field | Shape | Purpose |
|---|---|---|
| `id` | identity | `REQ-NNNN` display/canonical identity, allocated by ADR 0112. |
| `title` | string | Human-readable need. |
| `domain` | string or string[] | Product domain/tag, such as `fleet` or `aime`. |
| `status` | enum | Delivery lifecycle. |
| `date` | date | Intake date. |
| `uploaded_by` | string | Human/source of intent. |
| `grounds_in` | string[] | North-star invariants, memories, prompts, or evidence the requirement serves. |
| `spawned` | relation[] | ADRs/tasks produced when the requirement is ruled. |
| `supersedes` | relation[] | Earlier requirements this one corrects. |
| `compliance` | enum | Current assessment, separate from delivery status. |
| `checked_at` | date-time | Last explicit assessment time. |
| `checked_by` | string | Human or agent that made the assessment. |
| `check_evidence` | string[] | Evidence supporting the assessment. |
| `violated_by` | relation[] | ADRs/tasks/changes known to violate it. |

The body convention remains lean and human-first:

- The need
- Why it matters
- Done looks like
- For the architect to rule
- Notes

These headings are canonical-write requirements for Requirement, unlike ADR's merely
recommended headings.

### Delivery status and compliance are different axes

Delivery lifecycle follows Aime's established vocabulary:

```text
intake → ruled → building → done
   └──────────────→ dropped
```

`done` means the requested capability was delivered. It does not prove the system
still respects the requirement six months later.

Compliance is independently:

```text
unchecked | satisfied | at_risk | violated | not_applicable
```

An accepted ADR may declare `respects: [REQ-0003]` or
`violates: [REQ-0003]`. A violation does not cause an implicit server-side veto;
requirements are human authority, not hidden policy code. It produces a visible
warning in the ADR, Requirement, wakeup briefing, and review projections.

### Progressive disclosure for Requirements

Requirements marked neither dropped nor not-applicable are project constraints, not
ordinary backlog noise.

`backlog_wakeup` gains a bounded `requirements`/`constraints` section:

- violated and at-risk requirements first;
- then unchecked active requirements;
- then the most recently checked satisfied requirements;
- each entry is a stub: id, title, domain, status, compliance;
- if the budget truncates results, the briefing states the omitted count rather than
  implying completeness.

Requirement definitions opt into recall/search as durable project knowledge. A result
returns stubs first. ADR 0114's FOLD ruling supplies the single expansion language:

```text
wakeup                 orient
recall / search         ask
get(id, context: true) expand
```

`get(context: true)` returns role-grouped relation stubs, so a Requirement can expose
the ADRs/tasks it spawned and an ADR can expose respected/violated Requirements without
a Requirement-specific retrieval stack or the retired `backlog_context` tool.

Compilation resolves disclosure before retrieval sees it. Search fields and wakeup
projections must name canonical fields; contextual roles must name declared relations.
The registry exposes a deterministic `CompiledDisclosureRelation` table carrying
source type, field, cardinality, target allow-list, and optional inverse role, so
`get(context: true)` never reopens project definitions or hardcodes ADR/Requirement
edges. `resource` remains reserved as the generic-document search sentinel.

ADR 0113.1 specializes the Requirement flagship: recall remains the memory corpus,
while Requirements use wakeup, search, and get. The definition contract retains a
bounded recall projection for a future substrate whose declared semantics genuinely
belong in recall; no current packaged document is injected into `MemoryComposer`.

## Prompt substrate candidate

`docs/prompts/0001-tasks-and-vision.md` demonstrates a useful third substrate:

- a verbatim human directive, not an agent summary;
- chronological and numbered;
- immutable-ish: the body is append-only after capture;
- corrected by a later Prompt with `supersedes`, never silently edited;
- linkable through `spawned` to Requirements, ADRs, tasks, and proposals;
- attributable through `author`, `date`, and `captured_by`.

Prompt has no workflow status. Its semantic verb is `capture`, and its progressive
disclosure role is provenance: recall can find the original instruction; ADR/task
metadata can point back to the exact human words. Metadata relations may be appended
without changing the verbatim body.

ADR 0113 itself is spawned by **PROMPT 0001**.

Prompt remains a candidate rather than a flagship because the corpus is currently one
document. ADR and Requirement carry the stronger immediate proof burden.

## Runtime coexistence and what must change

ADR 0098's derivation map becomes a two-tier registry:

```text
ProjectSubstrateRegistry
├── validation router
│   ├── compiled Zod validators
│   └── runtime JSON Schema validators
├── identity strategy lookup        ← ADR 0112 service
├── type/status/relation metadata
├── search indexing metadata
├── semantic intent descriptors
├── wakeup/recall/get projections
└── serializable viewer registry
```

The important consequences are:

1. `EntityType` becomes a built-in convenience, not the type of every service filter.
2. Per-type Zod schemas validate built-ins; registry validation is the sole generic
   write boundary for `AnyEntity`.
3. `TYPE_PREFIXES`/`ID_PATTERN` cannot be module constants for project documents.
4. `IBacklogService` cannot keep `type?: EntityType` and `Entity[]` as its universal
   contract (`packages/server/src/storage/backlog-service.contract.ts:14-38`).
5. Search cannot retain its literal `SearchableType` union.
6. The viewer cannot retain `Record<EntityType, ...>` or a Task fallback.
7. Tool schemas cannot use a compile-time enum for runtime project types.
8. D1 may retain the closed compiled path under ADR 0104.

## File-level engineering plan

### Phase A — definition contract and compiler

- Add `packages/shared/src/substrates/substrate-definition.schema.ts`:
  versioned meta-schema for definition files and exported JSON Schema projection.
- Add `packages/shared/src/substrates/runtime-substrate.types.ts`:
  serializable definition, workflow, relation, intent, disclosure, and viewer DTOs.
- Add `packages/shared/src/runtime-entity.types.ts`:
  `RuntimeEntity`, `AnyEntity`, and open `SubstrateType`.
- Add `packages/server/src/core/substrates/compile-substrate-definition.ts`:
  pure meta-schema validation and bounded Ajv Draft 2020-12 compilation in strict
  mode.
- Add `packages/server/src/core/substrates/project-substrate-registry.ts`:
  composed compiled/runtime registry with validation and collision diagnostics.
- Add `packages/server/src/core/substrates/load-substrate-definitions.ts`:
  injected-read loader for the opaque definition paths discovered by ADR 0112.
- Add packaged ADR, Requirement, and Prompt definition data under
  `packages/server/src/substrate-definitions/`; embed it through a TypeScript data
  module so npm consumers receive it without runtime asset-path or filesystem
  assumptions. Project-authored definitions remain JSON.

### Phase B — open the core and storage contracts

- Update `packages/server/src/storage/backlog-service.contract.ts`,
  `storage-adapter.ts`, and local service/storage types from closed
  `Entity`/`EntityType` to `AnyEntity`/`SubstrateType` at generic boundaries.
- Route create/update validation through `ProjectSubstrateRegistry`; register the
  existing per-type Zod schemas as built-in validators and retire `EntitySchema` as the
  generic write router.
- Replace module-level type/ID helpers with the registry plus ADR 0112 identity
  service. Unknown identity must return unknown, never Task.
- Remove touched legacy field mirrors/fallbacks rather than carrying them into the new
  contracts. External-read mappings live only in the ingestion adapter.
- Keep lossless external reads and canonical managed writes explicit in the API.
- Do not extend D1 in this phase.

### Phase C — search, retrieval, and progressive disclosure

- Widen `packages/memory/src/search/types.ts` and Orama projections to runtime type
  strings while preserving `resource` as a document-kind sentinel.
- Index declared searchable fields without rebuilding the Orama schema per substrate;
  flatten them into existing searchable text plus generic type/status facets.
- Extend wakeup through registry-declared sections. Implement Requirement constraint
  ordering and truncation counts in transport-free core.
- Expose runtime substrate documents to recall/search and role-grouped
  `get(context: true)` stubs per ADR 0114; do not create a Requirement-only retrieval
  stack.

### Phase D — semantic intents and viewer registry

- Add `packages/server/src/core/substrates/execute-substrate-intent.ts` for the safe
  create/fixed-assignment/transition/relation algebra, including explicit compensated
  failure reporting for two-entity operations.
- Add `packages/server/src/tools/register-substrate-intents.ts` to generate thin,
  deferred semantic tools from explicit intent declarations.
- Add an HTTP/MCP registry projection endpoint.
- Replace `packages/viewer/type-registry.ts`'s exhaustive record with a reactive
  server-provided registry plus built-in boot fallback.
- Add a packaged icon/accent allowlist backed only by Tsa tokens.
- Make status badges render registry-provided classes and labels rather than the
  global five task states.

### Phase E — validation and migration ergonomics

- Add `backlog doctor` diagnostics for invalid definitions, external document drift,
  unresolved relations, duplicate identities, and noncanonical statuses.
- Add an explicit dry-run canonicalization command; never migrate on project open.
- Manually validate the real loop against this repo and Aime: discover, list, search,
  recall, render, create, transition, supersede, and follow relations.

### Unit-test plan

Per `AGENTS.md`, all automated tests remain unit tests with memfs and mocked external
dependencies:

- valid/invalid meta-schema cases;
- disabled remote refs and unsupported capabilities;
- deterministic duplicate/collision handling;
- packaged definition extended/replaced only by an explicitly versioned project
  declaration;
- malformed definition swallowed and logged while other types load;
- lossless ADR ingestion with no frontmatter, H1 title fallback, and labeled
  Git/mtime chronology;
- Aime-style multiline/open frontmatter preservation;
- strict canonical ADR/REQ/Prompt writes;
- thread identity normalization;
- substrate-specific workflow transitions;
- relation target/cardinality validation;
- Requirement wakeup ordering and truncation disclosure;
- generated intent names/descriptions and safe operation mapping;
- viewer fallback for unknown runtime types without Task misclassification.

Representative corpus documents are constructed through production parsing/storage
APIs in memfs. Tests do not read the real repository filesystem.

## Trade-offs and rejected alternatives

### Make every runtime definition a Zod module

Rejected. It requires executing project code, defeats portability, and creates a
remote-code-execution boundary. It also makes definitions unreadable to non-TypeScript
tools.

### Convert JSON Schema to Zod and keep `EntitySchema` universal

Rejected as the architectural contract. Zod's reverse conversion is experimental, and
a Zod discriminated union is still assembled from a closed branch list. A Zod adapter
may implement runtime validation internally, but the registry—not a static union—is
the authority.

### Treat ADR as generic Artifact with extra frontmatter

Rejected. Lifecycle, supersession, threading, semantic intents, requirement relations,
and progressive disclosure are behavior, not decoration.

### Generate CRUD tools for every schema automatically

Rejected. Schema shape cannot choose good domain language. Explicit declarative intents
generate only the verbs the substrate author names; generic tools remain the escape
hatch.

### Require full corpus conformance before indexing

Rejected. It makes zero-migration adoption impossible and would exclude most of this
repository's ADR history. Diagnostics plus strict future writes provide convergence
without coercive migration.

### Permit project validator plugins

Rejected. "Local project" is not equivalent to trusted executable code, especially
when repositories are cloned and opened by agents. Safe data definitions are a
load-bearing trust boundary.

### Give arbitrary definitions full UI styling

Rejected. It violates Tsa, creates injection and accessibility risks, and makes themes
unreliable. Definitions choose semantic presentation tokens from a closed catalog.

## Consequences

Positive:

- A project can teach backlog-mcp a domain object without forking or rebuilding it.
- Existing docs become useful immediately; adoption does not require migration.
- ADRs, Requirements, and Prompts remain plain frontmatter markdown readable by any
  human, editor, agent, or Git host.
- Rich semantics—workflow, relations, intents, wakeup/recall—are declared once.
- The runtime extension points expose and retire the remaining closed-union leaks from
  ADR 0098.
- Packaged ADR/REQ definitions prove user definitions are not a second-class plugin
  path.

Costs:

- Runtime user types lose compile-time exhaustiveness.
- Registry/session plumbing replaces convenient module constants.
- Strict-write versus lenient-read behavior is more complex and must be visible in
  diagnostics.
- Semantic intent generation requires a small declarative operation engine.
- Built-in Zod validators and declarative JSON Schema validators coexist behind one
  registry contract.

Risks:

- An overpowered meta-schema becomes a programming language. The bounded capability
  list and no-code rule are therefore permanent constraints.
- A weak identity seam could duplicate ADR 0112 logic. The semantic definition only
  requests an identity strategy; ADR 0112 remains the allocator and path authority.
- Requirements could become passive paperwork. Wakeup constraint stubs, compliance
  state, and explicit ADR relations are the countermeasure.
- Status vocabularies can fragment cross-type queries. Registry status classes provide
  the common projection; raw status remains substrate-specific.

## Acceptance criteria

1. With no migration, the server discovers and renders every markdown file in both
   ADR corpora, preserving bodies and unknown frontmatter.
2. New ADRs validate canonical status, thread identity, and relations.
3. New Requirements follow the intake lifecycle and independently track compliance.
4. Requirement warnings appear in wakeup within a bounded progressive-disclosure
   section with honest truncation.
5. Prompt 0001 is indexed as verbatim provenance and ADR 0113 links back to it.
6. A malformed or hostile definition cannot execute code, fetch a remote schema,
   escape the project, crash startup, or disable valid substrates.
7. The viewer renders a user type without a source-code icon/gradient edit.
8. Tool Search can discover explicitly declared substrate intents from their names and
   descriptions.
9. The local path ships without waiting for D1 parity.

## References

- ADR 0098 — Unified Substrate Architecture
- ADR 0104 — Local-First Deployment Posture
- ADR 0105 — Per-Repo Config and graceful degradation
- ADR 0106 — Semantic Intent Tools at the MCP Boundary
- ADR 0112 — Docs-native project backlog: discovery, layout, scope, and identity
- ADR 0114 — Fold context into wakeup/recall/search/get progressive disclosure
- `docs/prompts/0001-tasks-and-vision.md` — PROMPT 0001, the human directive that
  spawned this vision-uplift batch
- `/Users/goga/Documents/goga/aime/docs/adr/` — evolved ADR/thread corpus
- `/Users/goga/Documents/goga/aime/docs/requirements/` — Requirement intake corpus
- [JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12)
- [Zod JSON Schema conversion](https://zod.dev/json-schema)
- [Ajv JSON Schema support](https://ajv.js.org/json-schema.html)
- [Ajv security considerations for untrusted schemas](https://ajv.js.org/security.html)
