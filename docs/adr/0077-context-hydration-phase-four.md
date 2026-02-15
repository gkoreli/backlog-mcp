# 0077. Context Hydration Phase Four — Cross-Reference Traversal

**Date**: 2026-02-15
**Status**: Accepted
**Supersedes**: ADR-0076 Phase 4 roadmap item (cross-reference traversal)
**Related**: ADR-0074 (Phase 1 — Architecture), ADR-0075 (Phase 2 — Semantic + Temporal), ADR-0076 (Phase 3 — Depth 2+ + Session Memory)

## Context

ADR-0076 shipped Phase 3 of the Retrieval-Augmented Context Pipeline: depth 2+ relational expansion, session memory, and 10-level token budgeting. Its handoff notes identified **cross-reference traversal** as Priority 1 for Phase 4:

> "Tasks with `references[]` URLs pointing to other tasks have those links invisible to the pipeline. A task referencing `TASK-0041` in its references should surface that task in context — currently it only appears if it happens to be a sibling or semantic match."

The `Task.references[]` field stores explicit links: URLs, task IDs, and resource URIs. Before Phase 4, the pipeline included these references as raw strings on the focal entity (at full fidelity) but **never followed them** to resolve the linked entities. This created an information gap: an agent could see "TASK-0042 references TASK-0041" but received no information about TASK-0041's title, status, or context.

### Why This Matters

References are intentional, human-curated links. Unlike semantic matches (discovered by search) or structural relations (parent/child), references represent explicit "this task is related to that task" decisions made by users or agents. They are high-signal context that the pipeline was silently dropping.

A common real-world scenario: TASK-0042 is blocked and has `references: [{ url: 'TASK-0041', title: 'Blocking task' }]`. Without cross-reference traversal, the agent working on TASK-0042 sees the reference exists but knows nothing about TASK-0041's status — it could be done, in_progress, or also blocked. The agent would need a separate `backlog_get TASK-0041` call to find out, defeating the single-call context promise.

## Decision

Implement Phase 4 with two changes:

### 1. Cross-Reference Traversal (Stage 2.5)

**File**: `src/context/stages/cross-reference-traversal.ts`

New pipeline stage positioned between Relational Expansion (Stage 2) and Semantic Enrichment (Stage 3).

**What it does**:
1. Collects all `references[]` from the focal entity (full fidelity — always has references)
2. Collects `references[]` from the parent entity (summary fidelity — also has references at that level)
3. Extracts entity IDs from each reference URL using regex pattern matching
4. Resolves each entity not already in the visited set
5. Returns resolved entities at **summary fidelity** in a new `cross_referenced` array

**Why between Stage 2 and Stage 3?**
- Must run after Stage 2 because it needs the visited set (dedup against relational graph)
- Must run before Stage 3 because semantic enrichment needs to exclude cross-referenced entities from its search results (avoid double-surfacing the same entity)

**Entity ID extraction**: Uses regex `\b(TASK|EPIC|FLDR|ARTF|MLST)-(\d{4,})\b` to find entity IDs in reference URLs. Handles:
- Direct IDs: `TASK-0041` → `["TASK-0041"]`
- URLs containing IDs: `https://github.com/org/repo/issues/TASK-0041` → `["TASK-0041"]`
- Multiple IDs in one URL: `TASK-0041 and EPIC-0005` → `["TASK-0041", "EPIC-0005"]`
- Plain URLs (no match): `https://example.com` → `[]`
- Resource URIs (no match): `mcp://backlog/resources/doc.md` → `[]`

**Why summary fidelity for cross-referenced entities?** These are explicit links — the user/agent intentionally connected them. They deserve more context than reference fidelity (which only shows id + title + status). Summary fidelity adds timestamps and references, giving the agent enough to decide whether to investigate further. Full fidelity would be too expensive for what may be tangential links.

**Cap at 10 entities**: Prevents reference explosion from heavily-linked entities. In practice most tasks have 0-3 references, but the cap protects against pathological cases.

**Deduplication**: The visited set from Stage 2 is reconstructed in the hydration service and passed to Stage 2.5. Resolved cross-reference IDs are added to the visited set, which is then reused by Stage 3 for semantic enrichment dedup. This ensures no entity appears in multiple roles.

