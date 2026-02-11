# 0012. Migration Phase 14 — resource-viewer, activity-panel, and Final Migration

**Date**: 2026-02-11
**Status**: Active
**Depends on**: [0011-migration-phase-13-gaps](./0011-migration-phase-13-gaps.md), [0009-framework-defense-in-depth](./0009-framework-defense-in-depth.md)

## Context

Phase 14 completes the web framework migration by migrating the final two
pending components (`resource-viewer` and `activity-panel`) to the reactive
framework, and replacing backlog-app's imperative pane management with
reactive computed views.

## Changes

### 1. `html:inner` Directive (Gap 1 Resolution)

**Problem**: ADR 0011 Gap 1 identified that the template engine had no way
to render trusted HTML strings. Components using `@orama/highlight`,
`diff2html`, and frontmatter metadata all needed innerHTML-like functionality.

**Solution**: Added `html:inner` attribute binding to the template engine
(`viewer/framework/template.ts`). This is a new binding type that:
- Accepts `Signal<string>` or plain `string` values
- Sets `element.innerHTML` reactively when the signal changes
- Is explicitly for **trusted content only** (not user input)

```ts
// Usage in templates:
html`<span html:inner="${highlightedHtml}"></span>`
html`<div class="activity-diff" html:inner="${signal(diffHtmlString)}"></div>`
```

**Implementation**: New `InnerHtmlBinding` type and `bindInnerHtml()` function
in template.ts. Processed during attribute scanning alongside `class:name`,
`@event`, and `ref` bindings.

### 2. resource-viewer Migration

**Before**: Class-based `ResourceViewer extends HTMLElement` with imperative
methods `loadResource()`, `loadMcpResource()`, `loadData()`, `setShowHeader()`.
Called by backlog-app via `document.createElement('resource-viewer')` and
imperative method calls.

**After**: Reactive `component('resource-viewer', ...)` that:
- Injects `SplitPaneState` directly via DI
- Reacts to `splitState.activePane`, `splitState.resourcePath`, `splitState.mcpUri`
  signals to auto-load the correct resource
- Uses `computed()` for multi-branch content rendering (empty/loading/error/markdown/code/text)
- Uses `html:inner` for trusted frontmatter metadata HTML
- Calls `splitState.setHeaderWithUris()` directly after loading (no `resource-loaded` event)
- Intercepts `file://` and `mcp://` links and calls `splitState.openResource()`/
  `splitState.openMcpResource()` directly (no `resource-open` document event)

**Hacks removed**:
- `resource-loaded` document event (was in main.ts bridge) — now direct signal write
- `resource-close` document event (was in main.ts bridge) — pane close via splitState.close()
- Imperative `setShowHeader()` — no longer needed

**Hacks retained**:
- `GAP:LINK_INTERCEPT` — uses `queueMicrotask` + querySelector to intercept
  links rendered by `md-block` (third-party, async rendering)

### 3. activity-panel Migration

**Before**: Class-based `ActivityPanel extends HTMLElement` with imperative
methods `setTaskId()`, `setMode()`, `setDate()`, `loadOperations()`.
Full innerHTML rebuild on every state change. Manual event handler binding
via `bindEventHandlers()`.

**After**: Reactive `component('activity-panel', ...)` that:
- Injects `AppState` and `SplitPaneState` directly via DI
- Reads `splitState.activityTaskId` for task filtering
- Uses signals for local state (mode, selectedDate, expandedOpId, expandedTaskGroups)
- Uses `computed()` views for timeline/journal mode switching
- Uses `html:inner` for diff2html output (trusted HTML)
- Uses `TaskBadge` factory composition (no HTML tag syntax for custom elements)
- Uses `@click.prevent` and `@click.stop` modifiers for event handling
- Calls `splitState.clearActivityFilter()` directly (no document event)
- Persists mode to localStorage via `effect()`
- Subscribes to SSE via `backlogEvents.onChange()` with `onCleanup()` disposal

**Hacks removed**:
- `activity-close` document event (was in main.ts bridge) — pane close via splitState.close()
- `activity-clear-filter` document event (was in main.ts bridge) — direct splitState call
- Manual `bindEventHandlers()` — all events colocated via `@event` in templates
- Manual `scrollTop` preservation — framework handles targeted DOM updates

**Hacks retained**:
- `HACK:DOC_EVENT` — `task-selected` dispatched on document for unmigrated
  url-state listener (url-state still uses document events, not AppState)

### 4. backlog-app Pane Management Rewrite

**Before**: GAP:IMPERATIVE_CHILD — backlog-app used `document.createElement()`,
closure variables (`currentViewer`, `currentPaneEl`, `currentPaneType`), and
imperative effects to create/destroy/update resource-viewer and activity-panel.
Split pane header was updated via imperative innerHTML manipulation.

**After**: Fully reactive pane management using computed views:
- `splitPaneView` — computed that returns pane template or null based on `splitState.activePane`
- `paneHeaderContent` — computed that renders header from SplitPaneState signals
- `splitPaneContent` — computed that switches between `<activity-panel>` and
  `<resource-viewer>` based on pane type
- Uses `CopyButton` factory composition for URI copy buttons in header
- Single `effect()` for toggling `split-active` CSS class

**Hacks removed**:
- `GAP:IMPERATIVE_CHILD` — completely eliminated
- `createSplitPane()` / `destroySplitPane()` imperative functions — removed
- `createUriRow()` imperative DOM builder — replaced with reactive template
- Split pane header innerHTML manipulation — replaced with computed view

