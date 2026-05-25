# 0101. Search Index Reconciliation — Fixing Silent Corpus Drift

**Date**: 2026-05-24
**Status**: Proposed
**Triggered by**: User unable to find TASK-0596 ("Research: Fredrika Unified Diff Viewer") via `backlog_search("diff viewer")` despite the title containing both words verbatim. Investigation revealed 165/915 entities missing from the search index entirely.

## Context

The search index (Orama BM25 + optional vector retrieval) uses a JSON cache on disk (`.cache/search-index.json`). On startup, `OramaSearchService.index()` attempts `loadFromDisk()`:

```typescript
// packages/memory/src/search/orama-search-service.ts:181–198
async loadFromDisk(): Promise<boolean> {
  if (!existsSync(this.indexPath)) return false;
  const raw = JSON.parse(readFileSync(this.indexPath, 'utf-8'));
  if ((raw.version ?? 0) !== INDEX_VERSION) return false; // ← only invalidator
  this.db = await this.createOramaInstance(this.hasEmbeddingsInIndex);
  load(this.db, raw.index);
  this.taskCache = new Map(Object.entries(raw.tasks));
  this.resourceCache = new Map(Object.entries(raw.resources || {}));
  return true;
}
```

If version matches, the cache is **trusted absolutely** — no reconciliation against actual task files on disk. The fresh-index path is skipped entirely.

### How entities go missing

Three distinct failure modes produce the same symptom (entity not in index):

| # | Failure mode | Mechanism |
|---|---|---|
| 1 | **Pre-search creation gap** | `BacklogService.add()` only calls `search.addDocument()` when `this.searchReady === true`. `searchReady` flips on the *first* `searchUnified()` call. Tasks created before that point are written to disk but never enter the in-memory index or cache. |
| 2 | **Lost persistence** | `persistToDisk()` is debounced 1s via `scheduleSave()`. Process shutdown within that window loses the write. The catch-all `} catch {}` swallows all errors silently. |
| 3 | **External mutations** | Any edit to `tasks/` files outside the running server (git pull, manual edit, another MCP client) is invisible — no filesystem watcher exists. |

### Scale of the problem

Direct inspection of the production cache:
- On-disk entities: **915** (665 TASK, 41 EPIC, 207 ARTF, 1 FLDR, 1 MLST)
- Indexed documents: **791** (751 tasks + 40 resources)
- **Missing: 165 entities** (74 TASK, 85 ARTF, 5 EPIC, 1 FLDR)
- Spans creation dates 2026-02-07 → 2026-05-20

### Secondary finding: `tolerance` vs prefix trade-off

Orama's Radix tree has two mutually exclusive lookup paths (`trees/radix.ts:240–303`):

```typescript
public find({ term, exact, tolerance }) {
  if (tolerance && !exact) {
    // Levenshtein walk only — NO prefix matching
    this._findLevenshtein(term, 0, tolerance, tolerance, output)
  } else {
    // Prefix walk: collects all words rooted at the matched subtree
  }
}
```

Our `tolerance: 1` enables typo tolerance but **disables prefix expansion**. Query "diff" matches "dif" (edit-distance 1) but NOT "different" (prefix). This is an intentional Orama design — confirmed in source and related behavior discussed in [issue #797](https://github.com/oramasearch/orama/issues/797).

Note: this gotcha did not affect TASK-0596 (whose title contains "Diff Viewer" verbatim) but is worth surfacing as a separate Orama config-quality concern.

**Source:** `oramasearch/orama` GitHub, `packages/orama/src/trees/radix.ts`, `methods/search-fulltext.ts`, `tokenizer/index.ts`. Verified via `ghx` exploration.

## Decision

### Approach: Startup reconciliation with incremental diff

On `ensureSearchReady()`, after loading the cache, compare the cached document set against the current filesystem state. Incrementally add missing documents and remove stale ones. Full rebuild only when the diff exceeds a threshold.

### Rejected alternatives

| Alternative | Why rejected |
|---|---|
| **Always rebuild from scratch** | ~915 docs × embedding call = 10-30s cold start with hybrid mode. Unacceptable for MCP client responsiveness. |
| **Filesystem watcher (fswatch/chokidar)** | Adds complexity, platform-specific behavior, doesn't help with the startup gap. Worth considering later as an enhancement but doesn't solve the core problem. |
| **Bump INDEX_VERSION to force rebuild** | One-time fix. Doesn't prevent future drift. We need a structural fix. |
| **Persist synchronously on every write** | Eliminates lost-persistence but adds latency to every mutation. The debounce exists for good reason. |

## Implementation

### Phase 1: Reconciliation on startup (fixes all three failure modes)

```typescript
// In ensureSearchReady(), after search.index() returns:
private async ensureSearchReady(): Promise<void> {
  if (this.searchReady) return;
  const allTasks = Array.from(this.taskStorage.iterateTasks());
  await this.search.index(allTasks); // may load from cache
  await this.search.reconcile(allTasks); // NEW: incremental diff
  // ... resources ...
  this.searchReady = true;
}
```

`OramaSearchService.reconcile(currentTasks)`:
1. Build a `Set<string>` of all current entity IDs from the filesystem
2. Compare against `this.taskCache.keys()`
3. **Missing from index:** insert (with embeddings if hybrid mode active)
4. **In index but not on disk:** remove (entity was deleted externally)
5. **In both but content differs:** update (entity was modified externally). Compare `updated_at` or content hash.
6. If changes were made, `persistToDisk()` immediately (not debounced)
7. Log: `reconcile: added=${added} removed=${removed} updated=${updated}`

### Phase 2: Fix pre-search creation gap

Change `BacklogService.add()` / `save()` / `delete()` to always queue index operations, regardless of `searchReady`:

```typescript
private pendingOps: Array<{ op: 'add' | 'update' | 'remove'; entity?: Entity; id?: string }> = [];

async add(task: Entity): Promise<void> {
  this.taskStorage.add(task);
  if (this.searchReady) {
    this.search.addDocument(task);
  } else {
    this.pendingOps.push({ op: 'add', entity: task });
  }
}
```

Drain `pendingOps` at the end of `ensureSearchReady()`, after reconcile.

### Phase 3: Harden persistence

- Flush to disk on `SIGTERM` / `SIGINT` (process shutdown hook)
- Change `persistToDisk` error handling from silent catch to logged warning
- Add a periodic flush every 60s as a safety net (in addition to the 1s debounce)

### Tolerance/prefix documentation

Document in tool description and internal docs:
- `tolerance: 1` gives typo tolerance but no prefix expansion
- For prefix-style queries, users should use `backlog_list` with a filter, or search for the complete word
- Consider exposing a `prefix: true` option in future (would require `tolerance: 0` for that query)

## Consequences

- **Cold start unchanged** when cache is fresh (reconcile is O(n) set diff, no Orama calls)
- **Cold start +100-500ms** when cache is stale (incremental inserts for missing docs, no embeddings needed for BM25-only)
- **No more silent corpus drift** — every entity on disk will be searchable
- **External edits detected** on next server start (not live — that's a future enhancement)
- **Operational visibility** via reconcile log line

## References

- ADR 0073: MCP-first unified search architecture
- ADR 0079: Native Orama filtering
- ADR 0080: Native sortBy + facets
- ADR 0081: Independent retrievers + linear fusion
- ADR 0092.1: Temporal decay
- Orama source: `oramasearch/orama` (GitHub), `trees/radix.ts:240–303` (tolerance vs prefix)
- Orama issue #340: stemming off by default
- Orama issue #797: tolerance + short word interaction
- Orama issues #695, #869, #883: save/load fragility (all fixed in 3.x)