**Forward references only**: This stage only follows references FROM the focal entity (and its parent) TO other entities. It does not discover who references the focal entity (reverse references). See Known Hacks.

### 2. Token Budget Priority Extension

**File**: `src/context/token-budget.ts`

The budget priority order is extended from 10 levels (Phase 3) to 11 levels:

```
Priority  1: Focal entity            — always full fidelity, never dropped
Priority  2: Parent entity           — always summary fidelity, never dropped
Priority  3: Session summary         — high value, tells agent about last session
Priority  4: Children                — summary, downgrade to reference if needed
Priority  5: Siblings                — summary, downgrade to reference if needed
Priority  6: Cross-referenced        — summary, downgrade to reference if needed  <-- NEW
Priority  7: Ancestors               — reference fidelity, structural breadcrumb
Priority  8: Descendants             — reference fidelity, structural awareness
Priority  9: Related (semantic)      — summary, downgrade to reference if needed
Priority 10: Resources               — summary, downgrade to reference if needed
Priority 11: Activity                — fixed cost, drop entries if needed
```

**Why cross-referenced at priority 6 (after siblings, before ancestors)?**

Cross-references are intentional links — more signal than structural ancestors (which are just hierarchy breadcrumbs). But siblings share the same parent/workstream and are structurally always relevant, making them higher priority. Cross-references may be tangential (a task referencing a loosely related item).

The ordering: siblings (same workstream, always relevant) > cross-references (explicit links, usually relevant) > ancestors (structural, rarely actionable) > semantic (discovered, sometimes relevant).

## Type System Changes

### `ContextResponse` gains `cross_referenced`

```typescript
interface ContextResponse {
  // ... existing fields ...
  cross_referenced: ContextEntity[];  // Entities referenced by focal's references[]
}
```

### No changes to `ContextEntity`

Cross-referenced entities use existing summary fidelity — no new fields needed.

## Dependency Injection (Unchanged)

The `HydrationServiceDeps` interface is unchanged from Phase 3. Cross-reference traversal reuses the existing `getTask` dependency — no new deps needed.

## MCP Tool Changes

The `backlog_context` tool description is updated to mention cross-referenced items. Response now includes a `cross_referenced` field when non-empty.

## Known Hacks and Limitations

### Inherited from Phase 1/2/3

1. **Token estimation remains character-based** — `Math.ceil(text.length / 4)`. Unchanged.
2. **Resource discovery uses path heuristic for Stage 2** — unchanged.
3. **Sibling fetching loads all children of parent** — unchanged.
4. **Session boundary is a time-gap heuristic (30 min)** — unchanged.
5. **Session summary only covers focal entity** — unchanged.
6. **Descendants use flat list** — unchanged.
7. **BFS descendant limit per parent is 50** — unchanged.

### New in Phase 4

8. **Entity ID extraction uses regex scan over entire URL string**

**Location**: `src/context/stages/cross-reference-traversal.ts`, `extractEntityIds()`
**Issue**: The regex `\b(TASK|EPIC|...)-(\d{4,})\b` scans the entire reference URL. This could produce false positives for URLs that happen to contain ID-like patterns (e.g., a GitHub commit message URL containing "TASK-0001" as text, not as an actual reference).
**Why acceptable**: In practice, references are curated links. Users add them intentionally. False positives are rare and the dedup against existing entities prevents most issues. The regex requires the standard prefix + 4+ digits pattern, which is specific enough to avoid most collisions.
**Future fix**: Add a `reference_type` field to `Reference` to distinguish between entity references, resource URIs, and external URLs. This would eliminate regex parsing entirely.

9. **Only forward references are traversed (no reverse references)**

**Location**: `src/context/stages/cross-reference-traversal.ts`, `traverseCrossReferences()`
**Issue**: If TASK-0041 references TASK-0042 but TASK-0042 does not reference TASK-0041, the link is invisible when viewing TASK-0042's context. The agent working on TASK-0042 doesn't know that TASK-0041 links to it.
**Why acceptable**: Reverse reference discovery would require either (a) an index of "who references entity X" maintained across all mutations, or (b) scanning all tasks' references fields at query time (O(n) in backlog size). Neither is justified yet — semantic enrichment (Stage 3) already catches many of these through search, and the operation log (Stage 4) surfaces activity on related entities.
**Future fix**: Build a reverse reference index that updates on each `backlog_update` call. Store as a lightweight adjacency list: `{ "TASK-0042": ["TASK-0041", "TASK-0055"] }`. Invalidate on reference field changes.

