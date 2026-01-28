# 0033. Folder-Style Epic Navigation

**Date**: 2026-01-27
**Status**: Accepted

## Context

Users need to work with nested epics (Epic A → Epic B → Tasks). The original implementation showed everything in a flat list with one level of nesting support, causing issues when epics were nested deeper.

### Problem Statement

**Original issue**: When epics are nested under other epics (Epic A → Epic B → Tasks), the tasks under second-tier epics don't appear in the UI.

**Root cause**: The rendering logic only processed root epics and their direct children, missing nested epic descendants.

### Product Vision Evolution

Initial approach was to implement recursive nested rendering (show everything in one tree). However, this creates:
- Cognitive overload (seeing 50+ nested items at once)
- Hard to focus on one epic's work
- Scrolling nightmare with deep nesting
- Visual clutter from indentation and tree lines

**Key insight**: Users don't want to see everything at once. They want to **navigate into epics like folders**.

This matches successful tools:
- **Jira**: Click epic → see only that epic's issues
- **Linear**: Click project → see only that project's issues
- **File explorers**: Click folder → see only that folder's contents

## Decision

Implement folder-style navigation where clicking an epic "enters" it, showing only its direct children. Use breadcrumb navigation to move back up the hierarchy.

### Core Behaviors

**Home Page (Root Level)**:
- Show only root epics (no epic_id)
- Show only orphan tasks (no epic_id)
- Hide nested epics and tasks belonging to epics
- Display child count on all epics

**Inside Epic**:
- Show the current epic at top (visually distinct)
- Show only direct children (tasks and sub-epics)
- Breadcrumb shows path: All Tasks > Epic A > Epic B
- Epic is auto-selected (detail shown in right pane)

**Navigation**:
- Click epic → navigate into it AND select it
- Click breadcrumb segment → navigate to that level
- Click logo/home → navigate to root
- Browser back button → navigate up (via URL state)
- No toggle behavior (clicking current epic just updates selection)

**Removed Features**:
- Pin functionality (replaced by navigation)
- Collapse/expand (replaced by navigation)

## Implementation

### Changes Made

**1. Breadcrumb Component** (`viewer/components/breadcrumb.ts`)
- Always visible (prevents layout shift)
- Shows "All Tasks" at root
- Truncates long titles with ellipsis
- Each segment clickable to navigate up

**2. Task List** (`viewer/components/task-list.ts`)
- Renamed `pinnedEpicId` → `currentEpicId`
- Home page filtering: only root epics and orphan tasks
- Inside epic: show epic + direct children
- Removed collapse/expand logic and localStorage
- Always calculate and show child counts

**3. Task Item** (`viewer/components/task-item.ts`)
- Removed pin button
- Removed collapse button
- Epic click navigates into epic AND selects it
- No toggle behavior (check if already inside)

**4. Main App** (`viewer/main.ts`)
- Integrated epic navigation with URL state
- Browser back/forward works correctly
- Logo click navigates to root

**5. Styles** (`viewer/styles.css`)
- Breadcrumb styling with truncation
- Current epic visual distinction (background, border)
- Removed pin and collapse button styles
- Removed margin below filter bar

### URL State Integration

Epic navigation synced to URL: `?epic=EPIC-0001`
- Shareable URLs with epic context
- Browser back/forward works
- Persistent across refreshes
- Consistent with task selection pattern

## Consequences

### Positive

- **Focus**: One epic at a time, no cognitive overload
- **Scalability**: Works with 100s of tasks across many epics
- **Simplicity**: Cleaner implementation than recursive nesting
- **Familiarity**: Matches user expectations from other tools
- **Shareable**: URLs include epic context
- **Browser integration**: Back/forward buttons work
- **Clean home page**: Only top-level items visible

### Negative

- **Breaking change**: Click behavior changes for epics
- **Removed features**: Pin and collapse functionality gone
- **Migration**: Users need to learn new navigation pattern

### Trade-offs Accepted

- Removed pin feature (was confusing, underutilized)
- Removed collapse/expand (navigation replaces it)
- Can't see entire hierarchy at once (but that's the point)

## Design Alternatives Considered

### Option 1: Recursive Nested Tree (Rejected)
Show everything in one tree with visual indentation and collapse/expand.

**Why rejected**: 
- Cognitive overload with large task lists
- Complex implementation (recursion, depth tracking, circular references)
- Doesn't scale well
- Visual clutter

### Option 2: Pin Enhancement (Rejected)
Keep pin functionality but add breadcrumbs and make it more folder-like.

**Why rejected**:
- Pin metaphor is confusing for navigation
- Mixing concepts (pin vs navigate)
- Not intuitive

### Option 3: Folder Navigation (Selected)
Click to navigate into epics, breadcrumb to go back.

**Why selected**:
- Simplest mental model
- Matches user expectations
- Cleaner implementation
- Better UX for large task lists

## Testing

Verified scenarios:
- Home page shows only root epics and orphan tasks
- Nested epics don't appear on home page
- Click epic navigates in and auto-selects it
- Breadcrumb shows correct path
- Breadcrumb navigation works
- Logo navigates to root
- Browser back/forward works
- Long titles truncate in breadcrumb
- Current epic visually distinct
- Child counts always visible
- No layout shift (breadcrumb always visible)
- URL state persists navigation

## Future Enhancements

- Keyboard shortcuts (Enter to navigate in, Escape to go back)
- "Open in new tab" for epics (Cmd+Click)
- Breadcrumb overflow menu for very deep nesting
- Search within current epic context
- Bulk operations within epic context

## Related Work

- Original issue: Children of nested epics not showing
- Initial approach: ADR 0033 (recursive nesting) - superseded
- Implementation: ADRs 0034, 0035, 0036 - consolidated here
