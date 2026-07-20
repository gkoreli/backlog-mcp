---
title: "0127 — The Uncached Corpus Rescan: docs-native storage re-reads every file on every read"
date: 2026-07-20
status: "Accepted (goga) — Proposal 1 (in-adapter memoized snapshot) implemented"
author: studio-engineer
relates_to:
  - 0123-authoritative-derived-evidence-boundary.md
  - 0124-resilient-daemon.md
  - ../NORTH-STAR.md
supersedes_insight_in: []
---

# 0127 — The Uncached Corpus Rescan

## Context — the viewer hangs, the daemon is healthy

Observed 2026-07-20 against the live global home
(`/Users/gkoreli/Documents/goga/.backlog`, 1,371 documents):

- The `npx backlog-mcp` node server (one PID, `dist/node-server.mjs`) pegs a
  single core at **80%+ CPU** for minutes at a time; `http://localhost:3030/`
  never resolves, `curl` on `/` and `/mcp` time out with **zero bytes**.
- The kernel still **accepts** TCP (Chrome shows 8 ESTABLISHED sockets, the
  port looks "in use" — hence the misleading `port-collision.ts` log line),
  but the saturated event loop never runs the JS to send a response.
- A `sample(1)` of the hot PID caught the stack red-handed:
  `http_parser.OnStreamRead → Promise → Builtins_ArrayMap →
  node::fs::ReadFileUtf8` — a request handler mapping over a collection and
  synchronously reading a file per element.

This is **not** startup reindex (that finished in ~2 min and wrote
`cache/search-index.json`, 70 MB). The CPU spikes **on request**, sustained.

## The defect — no in-memory model; every read re-reads the disk

`DocsNativeFilesystemStorage` (`storage/local/docs-native-filesystem-storage.ts`)
holds **no cached state**. Its single choke point re-scans the whole corpus:

```
discoverClaims()                       // :234
  → discoverDocuments({ documentsDir }) // recursive fs walk + readFileSync + gray-matter parse of ALL files
  → claimSubstrateDocuments(...)        // re-claims every doc against the registry
documents()                            // :263 — calls discoverClaims(), parses each claimed doc
```

**Every** read method funnels through `documents()` / `discoverClaims()` —
each call re-reads and re-parses all 1,371 files from disk:

| Method (evidence) | Calls |
|---|---|
| `get` :382, `getDocumentById` :355 | `documents()` |
| `getDocumentBySourcePath` :362 | `documents()` |
| `list` :397, `counts` :474 | `iterateDocuments()`→`documents()` |
| `iterateEntities` :376, `iterateDocuments` :372 | `documents()` |
| `getMaxId` :507, `assertNoClaimCollisions` :245 | `discoverClaims()` |
| `listClaimQuarantines` :272 | `discoverClaims()` |

There is no memoization, no mtime gate, nothing. The markdown tree is treated
as if reading it were free.

### Request-path amplification — O(requests × ids × corpus)

The uncached rescan is bad; the callers turn it quadratic:

- **`GET /operations`** (`hono-app.ts:654`):
  `Promise.all(operations.map(async … await requestService.get(id)))`. Each
  distinct task/epic id in the activity feed triggers one full-corpus rescan.
  A `taskCache`/`epicCache` dedupes *within* one response, but a 50-item feed
  with 30 distinct ids still fans out ~30 full re-reads of 1,371 files —
  **~41,000 file reads for one viewer poll**. This is the `ArrayMap →
  ReadFileUtf8` the sampler caught.
- **`GET /api/desk`** and **`GET /api/status`** each call
  `resourceManager.list()` → `discoverDocuments()` (`resources/manager.ts:122`,
  `local-app-request-runtime.ts:93,120`) — another full rescan per request,
  plus a `git log --name-only` subprocess over the tree
  (`git-recency.ts:38`) on every `/api/desk`.
- The viewer polls all three on an SSE `resource_changed`/`task_changed`
  fanout (`viewer/components/*.ts` `refetch()`), so one file save triggers a
  burst of full-corpus rescans across every mounted component.

Net effect: a single-threaded Node process is asked to read and gray-matter-
parse the entire corpus tens of thousands of times per interaction. The event
loop is starved; nothing else runs; `/` hangs.

## Why it stayed hidden until now

- Small corpora (tens of docs) made each rescan cheap enough to disappear
  under other latency.
- The migration to docs-native storage (recent, per `git log` on the file)
  moved from a model that held entities in memory to one that reads markdown
  as the source of truth — correct for authority (NORTH-STAR: markdown is the
  one source of truth), but the read model was never added back.
- Growth to 1,371 docs crossed the threshold where O(requests × ids × corpus)
  saturates a core.

## Constraints the fix must honor

- **Markdown stays authoritative** (NORTH-STAR). The cache is a derived read
  model, never a second source of truth; on any doubt it rebuilds from disk.
- **Correctness across writes and external edits.** Writes go through this
  adapter (`add`/`save`/`delete`/`createDocument`); external edits (agent
  editing a file, git checkout) arrive via the Parcel watcher →
  `LocalRuntime.reconcile()` → `service.reconcile()`. The cache must be
  invalidated on *both* paths or it will serve stale data.
- **Fail closed / lenient reads unchanged.** Malformed frontmatter, claim
  collisions, and quarantines must behave exactly as today — the cache only
  memoizes the *result* of the existing discovery, it does not change it.
- **Single-writer, per-home.** One `LocalRuntime` owns one adapter instance
  per home (`local-runtime-registry.ts`); there is no cross-process shared
  mutable state to coordinate. The cache is process-local and per-instance.