10. **Visited set reconstruction in hydration service**

**Location**: `src/context/hydration-service.ts`, Stage 2.5 section
**Issue**: The visited set used by Stage 2 (relational expansion) is internal to `expandRelations()` and not returned. The hydration service reconstructs it from Stage 2 output (iterating over parent, children, siblings, ancestors, descendants). This is redundant work.
**Why acceptable**: The reconstruction is O(n) where n is the number of entities from Stage 2 — typically < 50. The alternative (modifying `expandRelations()` to return its visited set) would change the Stage 2 interface for a minor optimization.
**Future fix**: Return the visited set from `expandRelations()` as part of `RelationalExpansionResult`. This avoids reconstruction and ensures perfect consistency.

11. **Parent references collected via re-lookup**

**Location**: `src/context/hydration-service.ts`, Stage 2.5 section
**Issue**: To collect the parent's `references[]`, the hydration service calls `deps.getTask(expansion.parent.id)` to get the raw Task. This is a redundant lookup — Stage 2 already resolved the parent. But Stage 2 returns a `ContextEntity` (summary fidelity), not the raw `Task`.
**Why acceptable**: `getTask()` is an O(1) in-memory lookup. The cost is negligible.
**Future fix**: Have Stage 2 return the raw `parentTask` alongside the `ContextEntity`, similar to how Stage 1 returns `focalTask`.

## Invariants

### Phase 1+2+3 Invariants (carried forward)

1-37: All invariants from ADR-0076 carry forward unchanged.

### Cross-Reference Traversal Invariants (new)

38. **Cross-referenced entities are summary fidelity**: All entities in `cross_referenced` have `fidelity: 'summary'`.
39. **Cross-referenced entities do not duplicate relational graph**: No entity ID in `cross_referenced` also appears in focal, parent, children, siblings, ancestors, or descendants.
40. **Cross-referenced entities do not duplicate semantic related**: No entity ID in `cross_referenced` also appears in `related`.
41. **No entity in multiple roles (extended)**: A given entity ID appears in at most one of: focal, parent, children, siblings, cross_referenced, ancestors, descendants, related.
42. **Self-references excluded**: The focal entity's own ID never appears in `cross_referenced`.
43. **Cross-referenced capped at 10**: `cross_referenced.length <= 10`.
44. **cross_referenced is always an array**: Never `undefined` — empty array `[]` when no references resolved.
45. **stages_executed correctness**: `cross_reference_traversal` appears in `stages_executed` if and only if at least one cross-referenced entity was resolved.
46. **total_items includes cross_referenced**: `metadata.total_items` counts `cross_referenced.length`.
47. **Budget priority ordering**: Cross-referenced entities are budgeted after siblings and before ancestors.

## Test Coverage

155 tests total (up from 123 in Phase 3):

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
| Phase 3: Depth 2+ | 11 | Depth 1/2/3, ancestors, descendants, cycles, resources, pipeline |
| Phase 3: Session Memory | 10 | Session derivation, boundaries, gaps, summaries, pipeline |
| Phase 3: Token budget | 6 | Priority levels, session budget, graph_depth preservation |
| Phase 3: Contract invariants | 10 | Fidelity, graph_depth, uniqueness, ordering, total_items |
| **Phase 4: extractEntityIds** | **7** | Direct ID, URL, multiple, plain URL, resource URI, all prefixes, digit count |
| **Phase 4: traverseCrossReferences** | **9** | Resolution, fidelity, dedup, visited mutation, self-ref, no-refs, parent refs, non-existent, cap |
| **Phase 4: Pipeline integration** | **7** | Populated, empty, relational dedup, semantic dedup, stages_executed, parent refs |
| **Phase 4: Token budget** | **3** | Large budget, priority after siblings, priority before ancestors |
| **Phase 4: Contract invariants** | **6** | Summary fidelity, no relational dupes, no semantic dupes, uniqueness, total_items, always-array |

