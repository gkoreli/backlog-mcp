---
id: ADR 0043
type: adr
title: Spotlight Search UX Improvements
status: accepted
date: '2026-01-31'
description: >-
  Refines Spotlight interaction and result usability after the initial search
  surface. Addresses the concrete navigation and display friction found in
  everyday use, preserving the historical scope of the UX changes.
evidence:
  - 'Historical body status: "Accepted"'
  - 'Historical body backlog item: TASK-0148'
---
# 0043. Spotlight Search UX Improvements

**Date**: 2026-01-31
**Status**: Accepted
**Backlog Item**: TASK-0148

## Context

The Spotlight search UI (TASK-0144, ADR-0039) works but has several UX issues:

1. **Navigation bugs**: Escape takes user to home page; selecting task doesn't set epic_id in URL
2. **Inconsistent icons**: Custom folder/file icons instead of existing epic/task icons
3. **Insufficient context**: Only title shown - need snippets to understand results
4. **Missing IDs**: Task/Epic IDs not displayed
5. **No hit count**: Can't see how many times search term appears
6. **Ranking opaque**: Can't see relevance score
7. **Modal too small**: Limited space for results

### Current State

- `spotlight-search.ts` uses custom SVG icons for epic/task
- `selectResult()` only sets `task` param, not `epic`
- Escape handler doesn't stop propagation, allowing task-list's global Escape handler to fire
- Snippets are ~100 chars, single line, no markdown
- Score available from Orama but not displayed

### Research Findings

**Escape Bug Root Cause**: In `task-list.ts`, a global keydown listener navigates to parent epic on Escape. The spotlight's `e.preventDefault()` doesn't stop this because it's a separate listener. Need `e.stopPropagation()`.

**Navigation Bug Root Cause**: `selectResult()` calls `urlState.set({ task: id })` but doesn't set `epic` param. The task has `epic_id` property that should be used.

**Icon Reuse**: `viewer/icons/index.ts` exports `epicIcon` and `taskIcon` that should be used instead of inline SVGs.

## Proposed Solutions

### Option 1: Minimal Fixes (Surgical Changes)

Fix only the bugs with minimal code changes:
- Add `e.stopPropagation()` to Escape handler
- Set both `task` and `epic` in selectResult
- Replace inline SVGs with imported icons
- Add ID display, increase snippet to 150 chars
- Show score as percentage badge

**Pros**:
- Minimal code changes, low risk
- Fast to implement

**Cons**:
- Single-line snippets still insufficient
- No markdown rendering
- Percentage score is arbitrary

**Implementation Complexity**: Low

### Option 2: Rich Snippets with Multi-line Context

Enhanced result items with proper context:
- All fixes from Option 1
- Multi-line snippets (2-3 lines) with markdown rendering
- Visual score bar
- Field indicator showing which field matched
- Larger modal (750px wide)

**Pros**:
- Rich context addresses main user complaint
- Markdown preserves formatting

**Cons**:
- Score bar takes vertical space
- Each result becomes tall (only 3-4 visible)
- Markdown rendering could be slow
- Over-designed

**Implementation Complexity**: Medium

### Option 3: Two-Pane Layout with Preview

Split modal with results list and preview pane:
- 40% results list, 60% preview
- Compact result items (icon, ID, title, score)
- Preview shows full markdown content
- 900px wide modal

**Pros**:
- Maximum context before selecting
- Professional UX (like VS Code, Linear)

**Cons**:
- Overkill for quick search
- 900px modal feels heavy
- Significant complexity
- Users want QUICK search, not browsing

**Implementation Complexity**: High

## Decision

**Selected**: Hybrid of Options 1 and 2 - Enhanced Single-Pane with Rich Snippets

**Rationale**:
1. Fixes ALL critical bugs (navigation, icons)
2. Addresses main complaint (insufficient context) with multi-line snippets
3. Keeps UI simple and fast - spotlight should be quick
4. Reuses existing components (`<md-block>`, icon imports)
5. Avoids over-engineering (no preview pane, no score bars)

**Trade-offs Accepted**:
- Taller result items mean fewer visible at once (acceptable for better context)
- Markdown rendering adds slight latency (mitigated by 10 result limit)

## Consequences

**Positive**:
- Users can identify correct result from snippet context
- Navigation works correctly (epic expands, task selects)
- Consistent icons with rest of UI
- Score visibility helps understand ranking

**Negative**:
- Slightly more complex result rendering
- Larger modal takes more screen space

**Risks**:
- Markdown in snippets could be slow → Mitigated by result limit and simple snippets

## Implementation Notes

### Final Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│ 🔍 [Search tasks and epics...                            ] esc     │
├─────────────────────────────────────────────────────────────────────┤
│ [epic-icon] EPIC-0002 • Backlog MCP 10x              [open] [92%]  │
│ ┌─────────────────────────────────────────────────────────────────┐│
│ │ ...the **spotlight** search allows users to quickly find...    ││
│ │ tasks by typing keywords. Results show highlighted matches...  ││
│ └─────────────────────────────────────────────────────────────────┘│
│ description • 3 matches                                            │
├─────────────────────────────────────────────────────────────────────┤
│ [task-icon] TASK-0144 • Implement Spotlight Search   [done] [85%]  │
│ ┌─────────────────────────────────────────────────────────────────┐│
│ │ Add spotlight modal with keyboard navigation and fuzzy...      ││
│ └─────────────────────────────────────────────────────────────────┘│
│ title • 1 match                                                    │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Changes

1. **Escape fix**: Add `e.stopPropagation()` in keydown handler
2. **Navigation fix**: `urlState.set({ task: id, epic: task.epic_id || null })`
3. **Icons**: Import `epicIcon`, `taskIcon` from `icons/index.ts`, use `<svg-icon>`
4. **ID display**: Add ID span with distinct styling before title
5. **Rich snippets**: Increase to ~200 chars, use `<md-block>` for rendering
6. **Hit count**: Count `highlighter.positions.length`, show "N matches"
7. **Score badge**: Small percentage badge next to status
8. **Modal size**: 700px wide, 500px results height