## Proposals

### Proposal 1 — In-adapter memoized snapshot, event-invalidated (chosen)

Memoize the single choke point `discoverClaims()` inside the adapter. Reads
between changes become O(1) map lookups over an already-parsed snapshot.
Invalidate on the two — and only two — mutation paths:

- **Local writes**: `add`/`save`/`delete`/`createDocument` clear the memo
  synchronously (they already run on the ordered write chain).
- **External edits**: add `invalidate()` to `DocumentStorageAdapter` and call
  it at the top of `BacklogService.reconcile()` — the existing
  watcher-facing refresh boundary (`backlog-service.ts:143`). The watcher
  already funnels every external change through `reconcile()`, so this is the
  exact, already-serialized seam.

Additionally, back `getDocumentById`/`get` with an id→document index built
once per snapshot, so the `/operations` fanout stops being a linear scan per
id even within a warm snapshot.

- **Pros**: kills both the rescan and the quadratic fanout; invalidation seam
  is exact and already serialized; no new subsystem; markdown stays
  authoritative; behavior identical on cold read.
- **Cons**: adds one nullable field + invalidation discipline to the adapter;
  a *missed* invalidation path would serve stale data (mitigated: only two
  paths exist, both covered and unit-tested).

### Proposal 2 — mtime / directory-signature gate

Keep no long-lived model; before each `documents()`, `stat()` the tree (or a
cheap dir-signature) and rebuild only if it changed.

- **Pros**: no explicit invalidation wiring; self-correcting against external
  edits automatically.
- **Cons**: still **O(corpus) syscalls per call** (1,371 `stat`s), so
  `/operations`' per-id fanout stays O(ids × corpus) in syscalls even if it
  avoids re-reads; racy (mtime granularity, atomic replaces); more complex
  than Proposal 1 for a strictly worse asymptote. Rejected.

### Proposal 3 — cache one layer up in `BacklogService`, keyed on a reconcile generation

Let the service hold the entity snapshot and bump a generation counter on
reconcile; storage stays dumb.

- **Pros**: keeps storage a thin fs mapper.
- **Cons**: the service would have to reimplement claim/parse/quarantine logic
  that legitimately lives in the adapter, or cache the adapter's output and
  re-expose every method — leaking storage's model upward and duplicating the
  `DocumentStorageAdapter` surface. Wrong layer; violates core-first/SRP.
  Rejected.

## Decision

**Proposal 1.** It is the minimal change that fixes the actual asymptote
(O(1) warm reads, id-indexed lookups), places invalidation on the two exact
paths that already exist and are already serialized, and keeps markdown as the
sole authority. Proposal 2 is a strictly worse asymptote; Proposal 3 puts the
model in the wrong layer.

### Rulings

- **R1** — `DocsNativeFilesystemStorage` memoizes `discoverClaims()` in a
  private nullable field; `documents()` and `listClaimQuarantines()` read the
  memo.
- **R2** — the memo is invalidated synchronously inside `write()` and
  `delete()` (covers `add`/`save`/`createDocument`/`delete`). The
  `BacklogService` write methods likewise invalidate the resource catalog
  (R6), since an entity document is also a catalog resource.
- **R3** — `DocumentStorageAdapter` gains `invalidate(): void`;
  `BacklogService.reconcile()` calls it before rebuilding the index, so every
  watcher-driven external edit refreshes the read model.
- **R4** — `getDocumentById`/`get`/`getDocumentBySourcePath` resolve through a
  by-id / by-sourcePath index built lazily from the snapshot, so the
  `/operations` per-id fanout is O(1) per id against a warm snapshot.
- **R5** — no behavioral change on cold read: the memo stores the exact result
  of today's discovery; malformed/quarantine/collision handling is untouched.
- **R6** — `ResourceManager.list()` is memoized the same way, with
  `ResourceManager.invalidate()` called on the same two seams (local writes +
  `reconcile()`). Surfaced by manual validation: with the storage cache in
  place, `/api/desk` still took a constant ~5.7 s on the 1,365-doc home
  because it calls `resourceManager.list()` → `discoverDocuments()` — the
  *same* uncached-rescan defect in a second component. (The sibling
  `buildGitRecencyMap` `git log` subprocess measured 0.05 s and is not a
  bottleneck.)

## Validation plan

- Unit: reading N times triggers discovery once (spy on a `readFile`/discovery
  dependency); a write then a read triggers exactly one re-discovery; an
  `invalidate()` then a read re-discovers; malformed/collision cases unchanged.
- Manual: run the real server against the 1,371-doc home, poll
  `/operations`, `/api/desk`, `/` — confirm CPU returns to idle between polls
  and `/` resolves promptly; edit a file on disk and confirm the change
  surfaces after the watcher reconcile (cache invalidated).

## Cross-references

- **NORTH-STAR (../NORTH-STAR.md)** — "markdown is the one source of truth":
  bounds the fix to a *derived* read cache that rebuilds from disk on any
  invalidation; we never let the cache become a second authority.
- **ADR 0123 (0123-authoritative-derived-evidence-boundary.md)** — the
  authoritative/derived boundary is exactly why the cache lives as derived
  state invalidated by the authoritative markdown, not persisted as truth.
- **ADR 0124 (0124-resilient-daemon.md) R2 (supervised organs)** — the index
  is an organ with declared health; this fix removes the accidental
  full-rescan that made the storage "organ" burn a core, complementing the
  daemon-health direction without depending on it.
