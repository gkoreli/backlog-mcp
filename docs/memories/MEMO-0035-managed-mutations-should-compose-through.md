---
id: MEMO-0035
title: Managed mutations should compose through executeSubstrateIntent
parent_id: EPIC-0001
created_at: '2026-10-07T14:35:11.296Z'
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
valid_until: '2026-10-07T14:35:42.099Z'
kind: current
---
Goga directed on 2026-10-07 that executeSubstrateIntent should be the single mutation authority: updating and remembering should be composable or declarative implementations executed through it. CLI and MCP remain simple wrappers of core. Treat separate core entry points with independent action enforcement as an incomplete architecture, rather than solving the discrepancy with adapter-owned checks.
