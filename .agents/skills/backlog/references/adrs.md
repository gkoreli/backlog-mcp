# Native ADRs and existing decision documents

Read for architectural decisions, ADR discovery, lifecycle actions, and adopting
an existing decision corpus. Read [Threads](threads.md) for focused amendments,
selective reading, and explicit scope of supersession or overruling.

## Native contract

ADR is a compiled built-in entity alongside task and memory. Its canonical schema
and identity belong to the engine; the selected home's registry exposes its
propose, accept, and supersede actions. Requirement and prompt remain default
packaged declarations. Inspect installed help and tool schemas: older releases
used a replaceable packaged ADR definition and lack the new description contract.

Default ADR documents live beneath `docs/adr/`, including nested directories.
Display IDs are `ADR 0106.7`; filenames are `0106.7-revise-operation-contracts.md`.
The numeric key identifies the document and the slug previews its subject.
Managed proposals generate their own IDs, optionally joining a supplied `thread`.

## Describe before hydrating

Every new managed proposal requires an authored `description` targeting roughly
50 tokens. Keep it specific: what decision does this document establish, and when
should another agent read it? The engine enforces a maximum of 320 characters;
that is a deterministic size bound, not an exact model-token count. It never
summarizes with a server LLM.

List and search return the short description, actual source path, thread root and
immediate thread parent, and selected frontmatter such as date/decision lineage.
Full bodies remain behind get or explicit content retrieval. Search can index
bodies without eagerly returning them. Older native or previously managed ADRs
may lack descriptions; add them deliberately rather than inventing summaries.

```bash
backlog --home project --project-root /absolute/repo list --type adr
backlog --home project --project-root /absolute/repo search 'operation contracts' --types adr
backlog --home project --project-root /absolute/repo get 'ADR 0106.7' --context
```

Inspect the compact cues first, then hydrate the matching decision and relevant
accepted amendments. Search results are bounded; a missing successor in the
results does not prove the decision has never been amended.

## Capture and lifecycle

Discover the action contract with `backlog actions adr --json`, or expand the
selected MCP tool schema. An input for `backlog_propose_adr` / `adr.propose` is:

```json
{
  "thread": "ADR 0106",
  "title": "Revise operation contracts",
  "description": "Requires one declared action catalog and shared core validation across CLI and MCP; read before changing managed write semantics.",
  "content": "## Context\n...\n\n## Decision\n...\n\n## Effect on earlier rulings\n...",
  "extends": ["ADR 0106"]
}
```

Omit thread to create a root. Core validates a supplied thread and atomically
allocates the next child beside that document. `thread` is not a persisted field,
`parent_id`, or an implicit extension/supersession relation. Include those semantic
relations explicitly when they apply.

Use the returned ID in `adr.accept` / `backlog_accept_adr` only when the decision
has actually been ratified. Whole-document replacement uses `adr.supersede` /
`backlog_supersede_adr` with `replacement_id` and `superseded_id`; it records
lineage and transitions the replaced decision. Partial amendments name the exact
rulings overruled in Markdown and preserve the remaining decision's authority.

## Native authoring and safe adoption

Humans and agents can read/write the same Markdown with native tools. A minimal
canonical document is:

```yaml
---
id: "ADR 0106.7"
type: adr
title: Revise operation contracts
description: Use one declared action catalog and shared core validation for managed writes.
status: proposed
date: "2026-10-07"
extends:
  - "ADR 0106"
---
```

Quote ISO dates so YAML keeps them as strings. Its Markdown body follows the
frontmatter. Native authors can assign IDs; managed
actions allocate automatically. Inspect existing IDs, headings, frontmatter,
statuses, and collision diagnostics before adoption. Do not normalize old files
merely to fit managed writing. Annotated statuses such as "Accepted — shipped"
remain native prose, not the exact canonical lifecycle state `accepted`.

Pre-promotion managed ADRs retain lifecycle compatibility without descriptions or
timestamps. Noncanonical native documents still require explicit adoption before
managed rewriting. Preserve their original bytes when performing retrieval.

Compiled ADR cannot be replaced through `docs/substrates/adr.json`. If the project
needs a different document vocabulary, declare an additional type with its own
nonoverlapping folder and identity namespace; use [Custom substrates](custom-substrates.md).
That type can adopt the same thread allocation and compact discovery concepts.
