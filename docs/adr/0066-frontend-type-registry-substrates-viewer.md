# 0066. Frontend Type Registry for Substrates Viewer UI

**Date**: 2026-02-07
**Status**: Accepted
**Backlog Item**: TASK-0243

## Problem Statement

The backlog-mcp web viewer is hardcoded for two entity types (task, epic). The substrates architecture (ADR 0065) introduces 5 entity types (task, epic, folder, artifact, milestone) with a unified `parent_id` replacing `epic_id`. The viewer needs to render, navigate, and filter all 5 types without creating cognitive overload or breaking existing workflows.

## Problem Space

Type knowledge is scattered across every viewer component:

| Component | Hardcoded Type Logic |
|-----------|---------------------|
| `TaskBadge` | `id.startsWith('EPIC-') ? 'epic' : 'task'` |
| `TaskItem` | Epic-only child count, enter arrow, drill-in |
| `TaskList` | Groups by epic/task, filters by `epic_id` |
| `TaskDetail` | Renders `epic_id` link, epic-specific metadata |
| `Breadcrumb` | Follows `epic_id` chain |
| `API types` | `type?: 'task' \| 'epic'`, `epic_id?: string` |
| `CSS` | Only `.type-task` and `.type-epic` classes |

Adding 3 new types by adding branches to each component would work but creates maintenance burden and violates the codebase's own pattern — the backend has a clean substrate registry (`src/substrates/index.ts`), but the frontend would be scattered if/else chains.

### Who Is Affected

- Users browsing the viewer — need to distinguish 5 types visually
- Users creating milestones/folders/artifacts via agents — items must render correctly
- Developers extending the type system — should be able to add types in one place

### Validated Pain Point

TASK-0248 is a real milestone forced into a task because no milestone type exists. It uses a `[Milestone]` title prefix, phase tracking in markdown, and due dates in prose as workarounds.

## Context

- 5 substrate types defined in `src/substrates/index.ts` with Zod schemas
- Each type has: prefix (4-char), validParents, hasStatus, type-specific fields
- `parent_id` replaces `epic_id` — semantics derived from parent type
- Container types (epic, folder, milestone) support drill-in navigation
- Leaf types (task, artifact) render inline
- Viewer is vanilla TypeScript Web Components, no framework

## Proposed Solutions

### Option 1: Hardcoded 5-Type Extension `[SHORT-TERM]` `[LOW]`

Add if/else branches for 3 new types in every component.

| Anchor | Score | Justification |
|--------|-------|---------------|
| Time-to-ship | 5 | Straightforward additions |
| Risk | 4 | Extending proven patterns |
| Testability | 4 | Each component testable independently |
| Future flexibility | 2 | Type 6 means touching every component |
| Operational complexity | 5 | No new infrastructure |
| Blast radius | 4 | Additive changes |

### Option 2: Frontend Type Registry `[MEDIUM-TERM]` `[MEDIUM]`

Single `type-registry.ts` config object mapping types to visual treatment. Components become generic renderers.

| Anchor | Score | Justification |
|--------|-------|---------------|
| Time-to-ship | 3 | Registry + refactoring ~2-3 days |
| Risk | 3 | Refactoring working components |
| Testability | 5 | Registry independently testable |
| Future flexibility | 5 | Adding type = one registry entry |
| Operational complexity | 5 | No new infrastructure |
| Blast radius | 3 | Touches every viewer component |

### Option 3: Server-Driven Type Metadata `[LONG-TERM]` `[HIGH]`

Server exposes `/types` endpoint; viewer fetches config at startup.

| Anchor | Score | Justification |
|--------|-------|---------------|
| Time-to-ship | 2 | Server endpoint + viewer refactor |
| Risk | 2 | Runtime dependency, version coupling |
| Testability | 4 | Testable with mock config |
| Future flexibility | 5 | Backend-only type changes |
| Operational complexity | 3 | New endpoint, cache concerns |
| Blast radius | 2 | Server + every viewer component |

## Decision

**Selected**: Option 2 — Frontend Type Registry

**Rationale**: Matches the codebase's architecture philosophy — the backend has a substrate registry, the frontend should mirror it. The ~1-2 day extra investment over Option 1 pays for itself the first time we change a type's color or add a field. Option 3 solves a sync problem that doesn't exist (same repo, same deploy).

**For this decision to be correct, the following must be true:**
1. The 5 substrate types are stable (ADR 0065 accepted)
2. Refactoring existing components is mechanical and low-risk
3. User-defined types or plugins are not needed near-term
4. Frontend and backend continue to deploy from the same repo

**Trade-offs accepted:**
- ~2-3 days vs ~1 day for Option 1
- Refactoring working components (mitigated by testing)
- Two registries to sync (same repo, change together)

## Consequences

**Positive:**
- Single source of truth for type config on frontend
- Adding new types is O(1) — one registry entry
- Components become simpler (generic renderers)
- Type filter bar auto-generates from registry
- Mirrors backend substrate registry pattern

**Negative:**
- Refactoring existing components risks regressions
- Developers must know to look at registry (mitigated by clear naming)

## Implementation Notes

### Type Registry (`viewer/type-registry.ts`)

```typescript
export interface TypeConfig {
  prefix: string;
  label: string;
  icon: string;
  gradient: string;
  isContainer: boolean;
  hasStatus: boolean;
  extraFields?: string[];
}

export const TYPE_REGISTRY: Record<string, TypeConfig> = {
  task:      { prefix: 'TASK', label: 'Task',      icon: taskIcon,      gradient: 'linear-gradient(135deg, #00d4ff, #7b2dff)', isContainer: false, hasStatus: true,  extraFields: ['blocked_reason', 'evidence'] },
  epic:      { prefix: 'EPIC', label: 'Epic',      icon: epicIcon,      gradient: 'linear-gradient(135deg, #f0b429, #ff6b2d)', isContainer: true,  hasStatus: true },
  folder:    { prefix: 'FLDR', label: 'Folder',    icon: folderIcon,    gradient: 'linear-gradient(135deg, #3fb950, #1f883d)', isContainer: true,  hasStatus: false },
  artifact:  { prefix: 'ARTF', label: 'Artifact',  icon: artifactIcon,  gradient: 'linear-gradient(135deg, #a371f7, #ff2d7b)', isContainer: false, hasStatus: false, extraFields: ['content_type', 'path'] },
  milestone: { prefix: 'MLST', label: 'Milestone', icon: milestoneIcon, gradient: 'linear-gradient(135deg, #f85149, #ff8c00)', isContainer: true,  hasStatus: true,  extraFields: ['due_date'] },
};
```

### Component Changes

All components replace hardcoded type logic with registry lookups:
- `getTypeFromId(id)` — prefix-based type detection
- `getTypeConfig(type)` — get rendering config
- `isContainer(type)` — check drill-in behavior
- `hasStatus(type)` — check status badge rendering

### New Icons

3 new SVG icons needed: `folder.svg`, `artifact.svg`, `milestone.svg`

### CSS

New type classes generated from registry: `.type-folder`, `.type-artifact`, `.type-milestone` with gradient colors.

### Migration Compatibility

Components read `parent_id` with fallback to `epic_id`:
```typescript
const parentId = item.parent_id || item.epic_id;
```
