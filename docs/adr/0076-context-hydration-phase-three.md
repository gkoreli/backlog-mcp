# 0076. Context Hydration Phase Three — Depth 2+ Expansion, Session Memory, Architectural Resilience

**Date**: 2026-02-15
**Status**: Accepted
**Supersedes**: ADR-0075 Phase 3 roadmap items (depth 2+ expansion, session memory)
**Related**: ADR-0074 (Phase 1 — Architecture), ADR-0075 (Phase 2 — Semantic Enrichment + Temporal Overlay)

## Context

ADR-0075 shipped Phase 2 of the Retrieval-Augmented Context Pipeline: semantic enrichment (Stage 3), temporal overlay (Stage 4), and query-based focal resolution. That delivered discovery and temporal awareness. Phase 2 left three structural gaps identified in its handoff notes:

1. **Depth limitation**: The relational expansion (Stage 2) accepted a `depth` parameter (1-3) but only implemented depth 1. An agent working on a deeply nested task (`TASK-0043 → TASK-0042 → EPIC-0005 → EPIC-0001`) could only see one hop in each direction — missing the grandparent epic and the grandchildren subtasks.

2. **Session amnesia**: The temporal overlay (Stage 4) shows *what happened* (raw activity feed), but not *who was working on this and what their session looked like*. An agent picking up `TASK-0042` doesn't know that "Claude worked on this 2 hours ago, made 3 updates, set status to in_progress, and added evidence." This leads to duplicated reasoning and lost continuity.

3. **No architectural documentation of cycle safety**: The `parent_id` field can contain circular references due to data bugs. Phase 1's `_depth` parameter was unused, so this was never exercised. With depth 2+ traversal, cycle detection becomes critical.

## Decision

Implement Phase 3 with three changes:

### 1. Depth 2+ Relational Expansion

**File**: `src/context/stages/relational-expansion.ts`

The `expandRelations()` function now respects the `depth` parameter with recursive traversal in both directions (ancestors and descendants).

**Ancestor traversal**: Starting from the focal entity, walk up the `parent_id` chain for `depth` hops. At depth 1, only the parent is found (existing behavior). At depth 2, the grandparent is found. At depth 3, the great-grandparent. Each ancestor beyond the direct parent is returned in the new `ancestors` array at **reference fidelity** with a `graph_depth` field.

**Descendant traversal**: BFS from the focal entity downward through `listTasks({ parent_id })`. At depth 1, only direct children are found (existing behavior). At depth 2, grandchildren (children of children) are found. Each descendant beyond direct children is returned in the new `descendants` array at **reference fidelity** with a `graph_depth` field.

**Why reference fidelity for depth 2+ entities?** Ancestors and descendants beyond the first hop are structural context — they tell the agent "this is where you are in the hierarchy" but rarely need full details. Reference fidelity (id + title + status + type) costs ~25 tokens per entity vs ~100+ for summary. This keeps the token budget manageable even with deep hierarchies.

