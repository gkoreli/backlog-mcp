---
id: TASK-0018
title: 'ADR 0134 Phase 2: own the remaining ports in core'
status: open
parent_id: EPIC-0002
created_at: '2026-09-28T22:38:09.281Z'
updated_at: '2026-09-28T22:38:09.281Z'
type: task
---
Move `IBacklogService` (`storage/backlog-service.contract.ts`, 17 core importers)
and the `GitRunner` type (`storage/local/git-runner.ts`) into core contracts,
and the `ResourceContent` type core uses from `resources/manager.ts`.

`IBacklogService` imports `storage/storage-adapter.ts` and `resources/manager.ts`
types, so those types need a core home first. Done when the matching
`core-outward` entries are gone from `KNOWN_VIOLATIONS`.
