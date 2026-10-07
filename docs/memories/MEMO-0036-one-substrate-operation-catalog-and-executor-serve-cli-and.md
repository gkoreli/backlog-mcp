---
id: MEMO-0036
title: One substrate operation catalog and executor serve CLI and MCP
parent_id: EPIC-0001
created_at: '2026-10-07T14:35:42.099Z'
updated_at: '2026-10-07T14:35:42.099Z'
type: memory
layer: semantic
source: codex
entity_refs:
  - EPIC-0001
  - TASK-0012
tags:
  - architecture
  - semantics
  - intent-execution
supersedes: MEMO-0035
kind: current
---
Goga directed on 2026-10-07 that there must be one way to access substrate operations: the same substrate-owned operation catalog and executeSubstrateIntent authority must serve CLI and MCP. Updating and remembering become composable or declarative implementations of those operations, rather than independent public mutation paths. Do not retain generic CLI CRUD as a second normal operation model or fix the divergence with separate adapter/core-entry validators.
