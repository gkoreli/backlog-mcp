---
title: "0129 — Semantic Filenames: ID plus slug, the ID stays the only identity"
date: 2026-09-01
status: "Accepted (goga) — Phase A implemented 2026-09-01; Phase B (R8, viewer pane id resolution) open"
author: goga + claude
relates_to:
  - 0112-docs-native-project-scoped-backlog.md
  - 0113-user-defined-substrates.md
  - 0117-the-write-boundary.md
  - 0127-storage-read-cache-uncached-corpus-rescan.md
  - ../NORTH-STAR.md
---

# 0129 — Semantic Filenames

## Context — a folder of numbers next to a folder of names

Since ADR 0112 the backlog bolts onto a repo's existing `docs/` tree. That
tree is mostly human-named: `docs/adr/0127-storage-read-cache-uncached-corpus-rescan.md`,
`docs/prompts/0006-first-person-memory-capture-law.md`, `docs/agents/AGENT-0001-granite.md`.
Every document the engine itself writes, however, is a bare number:

```
docs/memories/MEMO-0010.md          docs/tasks/TASK-0004.md
docs/references/REF-0014.md         docs/references/REF-0015-cerebras-enterprise-knowledge-base.md
```

The last line is the tell. `REF-0015` and `REF-0016` were written by hand
with a slug; `REF-0001`–`REF-0014` were written by the engine without one.
Both are read identically. A human scanning the folder (or an agent running
`ls`) learns what `REF-0015` is from its name and learns nothing from
`REF-0014`. The number is the identity, but the name is the affordance, and
today the engine withholds the affordance from its own output.

The ask: engine-written documents should be named `<ID>-<slug>.md` — for
example `MEMO-0010-focus-never-yield-by-construction.md` — with the slug
derived from the title. Old bare-number files and new slugged files coexist
forever; nothing is renamed.

## Audit — the read side already does this

Grounding before design (Development Loop step 2). Cited against `main`
at `135db9d`.

**Filename parsing already splits key from slug.**
`core/document-identity.ts:9-10` defines two regexes:

```ts
const NUMBERED_FILENAME        = /^(\d+(?:\.\d+)*)(?:-(.*))?$/u;
const PREFIXED_NUMBER_FILENAME = /^([A-Za-z][A-Za-z0-9]*)-(\d+(?:\.\d+)*)(?:-(.*))?$/u;
```

`MEMO-0010-anything-here.md` parses to `pathKey: 'MEMO-0010', slug:
'anything-here'`. `document-identity.test.ts:72-80` proves it for
`0023.1-uplift-map.markdown`. The slug is carried on `DocumentIdentity.slug`
(`document-identity.types.ts:6`) and used exactly once on the read path: as a
title fallback when frontmatter and the first heading are both absent
(`docs-native-filesystem-storage.ts:101-104`).

**Claiming and collision detection key on the number, never the slug.**
`core/substrates/claim-substrate-documents.ts:12-51` derives `storageKey`
and `semanticKey` from `pathKey` alone; the collision map at line 97 is
`home \0 type \0 semanticKey`. `document-discovery.ts:411-424` runs the
same duplicate check per collection on `pathKey`. Two files
`MEMO-0010.md` and `MEMO-0010-foo.md` in one folder are therefore already a
`duplicate-substrate-document` diagnostic, both quarantined, and the write
boundary refuses that type until a human resolves it
(`docs-native-filesystem-storage.ts:assertNoClaimCollisions`). Fail-closed,
already verified by `docs-native-filesystem-storage.test.ts:378`.

**Write identity validation tolerates slugs.**
`validateWriteIdentity` (`docs-native-filesystem-storage.ts:178-188`) parses
the target path and compares `identity.pathKey` with the id's canonical path
key via `matchesStorageDocumentIdentity` (`storage-identity.ts:119-127`).
The slug never enters the comparison. `save()` preserves an existing slugged
`sourcePath` (`docs-native-filesystem-storage.ts:512-521`; test at
`:487`, "preserves an existing slugged source path when saving").

**ADR 0112 R-6 already rules the semantics** (lines 330-331): *"the filename
key is the physical identity. The slug is descriptive and may change without
changing identity."*

**The one place that is number-only is the write allocator.**
`storageDocumentSourcePath(claim, id)` (`storage-identity.ts:104-114`) builds
`<folder>/<prefix>-<key>.md` and has no slug input. Its callers:

| Caller | Line | Effect |
|---|---|---|
| `DocsNativeFilesystemStorage.add` | `docs-native-filesystem-storage.ts:502` | every engine-created document |
| `DocsNativeFilesystemStorage.save` (no existing doc) | `:519` | same, via save |
| `migrate-docs-native.ts` | `:442`, `:530` | legacy `.backlog-mcp` → `docs/` migration targets |

