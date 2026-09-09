---
title: "0132 — Preserve intent parents and registry-defined memory provenance"
date: 2026-09-08
status: "Implemented — released in 0.74.1"
author: Codex
relates_to:
  - 0106.5-intent-write-surface.md
  - 0113-user-defined-substrates.md
  - 0129.1-one-document-address.md
---

# 0132 — Preserve intent parents and registry-defined memory provenance

## Evidence and audit

[Issue #121](https://github.com/gkoreli/backlog-mcp/issues/121) reports that
`backlog_attach_artifact` rejects an explicitly supplied epic parent.
`core/substrates/execute-substrate-intent.ts:createParams` keeps that parent in
`fields`, while `core/create.ts` routes only the top-level `parent_id`.
Optional-parent intents can also have their explicit parent overwritten by
the routing defaults.

[Issue #120](https://github.com/gkoreli/backlog-mcp/issues/120) and TASK-0002
report that memory provenance rejects requirements and docs-native IDs.
`core/remember.ts` uses the compiled built-in `isValidEntityId` vocabulary;
the selected home's `ProjectSubstrateRegistry` already holds the complete
identity declarations. Search derives its ID rules from those declarations
in `packages/memory/src/search/query-intent.ts`.

## Rulings and engineering plan

1. Promote the compiled create intent's resolved `parent_id` to the core
   create parameter before routing. Fixed fields retain precedence. Keep
   arbitrary substrate fields in the field bag, preserving their declared
   types. Cover required and optional parents against conflicting defaults,
   plus rejection before writes when a required parent is absent.
2. Validate memory provenance against the selected registry's storage
   identities, accepting canonical display IDs and the established space/hyphen
   aliases. Store aliases in canonical form. Keep minimum digit widths and
   threading rules, reject unknown prefixes and malformed IDs, and retain
   built-in validation when no registry is supplied. This remains identity
   validation, without a new live-document existence requirement.
3. Pass the selected registry through MCP and CLI dependencies to core.
   `context` and memory-only `supersedes` retain their existing contracts.
   Cover packaged and project declarations, home isolation, and rejection
   before memory storage or journaling.
4. Add unit regressions with mocked external dependencies, run server
   checks, and manually exercise the public tools in an isolated temporary
   home. Record outcomes here and in the unreleased changelog.

## Engineering record

The executor now promotes the compiler-resolved parent before calling core.
`core/normalize-memory-refs.ts` recognizes canonical IDs through storage claims
and derives supported aliases from search's identity specifications. Both
adapters pass the selected registry to `remember`; no global prefix list was
expanded. REF and AGENT are project declarations, so a home without those
declarations correctly rejects their IDs even though this repository uses them.

The initial regression run reproduced both the artifact rejection and silent
task-parent overwrite (`EPIC-0001` became the default `FLDR-0099`). After the
fix, the server unit suite passed: 1,431 tests, 2 skipped. Server build and
TypeScript checking passed.

A separate Node process served the rebuilt production HTTP/MCP app on an
ephemeral loopback port with real filesystem homes under a temporary directory.
The public tools created an epic, attached the exact reported artifact, created
a ruled requirement, and remembered it with epic/requirement/ADR/reference
provenance. `backlog_get` confirmed the persisted artifact parent and canonical
memory references. Missing or malformed parents and unknown, traversal-shaped,
short, and newline-suffixed references failed without adding operation rows.
A second home rejected the first home's project-only reference prefix. The
rebuilt CLI also completed `remember --refs REQ-0001,ADR-0114,REF-0015`.
The temporary homes, listeners, and runtimes were removed or closed afterward.

The initial implementation required no data migration and did not publish a
release. These fixes are included in release 0.74.1 (2026-09-09 UTC). The running
daemon picks them up after an update/restart.
