---
id: MEMO-0016
title: Compiled create intents must promote parent_id before core routing
parent_id: FLDR-0001
created_at: '2026-09-09T00:53:04.906Z'
updated_at: '2026-09-09T00:53:04.906Z'
type: memory
layer: procedural
source: 'aime:granite'
tags:
  - intents
  - routing
  - gotcha
kind: timeless
---
Issue #121 exposed a split between the compiled intent field bag and core/create.ts routing: createEntity reads params.parent_id before spreading params.fields into the stored entity. Leaving the parent only in fields makes required-parent artifacts fail and lets optional-parent tasks be silently reparented by scope/session defaults. execute-substrate-intent.ts now promotes the compiler-resolved parent_id (after fixed-field precedence) to the core parameter. Regression coverage must exercise routing with a conflicting default parent, not just inspect the compiled field bindings. ADR 0132 records the reproduction and real HTTP/MCP validation.