**Nothing in the repo slugifies.** A grep for `slugify`, `toSlug`, `kebab`
over `server`, `shared`, and `viewer` returns nothing. The function has to be
written; it is small.

**One pre-existing, slug-independent gap.** The viewer opens pane-type
entities (artifacts) through `mcp://backlog/tasks/${id}.md`
(`viewer/components/task-detail.ts:154`, `metadata-card.ts:84,149`,
`collision-candidates.ts:30`). `ResourceManager.resolve`
(`resources/manager.ts:236-266`) is a pure path catch-all with no id lookup.
In docs-native mode artifacts live under `artifacts/`, not `tasks/`, so those
links already miss the file before any slug exists. Slugs widen the same gap
by one more case. It is recorded here and routed to Phase B; it is not a
reason to withhold slugs from the write path.

## The ruling on identity — answering the obvious question

*Does the ID remain uniquely identifying on its own, with the slug purely
additive?* **Yes, and this ADR makes that a law rather than a happenstance.**

- Uniqueness is the number key, scoped by home and substrate. That is what
  the allocator increments and what collision detection compares. The slug
  contributes nothing to uniqueness and is never parsed for meaning.
- Two files with the same key and different slugs are a collision, not two
  documents. This already holds; it stays.
- The slug is optional at every layer: readers accept a bare `MEMO-0010.md`
  forever, the id in frontmatter stays `MEMO-0010`, every tool and URL keeps
  addressing by ID.

So the slug is a filename courtesy for humans and `ls`, nothing more. That is
the right size for it: any larger role (identity, lookup key, link target)
would recreate the "readable link becomes an opaque database ID" failure
that ADR 0112 R-6 forbids, in reverse.

## Rulings

**R1 — The number key is the only physical identity.** `(home, substrate,
key)` is the canonical reference (ADR 0112 R-6, restated). A slug never
participates in identity, uniqueness, allocation, lookup, or link resolution.

**R2 — Engine-created documents get `<pathKey>-<slug>.md`.** Every document
created through the managed write path (`add`, or `save` of an id that has no
document yet) is written as `<folder>/<pathKey>-<slug>.md`, where the slug is
derived from the entity's `title` by R3. This applies uniformly to every
storage claim regardless of strategy: `MEMO-0011-<slug>.md`,
`REF-0017-<slug>.md`, and for a `numbered` substrate `0130-<slug>.md`. Built-in
and user-defined (ADR 0113) substrates are treated identically; no substrate
declaration is needed or added.

**R3 — Slug derivation is deterministic, ASCII, and bounded.**
`slugifyDocumentTitle(title)`:
1. Unicode NFKD normalize, drop combining marks (so `café` → `cafe`).
2. Lowercase; replace every run of non-`[a-z0-9]` with one `-`.
3. Trim leading/trailing `-`.
4. Cap at 60 characters, cutting back to the last `-` boundary so no word is
   sliced mid-way; trim again.
5. If the result is empty (a title of only symbols or non-Latin script),
   return `undefined` and write the bare `<pathKey>.md`. The bare form is a
   valid outcome, not an error.

