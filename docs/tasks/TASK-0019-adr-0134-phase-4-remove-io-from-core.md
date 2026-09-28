---
id: TASK-0019
title: 'ADR 0134 Phase 4: remove IO from core'
status: open
parent_id: EPIC-0002
created_at: '2026-09-28T22:38:10.394Z'
updated_at: '2026-09-28T22:38:10.394Z'
type: task
---
Replace the `node:fs`/`node:os` defaults in `core/backlog-home.ts`,
`core/config.ts`, and `core/document-discovery.ts` with required injected
dependencies wired in composition. Move `core/migrate-docs-native.ts` to an
infrastructure migration module, and inject the `BacklogMemoryStore` fallback
that `core/wakeup.ts` constructs. Done when `core-io` is empty and the wakeup
entry leaves `core-outward`.
