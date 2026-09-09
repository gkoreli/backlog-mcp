---
title: "0133 — Atomic document creation: fresh write authority, cached reads"
date: 2026-09-08
status: "Implemented — released in 0.74.1; worktree-family allocation remains open"
author: Codex
relates_to:
  - 0127-storage-read-cache-uncached-corpus-rescan.md
  - 0129-semantic-filenames-id-plus-slug.md
  - 0132-write-intent-parent-and-memory-provenance.md
  - ../proposals/worktree-native-access-lattice-2026-07.md
---

# 0133 — Atomic document creation

## Audit and evidence

While recording the direct-mainline preference after ADR 0132, the running
daemon minted MEMO-0016 although MEMO-0016 and MEMO-0017 already existed in
this checkout. Its different title produced a second filename. The new
duplicate was removed; a fresh CLI runtime allocated MEMO-0018 correctly.

`storage/local/docs-native-filesystem-storage.ts` uses its memoized snapshot
both for reads and the exclusive-ID check. `BacklogService.allocateId()`
reads a maximum separately from `add()`. `core/create.ts` and
`memory/backlog-memory-store.ts` both perform that split sequence. A watcher
and the search reconciliation queue therefore influence write correctness.
MEMO-0012 had already identified the stale cross-process snapshot gap.

This is distinct from TASK-0005: independent worktrees have separate documents
and can allocate identical numbers before merging. Git explicitly shares a
common directory while retaining per-worktree state
([Git worktree documentation](https://git-scm.com/docs/git-worktree)). A home
lock cannot establish repository-family identity uniqueness.

Node's exclusive `wx` open protects a pathname, not the logical identity
encoded by differently slugged filenames. Its documentation also warns against
check-then-open races ([Node filesystem documentation](https://nodejs.org/api/fs.html)).

## Rulings and file-level plan

1. **Creation is one repository operation.** Introduce a transport-free
   entity-draft/creation contract and a core helper. Local service/storage
   implements allocation plus insertion as one operation; core intent creation
   and memory persistence use it. Existing explicit-ID add and constrained
   adapters retain compatibility.
2. **Cached reads are not write authority.** Extract the docs-native read model
   into its own module. Reads remain cached. A managed mutation acquires a
   home-local filesystem lock, refreshes from authoritative markdown, validates
   identity, and writes synchronously before releasing the lock. Search indexing
   happens afterward, outside the critical section.
3. **Protect semantic identity, including quarantined documents.** Exclusive
   writes compare claim keys, not titles, filenames, or digit width. Allocation
   respects every claimed filename even when its frontmatter is quarantined.
4. **Contention fails closed.** An exclusive lock under the home's derived
   state directory serializes cooperating local processes. Service calls retry
   contention for a bounded interval; synchronous storage calls report it.
   Never steal a lock based on age or delete a lock another writer owns.
   Unsafe control-directory paths and symlinks fail before mutation. A crashed
   writer may require explicit lock recovery; this is preferable to concurrent
   writers silently bypassing exclusion.
5. **Keep the consistency scope honest.** This fixes same-home concurrent and
   stale-runtime creation, across all substrate types. It does not coordinate
   separate worktrees or clones, or lock an external editor. TASK-0005 remains
   open for a separate family allocator decision: shared sequence reservation
   versus branch-qualified IDs, bootstrap from existing histories, and offline
   clone/merge behavior. No cross-home document visibility is introduced.

## Further architecture findings

- Memory replacement currently expires predecessors before insertion. Moving
  it to a domain operation with explicit commit/failure semantics deserves its
  own change; an allocation fix must not silently redefine that lifecycle.
- Storage currently combines discovery/projection, read caching, path security,
  identity policy, and persistence. Extract the read model now; retain the
  existing path checks and serialization semantics through regression coverage.
- Identity aliases in `core/normalize-memory-refs.ts` reuse search vocabulary.
  A future shared identity value object could remove that domain-to-search
  dependency without introducing another competing ID grammar.

## Validation and engineering record

The implementation adds `core/entity-creation.contract.ts` and
`core/persist-new-entity.ts`, used by `core/create.ts` and the memory adapter.
`BacklogService.create()` delegates to storage's synchronous creation operation,
then indexes the committed document. Legacy `allocateId()` remains an ID preview
for compatibility; the local create paths no longer use it as a reservation.

`storage/local/docs-native-read-model.ts` now owns discovery, projection, and
claim indexes. The storage adapter holds its cache but refreshes it inside
`document-write-lock.ts` before managed mutations. Claim comparison uses
`core/document-identity.ts:normalizeDocumentKey`, shared with discovery, so
leading zero width cannot bypass exclusion. Claimed but malformed documents
participate in sequence maxima. Incomplete directory scans and exhausted/unsafe
numeric sequences fail closed instead of allocating from incomplete evidence.

### Regression evidence

Before the fix, all three new storage regressions failed: a stale second
adapter inserted a different slug for the same memory ID, TASK-00001 bypassed
the existing TASK-0001 guard, and malformed TASK-0007 disappeared from the
allocation maximum. They now pass alongside tests of same-runtime concurrent
remembers, stale independent repositories, declarative requirements, held locks,
lock cleanup after failed validation, unsafe state symlinks, and bounded retries.
All unit filesystem operations use the global memfs setup.

`pnpm test` passed across the workspace: **1,652 tests passed, 2 skipped**
(server 1,446; viewer 157; memory 49). Workspace typecheck and server build passed.

A separate manual harness started **four independent Node HTTP/MCP server
processes**, each using the rebuilt production composition, real watchers,
BM25 search, and real filesystem homes under a temporary directory. Twenty
concurrent public `backlog_remember` calls into one project produced twenty
unique persisted IDs and exactly twenty remember journal entries. All returned
success, and no lock remained afterward. A warmed stale repository rejected an
explicit duplicate with a different slug, while generated creation advanced to
the next free ID. A malformed MEMO-0027 reserved its number and the next memory
received MEMO-0028. An intentionally held lock failed within the bounded wait
without document or journal writes and was left intact. The lock helper refused
a symlinked state directory without creating a lock in the target home.

The previous ADR 0132 manual HTTP/MCP and CLI scenarios were rerun on the final
build and passed: artifact parent persistence, requirement/ADR provenance,
malformed-input rejection, and project-defined identity isolation. Every
temporary server, watcher, and home was closed or removed afterward.

### Operational scope and remaining design

The lock coordinates upgraded cooperating writers within **one home**. Old
running binaries and external editors do not participate. A process killed
inside its short synchronous critical section can leave
`.backlog/state/document-write.lock`; confirm all writers have stopped before
removing an abandoned lock. No timeout-based lock stealing is implemented.
Each mutation now pays for a fresh corpus scan; repeated reads retain the
memoized model. If write throughput later requires optimization, introduce an
identity-only scan beneath this same contract rather than using stale cached
identity for writes again.

TASK-0005 remains open: separate worktrees still need a family-wide allocator
policy. The W1 family probe is currently fail-open and excludes main checkouts
and detached HEADs, which makes it unsuitable as write authority without a
new contract. A future family allocator must define bootstrap from existing
branch histories, clone/offline semantics, and recovery of reservation state.

Released in 0.74.1 (2026-09-09 UTC); this release does not close TASK-0005 or the
historical ADR identity reconciliation tracked by TASK-0014.
