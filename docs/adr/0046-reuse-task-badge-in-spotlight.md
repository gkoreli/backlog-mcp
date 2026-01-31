# 0046. Reuse task-badge Component in Spotlight Search

**Date**: 2026-01-31
**Status**: Accepted
**Backlog Item**: TASK-0151

## Context

Spotlight search results currently render task/epic icons and IDs using custom inline HTML:
```html
<svg-icon src="${icon}" class="spotlight-result-icon"></svg-icon>
<span class="spotlight-result-id">${r.task.id}</span>
```

We already have a `<task-badge>` component that renders the same pattern consistently across the task-list. This creates code duplication and potential styling inconsistencies.

### Current State

- `task-badge.ts`: Renders `<svg-icon>` + `<span>` with gradient icon styling
- `spotlight-search.ts`: Duplicates this pattern with different styling (gray icons)
- Both import `epicIcon, taskIcon` from icons/index.js

## Proposed Solutions

### Option 1: Direct Replacement with CSS Context Styling

Replace the inline HTML with `<task-badge>` and use CSS cascade for context-specific styling.

**Pros:**
- Minimal code change (2-3 lines TS, remove unused CSS)
- Single source of truth for badge rendering
- Gradient icons provide visual consistency with task-list
- Follows component reuse best practices

**Cons:**
- None significant

**Implementation Complexity:** Low

### Option 2: Add Variant Attribute to task-badge

Add `variant="spotlight"` attribute to task-badge for context-specific rendering.

**Pros:**
- Explicit control over variants

**Cons:**
- Overengineered for single use case
- Violates YAGNI
- Adds complexity to task-badge

**Implementation Complexity:** Medium

## Decision

**Selected**: Option 1 - Direct Replacement with CSS Context Styling

**Rationale**: This is a straightforward component reuse. The task-badge component already does exactly what spotlight needs. CSS cascade is the standard way to handle context-specific styling. Adding variant attributes for a single consumer would be premature abstraction.

**Trade-offs Accepted**:
- Icons will change from gray to gradient (improvement, not regression)

## Consequences

**Positive**:
- Eliminates code duplication
- Consistent badge rendering across the app
- Removes unused icon imports from spotlight-search.ts
- Cleaner CSS (remove unused spotlight-result-icon/id rules)

**Negative**:
- None

## Implementation Notes

1. Replace inline HTML in `renderResults()` with `<task-badge>`
2. Remove `epicIcon, taskIcon` imports from spotlight-search.ts
3. Remove unused `.spotlight-result-icon` and `.spotlight-result-id` CSS rules