### 5. Document Event Bridge Cleanup (main.ts)

**Removed** (5 bridges):
- `resource-close` — resource-viewer now reads SplitPaneState directly
- `activity-close` — activity-panel now reads SplitPaneState directly
- `activity-clear-filter` — activity-panel calls splitState.clearActivityFilter() directly
- `resource-loaded` — resource-viewer calls splitState.setHeaderWithUris() directly

**Retained** (2 bridges, both HACK:DOC_EVENT):
- `resource-open` — still dispatched by md-block link clicks (third-party, not migrated)
  and task-detail resource reference links
- `activity-open` — still dispatched by task-detail "View Activity" button

## Framework Gaps (Updated)

### Resolved in Phase 14

| Gap | Resolution | Source |
|---|---|---|
| innerHTML binding directive | `html:inner` attribute binding in template.ts | ADR 0011 Gap 1 |
| Imperative child lifecycle | Replaced with reactive computed views in backlog-app | ADR 0011 Gap 2 |
| Pane header cross-tree ownership | Header rendered reactively from SplitPaneState signals | ADR 0011 Gap 3 (partially) |
| Document event bridges | 5 of 7 bridges removed; 2 remain for md-block/task-detail | ADR 0011 Gap 4 |

### Remaining Gaps

| Gap | Severity | Location | Resolution Path |
|---|---|---|---|
| `HACK:DOC_EVENT` resource-open | LOW | main.ts | Remove when md-block is migrated or intercepted differently |
| `HACK:DOC_EVENT` activity-open | LOW | main.ts, task-detail | Inject SplitPaneState in task-detail |
| `HACK:DOC_EVENT` task-selected | LOW | activity-panel | Remove when url-state reads AppState |
| `HACK:CROSS_QUERY` task-detail header | MEDIUM | task-detail | Move header into task-detail template |
| `HACK:EXPOSE` svg-icon attr bridge | LOW | svg-icon | Only needed for unmigrated HTML tag consumers |
| `HACK:EXPOSE` copy-button text | LOW | copy-button | Only needed for imperative .text setter |
| `GAP:LINK_INTERCEPT` resource-viewer | LOW | resource-viewer | Needs md-block migration or render callback |

## Migration Status (Final)

| # | Component | Status | Hacks |
|---|---|---|---|
| 1 | task-filter-bar | Done (Phase 8) | None remaining |
| 2 | svg-icon | Done (Phase 9) | `HACK:EXPOSE` (attr bridge) |
| 3 | task-badge | Done (Phase 9) | None |
| 4 | md-block | SKIP | Third-party wrapper |
| 5 | copy-button | Done (Phase 10) | `HACK:EXPOSE`, `HACK:MOUNT_APPEND` |
| 6 | task-item | Done (Phase 10) | None remaining |
| 7 | task-list | Done (Phase 11) | None remaining |
| 8 | breadcrumb | Done (Phase 11) | None |
| 9 | backlog-app | Done (Phase 11, updated Phase 14) | None remaining |
| 10 | system-info-modal | Done (Phase 12) | None |
| 11 | task-detail | Done (Phase 12) | `HACK:CROSS_QUERY`, `HACK:DOC_EVENT` |
| 12 | spotlight-search | Done (Phase 13) | `GAP:INNERHTML_BINDING` (now uses html:inner), `HACK:DOC_EVENT` |
| 13 | **resource-viewer** | **Done (Phase 14)** | **`GAP:LINK_INTERCEPT`** |
| 14 | **activity-panel** | **Done (Phase 14)** | **`HACK:DOC_EVENT` (task-selected)** |

### Summary: 14/14 components migrated (1 skipped: md-block)

## Framework Primitives Used Across All Migrated Components

| Primitive | Components Using It |
|---|---|
| `signal()` | All 14 |
| `computed()` | 12 (all except svg-icon, task-badge) |
| `effect()` | 11 |
| `html` template | All 14 |
| `component()` factory | All 14 |
| `inject()` DI | 10 |
| `each()` list rendering | 4 (task-list, breadcrumb, spotlight-search, activity-panel) |
| `when()` conditional | 6 |
| `query()` data loading | 3 (task-list, system-info-modal, spotlight-search) |
| `onMount()` lifecycle | 3 (backlog-app, task-detail, spotlight-search) |
| `onCleanup()` lifecycle | 2 (task-detail, activity-panel) |
| `html:inner` trusted HTML | 3 (resource-viewer, activity-panel, spotlight-search) |
| `class:name` directive | 8 |
| `@event` modifiers | 6 |
| `ref()` element refs | 2 (task-detail, spotlight-search) |
| `CopyButton` factory | 2 (backlog-app, task-detail) |
| `TaskBadge` factory | 4 (task-detail, activity-panel, spotlight-search, task-item) |
| `SvgIcon` factory | 4 (backlog-app, task-detail, copy-button, task-item) |

## Recommended Next Steps

1. **Clean up remaining HACK:DOC_EVENT in task-detail** — inject SplitPaneState
   to replace `activity-open` document event.
2. **Move task-detail header into task-detail** — eliminates `HACK:CROSS_QUERY`.
3. **Migrate url-state to AppState** — eliminates `task-selected` document events
   from activity-panel and other components.
4. **Update spotlight-search** to use `html:inner` directive (replace the
   queueMicrotask + querySelectorAll workaround from Phase 13).
5. **Consider Emitter migration** — all components are now framework components;
   the typed Emitter system can replace remaining document events.
