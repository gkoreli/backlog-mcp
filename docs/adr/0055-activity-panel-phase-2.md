# 0055. Activity Panel Phase 2: Actor Attribution, diff2html, Badge, Polling

**Date**: 2026-02-02
**Status**: Accepted
**Backlog Item**: TASK-0176

## Problem Statement

The activity panel from TASK-0175 shows WHAT operations happened, but not WHO performed them. When agents work autonomously, users lose the narrative of how work got done. Additionally, the diff rendering is basic, there's no operation count badge, and the panel doesn't auto-refresh.

## Problem Space

### Why This Problem Exists

1. TASK-0175 focused on core logging infrastructure, deferring actor attribution
2. Simple diff was a shortcut - diff2html was mentioned but not implemented
3. Count endpoint was built but not wired to UI
4. Polling was deferred as "nice to have"

### Who Is Affected

- Users delegating work to agents - need to know what the agent did
- Users reviewing task history - need to understand the full story
- Users with activity panel open - want to see new operations without manual refresh

### Problem Boundaries

**In scope**: Actor attribution, diff2html, count badge, polling, logger refactor

**Out of scope**: Real-time websockets, task versioning, git integration

### Adjacent Problems

1. Delegation system (studio-agents) needs to set env vars when spawning agents
2. Logger.ts architecture is messy (addressed in this task)

### Problem-Space Map

**Dominant causes**: TASK-0175 shortcuts, missing actor context in env vars

**Alternative root causes**: Delegation system might not set env vars yet

**What if we're wrong**: If agents never set env vars, actor attribution won't work. But infrastructure should be ready.

## Context

### Current State

- OperationLogger logs write operations to JSONL
- ActivityPanel shows operations with expandable rows
- `/operations/count/:taskId` endpoint exists but unused
- Simple inline diff for str_replace (not diff2html)
- No polling/auto-refresh

### Research Findings

- diff2html library provides unified diff rendering (~50KB)
- Page Visibility API enables efficient polling (pause when hidden)
- Actor info can be read from env vars at module load

## Proposed Solutions

### Option 1: Incremental Enhancement `[SHORT-TERM]` `[MEDIUM]`

Add each feature to existing files without restructuring.

**Differs from others by**:
- vs Option 2: No file restructuring
- vs Option 3: Implements all features, not sequenced

**Pros**: Fastest, minimal changes
**Cons**: Technical debt remains, harder to test

| Anchor | Score | Justification |
|--------|-------|---------------|
| Time-to-ship | 5 | Fastest path |
| Risk | 3 | Adding to messy code |
| Testability | 2 | Mixed concerns |
| Future flexibility | 2 | Debt remains |
| Operational complexity | 5 | No new systems |
| Blast radius | 4 | Localized changes |

### Option 2: Refactor-First `[MEDIUM-TERM]` `[HIGH]`

Refactor logger.ts into proper architecture, then add features.

**Differs from others by**:
- vs Option 1: Restructures before features
- vs Option 3: Full refactor upfront

**Pros**: Clean architecture, testable
**Cons**: More time, refactoring risk

| Anchor | Score | Justification |
|--------|-------|---------------|
| Time-to-ship | 2 | Longer path |
| Risk | 3 | Refactoring risk |
| Testability | 5 | Clean separation |
| Future flexibility | 5 | Proper architecture |
| Operational complexity | 4 | More files |
| Blast radius | 3 | More code touched |

### Option 3: Feature-First, Refactor-Later `[SHORT-TERM]` `[MEDIUM]`

Implement features first, then refactor as separate commit.

**Differs from others by**:
- vs Option 1: Includes refactor, sequenced
- vs Option 2: Features first

**Pros**: Features ship fast, refactor isolated, verify before refactor
**Cons**: Two passes, temporary messiness

| Anchor | Score | Justification |
|--------|-------|---------------|
| Time-to-ship | 4 | Features fast |
| Risk | 4 | Verified before refactor |
| Testability | 4 | Tests after refactor |
| Future flexibility | 5 | Clean architecture |
| Operational complexity | 4 | Two commits |
| Blast radius | 4 | Isolated changes |

## Decision

**Selected**: Option 3 - Feature-First, Refactor-Later

**Rationale**: Task explicitly separates features from "Technical Debt" refactor. Features first lets us verify they work, then refactor with confidence. Score: 25 vs 21 vs 22.

**For this decision to be correct**:
- Features can be added without major structural changes
- Refactor doesn't break features
- Two-pass approach doesn't introduce bugs

**Trade-offs Accepted**:
- Temporary code messiness before refactor
- Two review passes

## Consequences

**Positive**:
- Users see who made each change
- Proper diff rendering with syntax highlighting
- Badge shows operation count at a glance
- Panel stays current with polling

**Negative**:
- diff2html adds ~50KB to bundle
- Polling adds network requests (mitigated: visibility detection)

## Implementation Notes

### Phase A: Features

1. **Actor Attribution**
   - Add Actor interface with type, name, delegatedBy, taskContext
   - Read from env vars: BACKLOG_ACTOR_TYPE, BACKLOG_ACTOR_NAME, BACKLOG_DELEGATED_BY, BACKLOG_TASK_CONTEXT
   - Include actor in OperationEntry
   - Display in activity panel with "You" vs "agent-name (delegated by you)"

2. **diff2html**
   - Install diff2html package
   - Generate unified diff from old_str/new_str
   - Render with Diff2Html.html() in expanded content

3. **Count Badge**
   - Add badge to activity button in task-detail.ts
   - Fetch from `/operations/count/:taskId`
   - Update on task change

4. **Polling**
   - 30 second interval
   - Page Visibility API to pause when hidden
   - Clear on disconnect

### Phase B: Refactor

Split logger.ts into:
- `types.ts` - Actor, OperationEntry, ToolName
- `resource-id.ts` - extractResourceId with per-tool extractors
- `storage.ts` - OperationStorage class
- `logger.ts` - OperationLogger orchestration
- `index.ts` - Public exports
