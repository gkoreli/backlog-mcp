# 0044. Search API Relevance Scores

**Date**: 2026-01-31
**Status**: Accepted
**Backlog Item**: TASK-0149

## Context

The Spotlight search UI displays relevance scores as percentages, but all results show 100% because the API doesn't return the actual scores from Orama search.

### Root Cause

In `BacklogService.list()`, search results are mapped to tasks, discarding the score:

```typescript
return results.map(r => r.task);  // Drops r.score
```

The UI expects `task.score` but gets `undefined`, defaulting to 1 (100%).

## Proposed Solutions

### Option A: Attach score to task object

```typescript
return results.map(r => ({ ...r.task, score: r.score }));
```

**Pros**: 1 line change, backward compatible, no API changes
**Cons**: Score isn't a Task field (impure)
**Complexity**: Low

### Option B: New /search endpoint

Dedicated endpoint returning `SearchResult[]` with proper types.

**Pros**: Clean separation, proper types
**Cons**: More code, UI needs different endpoint
**Complexity**: Medium

### Option C: Change list() return type

Return `Task[] | SearchResult[]` based on query presence.

**Pros**: Type-safe
**Cons**: Breaking change, complex union type
**Complexity**: High

## Decision

**Selected**: Option A - Attach score to task object

**Rationale**: The UI already handles this with `(task as any).score ?? 1`. This fix makes it work with minimal change. The "impurity" is acceptable given the pragmatic benefit.

## Consequences

**Positive**:
- Spotlight shows actual relevance percentages
- Higher relevance items visually distinguished
- No API changes required

**Negative**:
- Score field not in Task type (accessed via `any`)

## Implementation Notes

Single line change in `src/storage/backlog-service.ts` line 55.