The cap is the difference between a filename and a sentence. Titles here run
long (MEMO-0010's is 95 characters); 60 keeps `ls` legible and stays far
under every filesystem's 255-byte limit even with a prefix and extension.

**R4 — The slug is frozen at creation.** Editing a title never renames the
file. Renames churn git history, break the native relative links ADR 0112
R-6 promises to preserve, and would need a watcher-side story for external
edits. A stale slug costs nothing: the title in frontmatter is the display
truth and the key is the identity. (A future explicit `rename` verb may
exist; it is not this ADR.)

**R5 — Readers accept both forms forever; there is no migration.** Existing
bare-number files are left untouched. Mixed folders are the expected steady
state. No config flag turns slugs on or off: one write shape, one read shape
with two spellings, no dual-mode reader (ADR 0112 R-11).

**R6 — The legacy migration keeps numeric targets.** `migrate-docs-native.ts`
moves `.backlog-mcp` entities into `docs/` at `<pathKey>.md`. That tool is a
one-time bridge with fixture-pinned outputs; giving it slugs buys nothing for
the steady state R5 describes and would invalidate its tests. Unchanged.

**R7 — D1 is untouched.** Remote mode has no filenames (ADR 0104: retained,
no parity owed).

**R9 — Exclusive creation guards the id, not just the path.** Before
slugs, `add()`'s `wx` open flag was the whole race guard: two writers minting
`TASK-0001` hit the same path and the second got `EEXIST`. With slugs, two
writers with different titles land on two paths and `wx` sees no conflict.
The adapter therefore refuses an exclusive create when the read model already
holds that id (`Document id already exists`). In-process this is exact. Across
processes with a stale memoized snapshot (ADR 0127) the second write can still
land, and the next read quarantines both files as a `duplicate-substrate-document`
collision that blocks the type until a human resolves it: a visible, fail-closed
outcome rather than a silent overwrite. Found by the existing atomic-create test
going green for the wrong reason during Phase A; recorded so nobody removes the
guard as redundant with `wx`.

**R8 — Phase B: id-addressed resource resolution for the viewer pane.** The
pre-existing `mcp://backlog/tasks/<id>.md` gap (Audit, last paragraph) gets
its own fix: the viewer should open pane documents by id through the entity
API, or the resource proxy should fall back to `storage.getFilePath(id)` when
the literal path is absent and the basename stem parses as a known id.
Design in a thread child (0129.1) if it needs more than a few lines; it does
not block Phase A.

## Engineering plan — Phase A

Core-first (ADR 0090), minimal (no over-engineering posture), all under
`packages/server/src`.

1. **`core/document-slug.ts`** (new) — `slugifyDocumentTitle(title: string):
   string | undefined` per R3. Pure, no imports. JSDoc cites this ADR.
2. **`storage/storage-identity.ts`** — `storageDocumentSourcePath(claim, id,
   slug?)` appends `-${slug}` to the path key when a slug is given. Signature
   stays backward compatible for the migration caller (R6).
3. **`storage/local/docs-native-filesystem-storage.ts`** — `add()` and the
   no-existing-document branch of `save()` pass
   `slugifyDocumentTitle(entity.title)`. The existing-document branch of
   `save()` is untouched (R4).
4. **Tests** (memfs, unit only):
   - `__tests__/document-slug.test.ts` — diacritics, symbol-only titles,
     the 60-char boundary cut, idempotence.
   - `__tests__/storage-identity.test.ts` — slugged path formatting for
     prefixed, numbered, and threaded claims; `matchesStorageDocumentIdentity`
     still true for the slugged path.
   - `__tests__/docs-native-filesystem-storage.test.ts` — `add` writes
     `tasks/TASK-0001-<slug>.md`, `get`/`getFilePath` find it by id,
     `getMaxId` counts it, a bare and a slugged file for one key still
     quarantine as a collision, title edit does not rename.
5. **`CHANGELOG.md`** — `[Unreleased] / Changed` entry.
6. **`docs/adr/README.md`** — index entry.

Out of scope for Phase A: renaming existing files, a rename verb, the viewer
pane link (R8), migration targets (R6), D1 (R7).

## Validation

- Unit suites above, green.
- Manual, real process (Development Loop step 5): create a memory and a task
  through the CLI against this repo's home, `ls docs/memories docs/tasks`,
  confirm the slugged filename, `backlog get <id>` resolves it, and a second
  `wakeup` lists it. Confirm that placing a hand-copied `MEMO-00NN.md` next
  to the slugged file surfaces the collision diagnostic and blocks memory
  writes until removed (fail-closed check on the boundary).

### Findings (2026-09-01, Phase A)

Ran the built CLI (`dist/cli/index.mjs --project-root <scratch>`) against a
fresh git-initialized scratch home:

- `create "Ship the Release: Part II!"` → `docs/tasks/TASK-0001-ship-the-release-part-ii.md`.
- `create "ცა"` (Georgian-only title) → `docs/tasks/TASK-0002.md`, bare form
  per R3 step 5.
- `remember --title <MEMO-0010's 95-char title>` →
  `MEMO-0001-focus-is-never-yield-by-construction-lines-added-to-it-are.md`
  (58 chars of slug, cut on a word boundary per R3 step 4).
- `update TASK-0001 --title "Renamed after the fact"` → file unchanged (R4);
  `get TASK-0001` shows the new title.
- Copying the slugged memory to `MEMO-0001.md` beside it: `get MEMO-0001`
  returns nothing (both quarantined) and `remember` is refused with
  `duplicate document identities: memories/MEMO-0001-…md, memories/MEMO-0001.md`.
  Deleting the copy restores writes; the next memory allocates `MEMO-0002`.
  Fail-closed confirmed on the boundary.
- **Pre-existing, not introduced here:** the CLI surfaces that refusal as an
  uncaught `SubstrateWriteError` stack trace rather than a one-line message.
  The stashed pre-0129 build behaves identically on a bare-vs-bare collision.
  Worth a small CLI-side catch in its own change.

Unit suites: server 1391 passed, viewer 151 passed, typecheck clean.

## Consequences

- `ls docs/memories` becomes a readable index without opening a file. This is
  the whole point: on a docs-native home the folder *is* the UI half the time.
- Filenames drift from titles over time (R4). Accepted; the key is the truth.
- Agents that construct paths from ids by hand (`docs/tasks/${id}.md`) were
  already wrong under ADR 0112 (files can live in sub-folders, can carry
  slugs by human hand). This ADR makes that wrongness common instead of rare,
  which is the correct pressure: address by id, read `sourcePath` from the
  entity, never synthesize a path.