## File Changes

```
New files:
  src/context/stages/cross-reference-traversal.ts  — Stage 2.5: cross-reference parsing and resolution
  docs/adr/0077-context-hydration-phase-four.md     — This ADR

Modified files:
  src/context/types.ts                              — cross_referenced field on ContextResponse
  src/context/hydration-service.ts                  — 7-stage orchestration, Stage 2.5 integration
  src/context/token-budget.ts                       — 11-level priority, cross-referenced at priority 6
  src/context/index.ts                              — Export new stage and types
  src/tools/backlog-context.ts                      — cross_referenced in MCP output
  src/__tests__/context-hydration.test.ts           — 155 tests (up from 123)
```

## Long-Term Architecture Vision

### Where We Are (After Phase 4)

The context hydration pipeline is now a mature 7-stage system:

```
Request → Stage 1 (Focal) → Stage 2 (Relational, depth 1-3) →
          Stage 2.5 (Cross-References) → Stage 3 (Semantic) →
          Stage 3.5 (Session Memory) → Stage 4 (Temporal) →
          Stage 5 (Token Budget) → Response
```

Key strengths:
- **Single-call context delivery**: Agents go from "I need to work on X" to full context in one call
- **Structural + explicit + semantic + temporal**: Four orthogonal context dimensions
- **Explicit link awareness**: References are now first-class context, not just raw strings
- **Token-aware**: 11-level priority with graceful degradation
- **Modular**: Each stage is independently testable and deployable
- **Session continuity**: Agents know what happened in the last session
- **155 tests with 47 invariants**: Comprehensive coverage prevents regressions

### What's Missing for Long-Term Resilience

1. **Reverse cross-references**: Forward references are traversed but reverse references ("who references me?") require an index. This is the most impactful gap remaining — it would complete bidirectional link awareness.

2. **Explicit dependency graph**: The Task schema still has no `depends_on` or `blocks` field. Cross-reference traversal partially compensates (if blocking tasks are in `references[]`), but a proper dependency graph would enable blocking chain visualization: "TASK-0042 → blocked by TASK-0041 (status: in_progress) → blocked by TASK-0039 (status: open)".

3. **Multi-entity session correlation**: Session memory covers only the focal entity. A complete picture would correlate operations across focal + children + cross-referenced entities.

