# 0064. Fix SSE event handling for resource_changed

**Date**: 2026-02-06
**Status**: Accepted
**Backlog Item**: TASK-0252

## Context

The backlog viewer uses SSE for real-time UI updates. The server emits four event types: `task_created`, `task_changed`, `task_deleted`, and `resource_changed`. The `resource_changed` type is emitted when `write_resource` modifies a task's markdown file.

Two of three UI components (task-list and task-detail) only handle `task_changed`, `task_created`, and `task_deleted` events. They ignore `resource_changed`, causing stale UI when agents update task content via `write_resource`. The activity panel already handles all events correctly (no type filter).

## Decision

Add `resource_changed` to the event type conditions in the task-list and task-detail SSE handlers. This is a minimal inline fix — no new abstractions, no shared constants, no architectural changes.

### Alternatives Considered

1. **Centralized event routing with semantic categories** — Move type filtering into the BacklogEvents service with category-based subscriptions. Rejected: over-engineering for a 2-line fix. Adds abstraction for a system with 4 event types and 3 components.

2. **Unified server event with rich payload** — Collapse all event types into a single `backlog_change` event. Rejected: breaking protocol change with no immediate user benefit. Solves a problem we don't have.

## Consequences

- Task list refreshes on `write_resource` changes (preserving active filters)
- Task detail auto-refreshes when the viewed task is modified via `write_resource`
- Event type strings remain duplicated across components (accepted trade-off)
- If a 5th event type is added, each component must be updated manually
