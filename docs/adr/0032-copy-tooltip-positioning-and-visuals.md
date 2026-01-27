# 0032. Copy Tooltip Positioning and Visuals

**Date**: 2026-01-27
**Status**: Accepted
**Backlog Item**: TASK-0100

## Context

The copy button tooltip system (introduced in ADR-0029) has three issues:

1. **Tooltip appears outside viewport** - When copy buttons are near the top of the screen, the tooltip renders above the viewport edge and becomes invisible
2. **Copy Markdown button needs verification** - The "Copy Markdown" button has `data-copy` attribute but needs testing to confirm it works with the reusable system
3. **Visual design is basic** - Current tooltip styling is functional but could be more polished

### Current State

**Positioning (viewer/utils/copy-button.ts:38-39)**:
```typescript
let top = rect.top - 8;
```
- Always positions tooltip above the button
- Uses `transform: translate(-50%, -100%)` to move it up by its own height
- Handles horizontal overflow (lines 42-47) but not vertical
- No check if tooltip would be cut off at viewport top

**Copy Markdown (viewer/components/task-detail.ts:62)**:
```html
<button class="copy-btn copy-raw btn-outline" data-copy="${task.raw || ''}" title="Copy markdown">
```
- Has `data-copy` attribute which should work with the event delegation system
- Event listener uses `closest('[data-copy]')` so it should trigger
- Need to verify `task.raw` is populated correctly

**Visuals (viewer/styles.css:953-967)**:
```css
background: #2d2d30;
padding: 6px 12px;
border-radius: 4px;
```
- Basic dark gray background
- Simple fade animation (opacity only)
- No depth or visual polish

### Research Findings

- Horizontal positioning already handles viewport boundaries correctly
- The reusable copy system uses event delegation on document, so Copy Markdown should work
- Current CSS follows the existing design system (dark theme, simple animations)
- Task constraints: "Keep code minimal - only add what's necessary"

## Proposed Solutions

### Option 1: Minimal Fix - Smart Flip Only

**Description**: Add viewport boundary check for vertical positioning. If tooltip would be cut off at top, flip it to appear below the button instead.

**Implementation**:
```typescript
const tooltipHeight = 32; // approximate
let top = rect.top - 8;

if (top - tooltipHeight < 0) {
  top = rect.bottom + 8;
  tooltip.style.transform = 'translate(-50%, 0%)';
} else {
  tooltip.style.transform = 'translate(-50%, -100%)';
}
```

**Pros**:
- Minimal code change (~5 lines)
- Low risk, easy to test
- Solves the core positioning problem

**Cons**:
- Doesn't address visual improvements
- Doesn't verify Copy Markdown functionality
- Incomplete solution (only 1 of 3 issues)

**Implementation Complexity**: Low

### Option 2: Comprehensive Fix - Smart Positioning + Visual Polish

**Description**: Address all three issues in one cohesive update:
1. Smart vertical positioning with viewport checks
2. Improve CSS styling (box-shadow, better border-radius, subtle animation)
3. Test Copy Markdown button to verify it works

**Implementation**:
```typescript
// Positioning logic
const tooltipHeight = 32;
let top = rect.top - 8;
let transform = 'translate(-50%, -100%)';

if (top - tooltipHeight < 0) {
  // Flip to bottom if would be cut off at top
  top = rect.bottom + 8;
  transform = 'translate(-50%, 0%)';
}

tooltip.style.transform = transform;
```

```css
/* Visual improvements */
#copy-tooltip {
  background: #2d2d30;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  border-radius: 6px;
  /* ... */
}
```

**Pros**:
- Addresses all three requirements in the task
- Still minimal code (~10 lines JS, ~3 lines CSS)
- Cohesive solution, no need for follow-up work
- Visual improvements are subtle and consistent with existing design

**Cons**:
- More changes = more testing surface area
- Slightly higher risk than Option 1

**Implementation Complexity**: Low-Medium

### Option 3: Advanced - Popper-like Positioning System

**Description**: Build a comprehensive positioning engine that handles all viewport edges (top, bottom, left, right) with automatic flipping on any axis.

**Implementation**:
- Calculate available space on all four sides
- Choose optimal position based on available space
- Add arrow pointer to tooltip
- Support multiple positioning strategies

**Pros**:
- Most robust solution
- Handles all edge cases (corners, small viewports)
- Professional-grade positioning

**Cons**:
- Over-engineered for this use case
- Violates "minimal code" constraint
- Horizontal positioning already works correctly
- Adds unnecessary complexity
- Would require ~50+ lines of code

**Implementation Complexity**: High

## Decision

**Selected**: Option 2 - Comprehensive Fix

**Rationale**: 

Option 2 is the only proposal that actually addresses all three issues in the task while respecting the "minimal code" constraint. 

**Why not Option 1?** It's incomplete. The task explicitly asks for visual improvements and Copy Markdown verification. Ignoring 2 out of 3 requirements would necessitate another round of work later. This is lazy engineering.

**Why not Option 3?** It's over-engineering. The task says "Keep code minimal - only add what's necessary". We don't need to handle left/right flipping (already works) or add arrow pointers (not requested). This would be showing off rather than solving the actual problem.

**Why Option 2?** It's the right scope:
- Solves the positioning bug with simple logic
- Adds visual polish with minimal CSS changes
- Verifies Copy Markdown works (just testing)
- Stays within "minimal code" constraint (~13 lines total)
- No follow-up work needed

**Trade-offs Accepted**:
- Slightly more testing needed than Option 1
- Visual improvements are subjective (but follow existing patterns)

## Consequences

**Positive**:
- Tooltip never appears outside viewport
- More polished, professional appearance
- Copy Markdown button confirmed working
- All task requirements satisfied
- No breaking changes

**Negative**:
- Minimal additional code to maintain
- Need to test both top and bottom positioning scenarios

**Risks**:
- **Risk**: Transform change might affect animation timing
  - **Mitigation**: Keep same transition duration, test both positions
- **Risk**: Visual changes might not match design system
  - **Mitigation**: Use existing color palette, subtle changes only

## Implementation Notes

1. **Positioning logic**: Add before setting tooltip styles (line ~38)
2. **Tooltip height**: Use approximate value (32px) - exact height not critical since we have 8px margin
3. **Transform**: Must change dynamically based on position (above vs below)
4. **CSS changes**: Add to existing `#copy-tooltip` rule, don't create new rules
5. **Testing**: Test with buttons at top of viewport, middle, and bottom
6. **Copy Markdown**: Verify `task.raw` is populated in task-detail component
