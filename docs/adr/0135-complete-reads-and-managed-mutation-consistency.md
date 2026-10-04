---
title: "0135. Complete reads and managed mutation consistency"
date: 2026-10-03
status: "Accepted — engineering in stages under maintainer authorization"
---

# 0135. Complete reads and managed mutation consistency

The maintainer authorized engineering of [assessment 0019](../reports/0019-ddd-flow-assessment-2026-10-03.md).
Its reproduction with 25 memories returned size 20 and could not forget the
oldest ID. A controlled concurrent core update lost an independent field change.
These are invariant failures, not reasons for a new domain framework.

## Rulings

1. **Complete reads are a separate consumer capability.** `EntityCorpusReadPort`
   returns a complete filtered snapshot without pagination or search ranking.
   Local storage's existing iterator supplies it. An unavailable capability fails
   visibly rather than silently substituting a display page. Analysis, correction,
   counts and context membership use complete reads; public listing stays bounded.
   Eligibility is shared and applied before display limits. Context traversal has
   the equivalent local synchronous capability. The descoped D1 graph need not
   acquire local capabilities to satisfy this ruling.
2. **Managed updates detect stale preimages.** Local read-modify-write operations
   must compare a captured preimage/revision inside the existing home write lock.
   A conflict is a typed domain error with a reread instruction. No semantic write
   is automatically replayed or rebased. Native edits remain authoritative; the
   guarantee must identify what is checked and avoid claiming editor transactions.
3. **A durable commit is acknowledged independently of derived indexing.** A
   committed mutation with failed index work reports repair pending explicitly;
   it is not returned as an uncommitted failure. Preserve ordered indexing,
   reconciliation and exact semantic journal ownership. Additive diagnostics are
   permitted; do not change existing successful receipt fields or replay writes.
   ADR 0117's journal remains an exact best-effort append attempt, not an atomic
   second source of truth. Sink failures after commit cannot undo that commit.
4. **Correction is a deterministic multi-document plan.** Complete holder discovery,
   successor validation and predecessor closure belong to one domain operation.
   Preserve ADD-only history and explicit recovery/partial-failure reporting.
   Neither reordering two independent writes nor a process-only mutex establishes
   the invariant. A narrow local capability may coordinate a real plan under the
   existing home lock; no generic transaction framework is authorized by this ADR.
5. **Search payload freshness is distinct from searchable-text freshness.** Native
   metadata changes must refresh returned entities and filter fields even without
   timestamp changes. Embeddings only need recomputation when embedding inputs
   change. Viewer match explanations consume server-declared plain-text snippets;
   HTML highlighting remains a client rendering concern.
6. **Validity and write stamping have named owners.** Memory folds use a common
   temporal projection and one operation time. Malformed dates remain lossless and
   diagnosable. Body edits reuse identity/timestamp policy while preserving their
   text-edit receipt and attribution. Missing storage claims are typed errors.
7. **Refactor capabilities after their contracts are concrete.** Narrow ports and
   composition bundles follow actual consumers. Preserve open substrates, literal
   null intent values, generic null deletion, native resource edits, containment,
   home isolation and multi-intent single semantic journal ownership. Lifecycle
   cleanup must state admission during shutdown. Larger migration/discovery moves
   must preserve preflight, rollback and lossless diagnostics in separate stages.

## Engineering record

- Stage A introduces complete corpus reads and eligibility before pagination;
  memory/analysis/attribution/wakeup/context callers migrate to that capability.
  Real local memfs fixtures cover more than 20 memories and siblings. Existing
  fake services now declare scan separately; the memory fake's display list is
  actually bounded. Later stages will record their exact implementation and
  verification here rather than claiming these rulings are already all shipped.
- Stage A verification: workspace build/typecheck passed; server 1,519 tests
  passed / 2 existing skips, memory 49 and viewer 157 passed. A built-module
  actual-filesystem check in a disposable temporary home returned complete size
  25, display size 20, oldest-ID forget count 1 and remaining live size 24.
  Search was unused and mocked in that manual check; unit query parity used the
  real Orama implementation over memfs. No user corpus or installed package changed.
- Stage B refreshes complete search payloads, filter metadata and persisted caches
  independently of embedding text. Metadata updates reuse the stored vector;
  payload-only changes skip index reconstruction. Explicit selection also applies
  to exact-ID/filter-only fast paths. Spotlight consumes server snippets and open
  type keys; escaped highlighter positions protect both titles and snippets.
  HomeSelector's status/manifest/forget refreshes share generation/disposal guards.