4. **Proactive suggestions**: The pipeline is descriptive (here's your context) but not prescriptive. Analyzing context to suggest next actions would complete the "second brain" vision:
   - "TASK-0041 was completed — consider unblocking TASK-0042"
   - "All children of EPIC-0005 are done — epic may be completable"
   - "TASK-0042 references TASK-0050 which is stale (no activity in 30 days)"

5. **Viewer UI integration**: The HTTP endpoint returns rich context but the viewer doesn't consume it yet. Panels for "Related Items", "Cross-References", "Timeline", and "Last Session" would make context visible to humans.

6. **Pre-computed context cache**: For backlogs >1000 entities, on-demand traversal may become slow. A pipeline-level cache (memoize stage results, invalidate on mutation via EventBus) would add latency resilience.

7. **Reference type classification**: Currently all references are treated the same. Distinguishing between entity references, resource URIs, external URLs, and documentation links would enable smarter traversal and presentation.

## Handoff for Next Engineer

### What was built

Phase 4 of the Retrieval-Augmented Context Pipeline. The pipeline now has 7 stages:

1. **Stage 1 — Focal Resolution** (Phase 1 + Phase 2 query): Resolves by ID or query. Unchanged.
2. **Stage 2 — Relational Expansion** (Phase 1 + Phase 3 depth 2+): Parent, children, siblings, ancestors, descendants. Unchanged.
3. **Stage 2.5 — Cross-Reference Traversal** (**Phase 4 new**): Follows `references[]` links from focal + parent. Parses entity IDs from URLs. Returns resolved entities at summary fidelity.
4. **Stage 3 — Semantic Enrichment** (Phase 2): Search-based discovery. Unchanged except dedup now includes cross-referenced IDs.
5. **Stage 3.5 — Session Memory** (Phase 3): Derives last work session from operation log. Unchanged.
6. **Stage 4 — Temporal Overlay** (Phase 2): Recent activity. Unchanged.
7. **Stage 5 — Token Budgeting** (Phase 1, extended **Phase 4**): 11-level priority including cross-referenced entities at priority 6.

### Architecture decisions to preserve

Everything from Phases 1-3 still holds, plus:

- **Summary fidelity for cross-referenced entities**: These are explicit links deserving more context than reference fidelity, but full fidelity would be too expensive for potentially tangential links.
- **Cap at 10 cross-references**: Prevents token explosion from heavily-linked entities.
- **Visited set threading**: The visited set is reconstructed from Stage 2 output, mutated by Stage 2.5, and reused by Stage 3. This ensures no entity appears in multiple roles across all stages.
- **Forward references only**: Reverse references are deliberately deferred. The visited set + semantic enrichment catch many reverse links indirectly.
- **Parent references included**: Both focal and parent references are traversed. This surfaces "the epic references TASK-X" without requiring the agent to inspect the parent manually.

### What to build next

**Priority 1: Reverse cross-references**
- Build a reverse reference index: `{ entityId: [referencingEntityIds] }`
- Update on `backlog_update` when `references` field changes
- Surface "referenced by" entities in context at summary fidelity
- Position at same priority as forward cross-references

**Priority 2: Explicit dependency links**
- Add `depends_on` / `blocks` fields to Task schema
- New traversal in Stage 2 to follow dependency links
- Surface blocking chain: "TASK-0042 → blocked by TASK-0041 (status: in_progress)"
- Higher priority than cross-references (blocking relationships are critical)

**Priority 3: Viewer UI integration**
- "Cross-References" panel in TaskDetail right pane
- "Related Items" section: children, siblings, ancestors as breadcrumb
- "See Also" section for semantic matches
- "Last Session" card showing session_summary
- Timeline section for recent activity

**Priority 4: Multi-entity session correlation**
- Extend `deriveSessionSummary()` to accept multiple entity IDs
- Merge operations across focal + children + cross-referenced into unified session timeline
- Requires time-window correlation logic

**Priority 5: Proactive suggestions**
- Analyze context to suggest next actions
- New `suggestions` array in response
- Start with blocking chain detection: "TASK-0041 is done → TASK-0042 may be unblocked"

### Known issues to address

1. **4 pre-existing test failures**: `search-hybrid.test.ts` (2, onnxruntime) and `mcp-integration.test.ts` (2, server port/timeout). Unrelated to context hydration.
2. **Visited set reconstruction is redundant**: Stage 2.5 reconstructs the visited set from Stage 2 output. Consider returning it from `expandRelations()`.
3. **Parent task re-lookup**: Stage 2.5 calls `getTask()` to get the parent's raw Task for reference extraction. Consider returning `parentTask` from Stage 2.
4. **No reference type classification**: All references are parsed identically. Adding `reference_type` to the `Reference` schema would be cleaner.

## Consequences

### Positive
- **Explicit links are now first-class context**: Agents see referenced entities' title, status, and metadata without extra tool calls
- **Deduplication across all stages**: Cross-referenced entities are excluded from semantic enrichment, preventing double-surfacing
- **155 tests with 47 invariants**: Comprehensive coverage prevents regressions
- **Backward compatible**: Tasks without references get empty `cross_referenced: []`
- **Low token cost**: Summary fidelity for cross-refs (~60 tokens each), capped at 10

### Negative
- **11-level budget priority adds complexity**: More priority levels mean more edge cases in budgeting. Mitigated by comprehensive tests.
- **Regex parsing can false-positive**: A URL containing "TASK-0001" as text would match. Mitigated by dedup and the rarity of such URLs.
- **Forward-only references**: Agents don't see who references them. Mitigated by semantic enrichment catching some reverse links.

### Risks
- **Heavily-referenced entities**: An entity with many references to large entities could consume significant tokens even at summary fidelity. The 10-entity cap and token budget prevent this from being catastrophic.
- **Circular reference chains**: Entity A references B which references A. The visited set prevents infinite traversal, but the first entity to be resolved "wins" the cross_referenced slot. This is acceptable — both entities appear in context through different roles.
