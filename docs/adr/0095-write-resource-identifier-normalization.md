---
title: "Write-Resource Identifier Normalization — Core-Layer Approach"
date: 2026-04-23
status: Accepted
---

# 0095. Write-Resource Identifier Normalization — Core-Layer Approach

## Context

The `write_resource` MCP tool was refactored from URI-based params to ID-based params:

```
Before: { uri: "mcp://backlog/tasks/TASK-0001.md", operation: {...} }
After:  { id: "TASK-0001", operation: {...} }
```

The viewer's activity panel crashed when expanding any `write_resource` operation:

```
TypeError: Cannot read properties of undefined (reading 'split')
  at renderDiffHtml
```

The operations log contains both formats (old entries with `uri`, new entries with `id`).

## Problem Space

The deeper issue: the operation log stores raw tool params, and every consumer (viewer,
CLI, future consumers) had to know the internal param shape of `write_resource` to extract
metadata like the target filename. This is tight coupling — when the tool's API changed,
every consumer broke.

Four breakage points in the viewer:
1. `isStrReplace()` type guard — lied about `params.uri` existence
2. `mergeConsecutiveEdits()` — grouped by `params.uri` (undefined for new entries)
3. `renderDiffHtml()` — called `.split('/')` on undefined
4. `groupByTask()` — fallback used `params.uri`

## Proposals

### A. Viewer-only fix (rejected)

Put a `getWriteResourceTarget()` helper in the viewer. Quick fix, but the same problem
repeats for any new consumer (CLI, mobile, etc.).

### B. Core-layer normalization (selected)

Move the knowledge of write_resource param shapes into the operations core layer.
The server provides normalized fields (`resourceId`, `targetFilename`) so consumers
never need to parse raw params for metadata.

- **Pro**: Any consumer (viewer, CLI, future) gets normalized data automatically
- **Pro**: Single source of truth for param shape knowledge
- **Pro**: Works for both local and Hono-hosted deployments
- **Con**: Requires server + viewer changes (but they're independent — viewer degrades gracefully)

### C. Normalize at storage time

Rewrite old JSONL entries to the new format.

- **Con**: Destructive, complex migration, doesn't help D1 entries

## Decision

**Proposal B** — core-layer normalization.

### Architecture

```
┌─────────────────────────────────────────────────────┐
│ Core: operations/resource-id.ts                     │
│   extractResourceId(tool, params, result) → string  │  ← handles both uri/id
│   extractTargetFilename(tool, params) → string      │  ← NEW: display filename
├─────────────────────────────────────────────────────┤
│ Enrichment: hono-app.ts /operations endpoint        │
│   Adds: resourceId, resourceTitle, epicId,          │
│         epicTitle, targetFilename                   │  ← NEW field
├─────────────────────────────────────────────────────┤
│ Consumers: viewer, CLI, etc.                        │
│   Read: op.resourceId, op.targetFilename            │
│   Never parse: op.params.uri, op.params.id          │
└─────────────────────────────────────────────────────┘
```

For this decision to be correct:
- The enrichment layer always runs before data reaches consumers
- Old operations have `resourceId` set at write time (confirmed in JSONL)
- `extractTargetFilename` handles both `uri` and `id` param formats

## Consequences

**Positive**:
- Crash fixed for both old and new operation entries
- Any future consumer gets normalized data — no coupling to tool param shapes
- If `write_resource` params change again, only `resource-id.ts` needs updating
- Merge grouping uses `resourceId` (stable, server-provided) instead of raw params

**Negative**:
- Viewer keeps a deprecated private `getWriteResourceTarget` fallback for the edge case
  where the viewer is newer than the server (no `targetFilename` in response yet)

## Implementation Notes

- `extractTargetFilename` is a pure function — safe to import in Workers bundle
- `resource-id.ts` has no Node.js dependencies (unlike `operations/index.ts`)
- Viewer's `isStrReplace` changed from lying type predicate to honest boolean
- Viewer's `mergeConsecutiveEdits` groups by `op.resourceId` with fallback to private helper