- Stage B verification: workspace build/typecheck passed; server 1,521 / 2 existing
  skips, memory 49 and viewer 163 tests passed, including native edits with unchanged
  timestamps, mocked embeddings, cache reload, actual Spotlight rendering and
  reversed home responses/disposed forgetting. A built-module temporary-cache
  check passed metadata filtering, exact-ID payload freshness and cache reload.
  Stage A's older-task fixture now assigns timestamps after factory construction
  and explicitly proves it falls outside the raw default page before eligibility.
- Stage C adds an exact-Markdown SHA-256 preimage to local reads and captures the
  written revision inside the lock. Updates/body edits/single compiled intents
  compare it against the fresh locked snapshot; a typed `write_conflict` asks for
  a reread. Legacy injected repositories without revision reads retain semantic
  preimages, not a claim of cross-process protection. The local docs-native graph
  supplies the full capability. Native editors remain non-cooperating: detection
  is at the check boundary, not an OS transaction with arbitrary editors.
- Local committed create/save/delete outcomes carry optional warnings separately
  from entities. Catalog invalidation, projection and ordered indexing are covered
  by the derived-effect boundary. Failure marks search unready and the next query
  retries full reconciliation; it never repeats the document mutation. Core
  receipts and CLI/MCP formatting preserve diagnostics. Known throwing log/event
  sinks return warnings after one attempt; standard local append remains best-effort
  under ADR 0117. Body edits reuse stamping; missing claims and write normalization
  have named typed owners. Multi-intent compensation now guards restoration with
  the revision it actually wrote, rather than overwriting intervening edits.
- Stage C verification: workspace build/typecheck passed; server 1,527 / 2 existing
  skips, memory 49 and viewer 163 tests passed. New memfs cases cover interleaved
  updates, native formatting edits, committed add/save/delete index failures,
  throwing custom-field projection, custom timestamps and throwing effect sinks.
  Two actual Node processes over a disposable home both captured one preimage:
  exactly one committed, one reported conflict, and only one journal attempt was
  made. Search/resource work was mocked in that process check; no full CLI race
  or universal native-editor transaction is claimed.

- Stage D coordinates correction through a narrow local capability. Its pure plan
  selects every live predecessor from the fresh locked corpus; all identities,
  schemas, paths and canonical-adoption requirements are checked before effects.
  Closures publish first, the successor last. Failure restores original Markdown
  bytes only while they still match this operation's postimage; a typed error
  distinguishes restored failure from partial recovery and identifies affected
  and unrecovered IDs. Adapters without the capability fail visibly for corrections.
  This is cooperating-writer consistency plus guarded compensation, not a crash
  transaction across files or universal coordination with native editors.
- Managed Markdown uses complete temporary files and atomic rename for updates,
  exclusive hard-link publication for creation, and best-effort temporary cleanup.
  Existing permission bits are restored before publication, including bits normally
  masked by umask. Failed publication leaves original bytes intact. Search recovery
  reconciles a partially recovered correction; successful corrections report index
  diagnostics through MemoryStore/Composer/remember and journal exactly once.
- A named temporal projection makes absent/null/empty expiry unbounded, valid
  expiry at or before the operation time expired, and malformed native expiry
  live and diagnosable. No NaN expiry leaks into MemoryEntry. Store operations
  sample one injectable clock; pure entry minting owns the created-date fallback.
  Recall/counts/contradictions/collisions/consolidation share validity. Wakeup
  consumes the pure projection instead of constructing an infrastructure store;
  its fixed architecture violation is removed.
- Parent independent Stage C check also used newly built modules and a disposable
  actual-filesystem home: concurrent core updates produced one success/conflict
  and one journal; throwing indexing and journal callbacks retained committed
  Markdown with the corresponding warnings. Derived callbacks were mocked.
- Soft forgetting, expired-memory GC and legacy global usage-frontmatter updates
  carry the same exact-byte preimages. A native correction between selection and
  save/delete rejects the mutation; usage keeps its best-effort conflict policy.
  Project usage overlays remain separate from committed memory documents.
- Stage D verification: workspace build/typecheck passed; server 1,544 / 2 existing
  skips, memory 49 and viewer 163 tests passed. Seventeen new memfs cases cover
  complete/simultaneous corrections, validation, failed closures/successor,
  exact-byte and guarded recovery, receipt diagnostics, permissions, stale memory
  writers and missing/null/invalid/boundary expiry. Two actual Node processes
  over a disposable home produced distinct successors, retained 27 history
  records and left exactly one live holder. Existing 0664 permissions survived;
  an adversarial control/state symlink was rejected without creating a lock in
  its target. Search callbacks were mocked in that process check; recovery and
  real Orama repair were unit-tested over memfs.