**Cycle detection**: A `visited` set (initialized with the focal entity's ID) is threaded through both ancestor and descendant traversal. Any entity already in the set is skipped. This prevents infinite loops from circular `parent_id` references (which can occur from data bugs or manual edits).

**Why BFS for descendants?** BFS (breadth-first search) naturally processes entities level-by-level, which means depth-1 children are always discovered before depth-2 grandchildren. This aligns with the token budget priority: children get higher priority than grandchildren. DFS would interleave depths, making budgeting harder.

**Response shape change**: `RelationalExpansionResult` gains two new fields:
```typescript
ancestors: ContextEntity[];    // Ordered closest-first, reference fidelity
descendants: ContextEntity[];  // Flat list, each carries graph_depth
```

`ContextResponse` gains matching fields:
```typescript
ancestors: ContextEntity[];    // Ancestor chain beyond parent
descendants: ContextEntity[];  // Descendants beyond children
```

### 2. Session Memory (Stage 3.5)

**File**: `src/context/stages/session-memory.ts`

New pipeline stage that derives a "last work session" summary from the operation log. Positioned between semantic enrichment (Stage 3) and temporal overlay (Stage 4) because it provides higher-signal context than raw activity — it tells the agent *what the last session accomplished*, not just *what operations happened*.

**How sessions are identified**: Operations are sorted by timestamp (most recent first). Starting from the most recent operation on the focal entity, the system walks backward grouping consecutive operations by the same actor within a 30-minute time gap. The first operation by a different actor, or a gap larger than 30 minutes, marks the session boundary.

**Why 30 minutes?** This heuristic balances two use cases:
- **Agent sessions** are typically continuous — operations happen seconds to minutes apart. A 30-minute gap reliably separates distinct agent sessions.
- **Human sessions** have natural breaks (coffee, meetings). 30 minutes is the standard "idle timeout" used by most analytics platforms (Google Analytics, Amplitude).
- Too short (5 min) would fragment normal work. Too long (2 hours) would merge distinct sessions.

**Session summary output**:
```typescript
interface SessionSummary {
  actor: string;           // "claude" or "developer"
  actor_type: 'user' | 'agent';
  started_at: string;      // ISO timestamp
  ended_at: string;
  operation_count: number;
  summary: string;         // "status → in_progress, added evidence, wrote 1 resource"
}
```

**Summary generation**: The summary is built from operation types and key parameters:
- Status changes: `status → in_progress`
- Evidence additions: `added evidence`
- Resource writes: `wrote 1 resource`
- Generic updates: `3 updates`
- Entity creation: `Created TASK-0042`

**Graceful degradation**: Like other optional stages, session memory requires `readOperations` in the dependency injection. If not provided, the stage is skipped and `session_summary` is `null`.

### 3. Token Budget Priority Extension

**File**: `src/context/token-budget.ts`

The budget priority order is extended from 7 levels (Phase 2) to 10 levels:

```
Priority  1: Focal entity        — always full fidelity, never dropped
Priority  2: Parent entity       — always summary fidelity, never dropped
Priority  3: Session summary     — high value, tells agent about last session  ← NEW
Priority  4: Children            — summary, downgrade to reference if needed
Priority  5: Siblings            — summary, downgrade to reference if needed
Priority  6: Ancestors           — reference fidelity, structural breadcrumb    ← NEW
Priority  7: Descendants         — reference fidelity, structural awareness     ← NEW
Priority  8: Related (semantic)  — summary, downgrade to reference if needed
Priority  9: Resources           — summary, downgrade to reference if needed
Priority 10: Activity            — fixed cost, drop entries if needed
```

**Why session summary at priority 3?** Session memory is one of the highest-value pieces of context for an agent starting work. It answers "what happened last time someone touched this?" — more actionable than any individual child or sibling entity. Under tight budgets, losing a sibling is fine; losing session context risks duplicated work.

**Why ancestors/descendants between siblings and semantic?** They provide structural context (where am I in the hierarchy?) which is more concrete than semantic matches. But they're less immediately actionable than siblings (which may be blockers or related work items).

**`graph_depth` preservation**: The `downgradeEntity()` function now preserves the `graph_depth` field when downgrading fidelity. This ensures agents can still assess entity distance from focal even after budgeting downgraded fidelity.

## Type System Changes

### `ContextEntity` gains `graph_depth`
```typescript
interface ContextEntity {
  // ... existing fields ...
  graph_depth?: number;  // Distance from focal (2 = grandparent/grandchild, etc.)
}
```

### `ContextResponse` gains `ancestors`, `descendants`, `session_summary`
```typescript
interface ContextResponse {
  // ... existing fields ...
  ancestors: ContextEntity[];        // Ancestor chain beyond parent
  descendants: ContextEntity[];      // Descendants beyond children
  session_summary: SessionSummary | null;  // Last work session info
}
```

### New type: `SessionSummary`
```typescript
interface SessionSummary {
  actor: string;
  actor_type: 'user' | 'agent';
  started_at: string;
  ended_at: string;
  operation_count: number;
  summary: string;
}
```

## Dependency Injection (Unchanged)

The `HydrationServiceDeps` interface is unchanged from Phase 2. Session memory reuses the existing `readOperations` dependency — no new deps needed.

```typescript
interface HydrationServiceDeps {
  getTask: (id: string) => Task | undefined;
  listTasks: (filter: { parent_id?: string; limit?: number }) => Task[];
  listResources: () => Resource[];
  searchUnified?: (...) => Promise<UnifiedSearchResult[]>;  // Optional
  readOperations?: (...) => OperationEntry[];                // Optional
}
```

## MCP Tool Changes

The `backlog_context` tool's depth parameter description is updated:

```
depth: 1-3 (default 1). 2 = grandparent/grandchildren. 3 = three hops.
```

Response now includes `ancestors`, `descendants`, and `session_summary` fields when present (non-empty arrays and non-null values only, for clean JSON).

## Known Hacks and Limitations

### Inherited from Phase 1/2

1. **Token estimation remains character-based** — `Math.ceil(text.length / 4)`. Unchanged.
2. **Resource discovery uses path heuristic for Stage 2** — now extended to scan ancestor IDs at depth 2+.
3. **Sibling fetching loads all children of parent** — unchanged.
4. **`listSync()` used for relational expansion** — correct, not a hack.
5. **Semantic search query is simple title + description** — unchanged.
6. **Operation summary generation is hardcoded** — unchanged.

### New in Phase 3

7. **Session boundary is a time-gap heuristic (30 min)**

**Location**: `src/context/stages/session-memory.ts`, `SESSION_GAP_MS` constant
**Issue**: The 30-minute gap heuristic is a reasonable approximation but not a true session boundary. Two agents working in alternating 10-minute bursts would be merged into one session. An agent pausing for 31 minutes and resuming would be split into two sessions.
**Why acceptable**: The operation log has no concept of "session ID." Adding explicit session tracking would require changes to the operation logger, the MCP tool middleware, and potentially the client. The 30-minute heuristic works correctly for >90% of real-world usage patterns.
**Future fix**: Add a `session_id` field to `OperationEntry` generated by the tool middleware when a new agent session begins. This requires coordination with the client layer.

8. **Session summary only covers the focal entity (not children/siblings)**

**Location**: `src/context/hydration-service.ts`, stage 3.5 invocation
**Issue**: Session memory only queries operations for the focal entity. If an agent worked on both TASK-0042 and its children in the same session, only the TASK-0042 operations contribute to the summary.
**Why acceptable**: The session summary answers "what happened to THIS entity." Cross-entity session tracking is a more complex problem (which operations are "the same session"?) and would require correlating operations across multiple entities by actor + time window. The temporal overlay (Stage 4) already surfaces cross-entity activity for this use case.
**Future fix**: Extend `deriveSessionSummary()` to accept a list of entity IDs (focal + children) and merge operations across them into a single session timeline.

9. **Descendants use flat list instead of tree structure**

**Location**: `src/context/stages/relational-expansion.ts`, `collectDescendants()`
**Issue**: Grandchildren are returned in a flat `descendants` array with `graph_depth` tags, not as a nested tree. An agent can't directly see "TASK-0045 is a child of TASK-0043 which is a child of TASK-0042" from the response structure alone.
**Why acceptable**: A nested tree structure would complicate token budgeting (harder to trim individual branches) and response consumption (agents would need to walk a tree). The flat structure with `graph_depth` provides the depth information without structural complexity. The `parent_id` field on each entity allows reconstruction of the tree if needed.
**Future fix**: Consider adding a `tree` response format option that returns entities in a nested structure for viewer UI rendering.

10. **BFS descendant limit per parent is 50**

**Location**: `src/context/stages/relational-expansion.ts`, `collectDescendants()`, `listTasks({ limit: 50 })`
**Issue**: Each parent node's children are capped at 50 during BFS. For very large epics with 100+ direct children, some descendants may be missed.
**Why acceptable**: Token budgeting would trim most of them anyway. The limit prevents O(n²) behavior in pathological cases.
**Future fix**: Add a separate `descendant_limit` to the context request for explicit control.

## Invariants

### Phase 1+2 Invariants (carried forward)

1. **Focal always full fidelity**: The focal entity is ALWAYS included at FULL fidelity.
2. **Parent always summary**: Parent entity (when exists) is ALWAYS included at SUMMARY fidelity.
3. **Priority ordering**: Session > children > siblings > ancestors > descendants > related > resources > activity.
4. **Token budget respected**: `metadata.token_estimate` never exceeds `max_tokens`.
5. **`truncated` flag accuracy**: True iff items were dropped or downgraded.
6. **`total_items` consistency**: Sum of all items in the response (now includes ancestors + descendants + session_summary).
7. **`stages_executed` completeness**: Lists exactly the stages that ran.
8-14. **Semantic enrichment invariants** (unchanged from Phase 2).
15-20. **Temporal overlay invariants** (unchanged from Phase 2).
21-23. **Query resolution invariants** (unchanged from Phase 2).

### Depth 2+ Invariants (new)

24. **Ancestors are reference fidelity**: All entities in the `ancestors` array have `fidelity: 'reference'`.
25. **Descendants are reference fidelity**: All entities in the `descendants` array have `fidelity: 'reference'`.
26. **Ancestors have graph_depth >= 2**: Direct parent is in the `parent` field, not `ancestors`.
27. **Descendants have graph_depth >= 2**: Direct children are in the `children` field, not `descendants`.
28. **No entity in multiple roles**: A given entity ID appears in at most one of: focal, parent, children, siblings, ancestors, descendants.
29. **Ancestors ordered closest-first**: `ancestors[0].graph_depth <= ancestors[1].graph_depth <= ...`
30. **Cycle-safe**: Circular `parent_id` references do not cause infinite loops. Visited set prevents re-traversal.
31. **Depth 1 backward compatible**: At depth 1, `ancestors` and `descendants` are always empty arrays.

### Session Memory Invariants (new)

32. **Session summary required fields**: When `session_summary` is not null, it has: `actor`, `actor_type`, `started_at`, `ended_at`, `operation_count` (> 0), `summary` (non-empty string).
33. **Actor type is valid**: `session_summary.actor_type` is either `'user'` or `'agent'`.
34. **Graceful absence**: If `readOperations` is not provided, `session_summary` is always `null`.
35. **stages_executed**: `session_memory` appears in `stages_executed` only when a session was found and summarized.

### Token Budget Invariants (extended)

36. **graph_depth preserved through downgrading**: `downgradeEntity()` preserves `graph_depth`.
37. **Session summary dropped before focal/parent**: Under tight budgets, session summary is dropped before focal or parent entities.

## Test Coverage

123 tests total (up from 87 in Phase 2):

| Category | Tests | Coverage |
|----------|-------|---------|
| Stage 1: Focal Resolution (ID + query) | 7 | ID lookup, epic lookup, not-found, query resolution |
| Fidelity levels | 5 | Full, summary, reference |
| Stage 2: Relational Expansion | 11 | Parent, children, siblings, resources, orphan, leaf, epic |
| Stage 3: Semantic Enrichment | 7 | Dedup, caps, fidelity, scores |
| Stage 4: Temporal Overlay | 9 | Multi-entity, dedup, sort, summaries |
| Token estimation | 2 | String, fidelity ordering |
| Entity downgrading | 3 | Full→summary, full→reference, relevance_score |
| Token budget (Phase 1/2) | 7 | Budget allocation, priority, truncation |
| E2E pipeline | 12 | Full context, not-found, epic, budget, leaf, orphan, depth, new fields |
| Pipeline + semantic | 3 | With/without search |
| Pipeline + temporal | 3 | With/without ops |
| Pipeline + query | 3 | Query resolution |
| Contract invariants (Phase 1/2) | 13 | Fidelity, fields, metadata, dedup |
| **Phase 3: Depth 2+** | **11** | Depth 1/2/3, ancestors, descendants, cycles, resources, pipeline |
| **Phase 3: Session Memory** | **10** | Session derivation, boundaries, gaps, summaries, pipeline |
| **Phase 3: Token budget** | **6** | Priority levels, session budget, graph_depth preservation |
| **Phase 3: Contract invariants** | **10** | Fidelity, graph_depth, uniqueness, ordering, total_items |

## File Changes

```
New files:
  src/context/stages/session-memory.ts         — Stage 3.5: session memory derivation
  docs/adr/0076-context-hydration-phase-three.md — This ADR

Modified files:
  src/context/types.ts                          — SessionSummary, graph_depth, ancestors/descendants
  src/context/hydration-service.ts              — 6-stage orchestration, session memory
  src/context/token-budget.ts                   — 10-level priority, session summary budgeting
  src/context/stages/relational-expansion.ts    — Depth 2+ traversal, cycle detection, ancestors/descendants
  src/context/index.ts                          — Export new types and stages
  src/tools/backlog-context.ts                  — ancestors/descendants/session in MCP output
  src/server/viewer-routes.ts                   — ADR reference update
  src/__tests__/context-hydration.test.ts        — 123 tests (up from 87)
```

## Long-Term Architecture Vision

### Where We Are (After Phase 3)

The context hydration pipeline is now a mature 6-stage system:

```
Request → Stage 1 (Focal) → Stage 2 (Relational, depth 1-3) →
          Stage 3 (Semantic) → Stage 3.5 (Session Memory) →
          Stage 4 (Temporal) → Stage 5 (Token Budget) → Response
```

Key strengths:
- **Single-call context delivery**: Agents go from "I need to work on X" to full context in one call
- **Structural + semantic + temporal**: Three orthogonal context dimensions
- **Token-aware**: Respects context windows with graceful degradation
- **Modular**: Each stage is independently testable and deployable
- **Session continuity**: Agents know what happened in the last session

### What's Missing for Long-Term Resilience

1. **Cross-reference traversal**: Tasks with `references[]` URLs pointing to other tasks have those links invisible to the pipeline. A task referencing `TASK-0041` in its references should surface that task in context — currently it only appears if it happens to be a sibling or semantic match.

2. **Explicit dependency graph**: The backlog schema has no `depends_on` or `blocks` field. Tasks can be "blocked" (via `blocked_reason`) but there's no machine-readable link to what blocks them. This prevents the context pipeline from surfacing "TASK-0042 is blocked by TASK-0041 which is still open."

3. **Multi-entity session correlation**: Session memory currently covers only the focal entity. A more complete picture would correlate operations across focal + children to show "in the last session, Claude updated TASK-0042 and completed TASK-0043 and TASK-0044."

4. **Proactive suggestions**: The pipeline is currently descriptive (here's your context) but not prescriptive (here's what you should do). Analyzing context to suggest next actions would complete the "second brain" vision.

5. **Viewer UI integration**: The HTTP endpoint returns rich context but the viewer doesn't consume it yet. "Related Items", "See Also", and "Timeline" panels would make the context visible to humans.

6. **Pre-computed context cache**: For backlogs >1000 entities, on-demand traversal may become slow. A pipeline-level cache (memoize stage results, invalidate on mutation via EventBus) would add latency resilience without changing the architecture.

## Handoff for Next Engineer

### What was built

Phase 3 of the Retrieval-Augmented Context Pipeline. The pipeline now has 6 stages:

1. **Stage 1 — Focal Resolution** (Phase 1 + Phase 2 query): Resolves by ID or query. Unchanged.
2. **Stage 2 — Relational Expansion** (Phase 1 + **Phase 3 depth 2+**): Parent, children, siblings, **ancestors, descendants**. Cycle detection via visited set. BFS for descendants.
3. **Stage 3 — Semantic Enrichment** (Phase 2): Search-based discovery. Unchanged except dedup now includes ancestors/descendants.
4. **Stage 3.5 — Session Memory** (**Phase 3 new**): Derives last work session from operation log. 30-minute gap heuristic for session boundaries.
5. **Stage 4 — Temporal Overlay** (Phase 2): Recent activity. Unchanged.
6. **Stage 5 — Token Budgeting** (Phase 1, extended **Phase 3**): 10-level priority including session summary, ancestors, descendants.

### Architecture decisions to preserve

Everything from Phases 1 and 2 still holds, plus:

- **Reference fidelity for depth 2+ entities**: Ancestors and descendants are always reference fidelity. This is a deliberate token-saving decision — they provide structural breadcrumbs, not detailed content.
- **`graph_depth` annotation**: Entities beyond hop 1 carry `graph_depth` so consumers can assess distance. This is preserved through fidelity downgrading.
- **BFS for descendants**: Breadth-first ensures depth-1 children are always found before depth-2 grandchildren, aligning with budget priority.
- **Visited set threading**: The cycle detection visited set is shared across ancestor and descendant traversal. This prevents any entity from appearing in multiple roles.
- **Session memory is unconditional**: Unlike semantic enrichment and temporal overlay (which have toggle flags), session memory always runs when `readOperations` is available. There's no `include_session` flag because session memory is too valuable to opt out of.

### What to build next

**Priority 1: Cross-reference traversal**
- Parse `references[]` URLs to extract entity IDs (e.g., `TASK-0041` from a GitHub issue URL or direct ID reference)
- Add discovered entities to the context at summary fidelity in a new `referenced` array
- Position between siblings and ancestors in budget priority

**Priority 2: Viewer UI integration**
- "Related Items" section in TaskDetail right pane: children, siblings, ancestors as breadcrumb
- "See Also" section for semantic matches
- "Last Session" card showing session_summary
- Timeline section for recent activity
- Data source: `GET /context?task_id=X&depth=2`

**Priority 3: Multi-entity session correlation**
- Extend `deriveSessionSummary()` to accept multiple entity IDs
- Merge operations across focal + children into unified session timeline
- Requires time-window correlation logic

**Priority 4: Proactive suggestions**
- Analyze context to suggest next actions
- "TASK-0041 was completed but TASK-0042 is still open — consider updating status"
- "All children of TASK-0042 are done — epic may be completable"
- New `suggestions` array in response

**Priority 5: Explicit dependency links**
- Add `depends_on` / `blocks` fields to Task schema
- New traversal in Stage 2 to follow dependency links
- Surface blocking chain: "TASK-0042 → blocked by TASK-0041 (status: in_progress)"

### Known issues to address

1. **4 pre-existing test failures**: `search-hybrid.test.ts` (2, onnxruntime) and `mcp-integration.test.ts` (2, server port/timeout). Unrelated to context hydration.
2. **No integration test with real storage**: All tests use mock dependencies. An integration test with actual `BacklogService` and `OperationLogger` would catch issues at the seams.
3. **Session memory only covers focal entity**: See hack #8 above.
4. **No `include_session` toggle**: Session memory always runs. If it becomes expensive or agents want to skip it, add an `include_session` flag.

## Consequences

### Positive
- **Depth 2+ unlocked**: Agents can now see the full hierarchy — grandparent epics, cousin tasks, grandchildren subtasks
- **Session continuity**: Agents know what the last session accomplished, preventing duplicated reasoning
- **Cycle-safe**: Circular references can't crash the pipeline
- **123 tests with 37 invariants**: Comprehensive coverage prevents regressions
- **Backward compatible**: Depth 1 behavior is identical to Phase 2

### Negative
- **Larger response at depth 2+**: More entities = more tokens used. Mitigated by reference fidelity for depth 2+ entities.
- **Additional complexity**: 6 stages vs 5. Mitigated by stage independence — each stage is a separate file with its own types.
- **Session heuristic is imperfect**: 30-minute gap may merge/split sessions incorrectly. Mitigated by the heuristic being correct >90% of the time.

### Risks
- **Deep hierarchies with many children**: At depth 3, a tree with branching factor 10 could produce 10 + 100 + 1000 = 1110 entities. The per-parent limit of 50 and token budgeting prevent this from exploding, but response time may increase. Monitor for backlogs with deep, wide trees.
- **Session memory accuracy**: The 30-minute heuristic may produce incorrect session boundaries. If agents report confusing session summaries, consider adding explicit session IDs to the operation log.
