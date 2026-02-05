# 0062. Spotlight Default Tabs: Recent Searches and Recent Activity

**Date**: 2026-02-05
**Status**: Accepted
**Backlog Item**: TASK-0201

## Problem Statement

When users open Spotlight, they see an empty search interface. Users want to immediately see useful information without typing - specifically recently searched items and recently updated tasks/epics/resources.

## Problem Space

### Why This Problem Exists

Spotlight was designed as a pure search interface with no "browse" mode. There's no concept of a default view when the search input is empty, and no tracking of user navigation history.

### Who Is Affected

- All users who use Spotlight for navigation
- Power users who frequently switch between tasks
- Users who want to resume work on recently accessed items

### Problem Boundaries

**In scope**:
- Default tabbed view when search input is empty
- Recent searches tracking (localStorage)
- Recent activity display (deduplicated, sorted by updated_at)

**Out of scope**:
- Search algorithm changes
- New backend API endpoints
- Pinned/favorited items (future feature)

### Problem-Space Map

**Dominant causes**: Spotlight was built as search-only, no "browse" mode

**Alternative root causes**: Users may not know what to search for - they need discovery

**What if we're wrong**: If users prefer the clean empty state, tabs could feel cluttered. However, the task explicitly states users want this feature.

## Context

### Current State

- Spotlight opens with empty input and empty results area
- User must type ≥2 characters to see any results
- No tracking of what users have searched for or clicked on
- Activity panel exists separately but isn't integrated with Spotlight

### Research Findings

- Activity panel already has patterns for fetching and displaying recent operations
- localStorage is used for persisting activity mode preference
- `/search?sort=recent` endpoint returns tasks, epics, and resources sorted by updated_at
- Spotlight already has type filter buttons and sort controls

## Proposed Solutions

### Option 1: Inline Tabs in Spotlight `[SHORT-TERM]` `[LOW]`

**Description**: Add tab UI directly inside spotlight-search.ts. When query is empty, render tabs in the results area. Track recent searches in a simple array in localStorage.

**Differs from others by**:
- vs Option 2: All logic in one file, no new components or services
- vs Option 3: No service abstraction, direct localStorage access

**Pros**:
- Minimal code changes, single file modification
- Fast to implement
- No new abstractions

**Cons**:
- spotlight-search.ts grows larger (already 350+ lines)
- Recent searches logic mixed with search logic
- Harder to test in isolation

**Rubric Scores**:
| Anchor | Score (1-5) | Justification |
|--------|-------------|---------------|
| Time-to-ship | 5 | Single file change, ~2-3 hours |
| Risk | 3 | Mixing concerns could introduce bugs in existing search |
| Testability | 2 | Hard to test tabs logic without testing whole component |
| Future flexibility | 2 | Adding features means more bloat in one file |
| Operational complexity | 5 | No new systems, just localStorage |
| Blast radius | 4 | Only affects Spotlight, but could break search |

### Option 2: Extract Service, Inline Tabs `[MEDIUM-TERM]` `[LOW]`

**Description**: Create `RecentSearchesService` class for localStorage CRUD, but keep tabs UI inline in spotlight-search.ts. Hybrid approach balancing testability with simplicity.

**Differs from others by**:
- vs Option 1: Extracts service for testability, keeps UI simple
- vs Option 3: Still uses localStorage, not server-side

**Pros**:
- Service can be tested independently
- Minimal new files (just one service)
- Tabs UI stays close to where it's used
- Follows existing patterns (activity mode uses localStorage)

**Cons**:
- spotlight-search.ts still grows, but less than Option 1
- Service adds one level of indirection

**Rubric Scores**:
| Anchor | Score (1-5) | Justification |
|--------|-------------|---------------|
| Time-to-ship | 5 | ~3 hours, one new file + modifications |
| Risk | 4 | Service isolation reduces risk of breaking search |
| Testability | 4 | Service testable, UI harder but acceptable |
| Future flexibility | 4 | Easy to extend service, tabs can grow |
| Operational complexity | 5 | Still just localStorage, no new systems |
| Blast radius | 5 | Isolated service, search logic mostly untouched |

### Option 3: Server-Side Recent Tracking `[LONG-TERM]` `[HIGH]`

**Description**: Add server-side tracking of user navigation. New `/recent-searches` endpoint. Persist across devices.

**Differs from others by**:
- vs Option 1: Server-side persistence, not localStorage
- vs Option 2: Requires backend changes, not just frontend

**Pros**:
- Persists across browsers/devices
- Could support multi-user scenarios
- More robust data model

**Cons**:
- Significant backend work
- Overkill for single-user local tool
- Adds complexity for minimal benefit
- Slower (network round-trip)

**Rubric Scores**:
| Anchor | Score (1-5) | Justification |
|--------|-------------|---------------|
| Time-to-ship | 1 | Days of work, backend + frontend + tests |
| Risk | 2 | New API surface, storage format, migration concerns |
| Testability | 4 | API can be tested, but more integration tests needed |
| Future flexibility | 5 | Most flexible, supports future multi-user |
| Operational complexity | 2 | New storage, new endpoints, more to maintain |
| Blast radius | 3 | Backend changes could affect other features |

## Decision

**Selected**: Option 2 - Extract Service, Inline Tabs

**Rationale**: 
- Scores highest (27/30) with best balance of speed and quality
- Service extraction enables testing of the important persistence logic
- Inline tabs keeps the UI simple without over-engineering
- Follows existing codebase patterns (localStorage for preferences)
- Option 1 is tempting but creates untestable code
- Option 3 is overkill for a single-user local tool

**For this decision to be correct, the following must be true**:
- localStorage is sufficient for recent searches (no cross-device sync needed)
- The existing `/search?sort=recent` endpoint provides enough data for recent activity
- Users don't need more than ~15 recent searches

**Trade-offs Accepted**:
- spotlight-search.ts grows by ~100 lines (acceptable)
- No cross-device sync for recent searches (acceptable for local tool)

## Consequences

**Positive**:
- Users see useful content immediately when opening Spotlight
- Recent searches persist across sessions
- Reuses existing search API for recent activity
- Testable service for persistence logic

**Negative**:
- spotlight-search.ts becomes larger
- Two sources of "recent" data (searches vs activity) could confuse users

**Risks**:
- Tab switching could feel slow if recent activity fetch is slow → Mitigation: Show cached data immediately, refresh in background
- Users might expect recent searches to sync across devices → Mitigation: Document as local-only feature

## Implementation Notes

### Files to Create
- `viewer/services/recent-searches-service.ts` - localStorage CRUD with deduplication

### Files to Modify
- `viewer/components/spotlight-search.ts` - Add tabs UI, integrate service
- `viewer/styles.css` - Add tab styles

### Key Implementation Details
- Recent Searches tab is default (per requirements)
- Tab state resets when Spotlight closes
- Use `/search?sort=recent&limit=15` for recent activity
- Track clicks on search results to populate recent searches
- Deduplicate by item ID, keep most recent 15 items
