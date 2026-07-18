---
title: "0122 — Substrate Schema Evolution: Named Versions, Frozen History, Documents That Age Gracefully"
date: 2026-07-18
status: Proposed (granite; distilling PROMPT 0011)
author: granite (architect)
relates_to:
  - ../prompts/0011-schema-evolution-versioning.md
  - 0113-user-defined-substrates.md
  - 0117-the-write-boundary.md
  - 0121-retrieval-evaluation-from-first-principles.md
---

# 0122 — Substrate Schema Evolution

## Context

Substrates will change after thousands of documents exist: fields rename,
states become obsolete, relations change cardinality, workflows gain and lose
transitions, project-defined definitions evolve, and different branches carry
different definition versions (PROMPT 0011, verbatim). The store must be able
to say of any document: *I can read it; I know which definition interpreted
it; it does not satisfy today's canonical write schema; here are diagnostics;
I have not modified it.*

**What the code says today (explored 2026-07-18):**

- `definitionVersion` exists on every declaration — and is **pinned to
  `z.literal(1)`** by the meta-schema
  (`packages/shared/src/substrates/substrate-definition.schema.ts:171`). The
  version field is a placeholder that structurally cannot move. This is
  actually the best possible starting position: no version has ever been
  ambiguous, so the lineage is clean the day we unpin it.
- The **meta-schema itself is separately versioned** by URN
  (`urn:backlog-mcp:schema:substrate-definition:1`, line 4). Two axes must
  never be conflated: the meta-schema version (the shape of *definitions*)
  and `definitionVersion` (the version of *one substrate's* schema).
- **Documents carry no written-under version.** Frontmatter has no
  schema-version stamp anywhere.
- The **read-never-blocks posture already exists** in two places: migration
  quarantine (`core/migrate-docs-native.ts` — malformed documents preserved
  byte-for-byte as visible quarantined documents, Goga's own `bb51bf4`) and
  the ADR 0117 watcher discipline (diagnose after write, never mutate
  source). Evolution extends these; it invents nothing.

**Goga's claim, affirmed and sharpened:** versioning first, then diagnostics
and migration are easy — mutate schemas without version identity and the
lineage is unrecoverable. Agreed, with the sharpening that makes it
executable: *definition versioning alone is not sufficient.* A version number
on today's definition tells you nothing about a three-month-old document
unless (a) the old definition is still **addressable** and (b) the document
**names the version that wrote it**. Migration is a function; without named
domain and codomain it degrades into archaeology-plus-guessing. Git history
alone is not addressability: the global home is not a git repo (verified —
plain files), clones can be shallow, and "the schema as of commit X" is an
excavation, not an address.

## Decision — five rulings

**R1 — `definitionVersion` becomes a monotonic integer; breaking changes
bump it.** Unpin the literal (`z.literal(1)` → positive integer). Breaking =
anything that can make a previously-valid document invalid or reinterpret
its meaning: field rename/removal, enum narrowing, cardinality change,
required-field addition, workflow transition removal. Additive-optional
changes are non-breaking and do not bump. The bump rule is the discipline
the whole design hangs on, so the structural suite gets a class for it
(R5).

**R2 — A bump freezes the outgoing definition into addressable history.**
At bump time, the prior definition is written verbatim to
`docs/substrates/history/<type>@<version>.json` — immutable, committed,
greppable, docs-native, present even in non-git homes and shallow clones.
A declaration whose `definitionVersion > 1` without a complete frozen chain
`@1..@(N-1)` is a loud registry diagnostic (not a load failure). History
files are dead weight only in the way ADRs are dead weight: they are the
lineage.

**R3 — Documents stamp the version that wrote them.** Writes under
`definitionVersion: N > 1` add `schema_version: N` to frontmatter; absence
means 1 (today's entire corpus stays byte-identical — zero retroactive
noise). The stamp is written by the engine at write time, never required of
authors, never trusted blindly: it is a claim checked against R2's history.

**R4 — Reads never block; writes are always canonical.** The read path per
document: validate against today's canonical schema → on failure, validate
against the stamped version's frozen definition → report one of three honest
states: `canonical` (silent, the normal case), `aged` (valid under vN,
fails canonical — readable, searchable, disclosed with diagnostics naming
the exact violations), `quarantined` (valid under nothing declared —
existing quarantine posture, byte-preserved). **No automatic migration,
ever.** Migration is a deliberate verb (`backlog migrate substrate <type>
--from N --to M`, dry-run first, 0117's consent discipline), and rename/enum
maps are declared as data in the new definition where mechanical — so the
easy 90% of migrations really is "a piece of cake" *because* both endpoints
are named, and the hard 10% goes through an agent with human consent
instead of silent rewriting. `aged` is a legitimate permanent state: data
ages gracefully; synchronized upgrades are never required.

**R5 — Evidence before build (0121 discipline).** The structural suite
gains an evolution class: bump-without-freeze detected; stamp/history
mismatch detected; an `aged` document remains readable, searchable, and
byte-identical through a full session; dry-run migration on a fixture
corpus is idempotent and reversible where maps declare it. Branch-divergent
definitions (two branches, two versions of one substrate) get a named test
riding W2's canonical-read plumbing — the worktree briefing's divergence
stub already covers law-shaped docs; substrate declarations are law-shaped
and join that class when this ships.

## What we refuse

- **Automatic/background migration** — the store never rewrites documents it
  did not just author (PROMPT 0011's "I have not modified it" is a promise).
- **Version inference by shape-sniffing** — a document's version is its stamp
  checked against history, never a guess from which schema happens to fit.
- **Synchronized upgrades** — no operation may require the whole corpus to
  be current-version. `aged` is not an error backlog; it is history.
- **Conflating the two axes** — the meta-schema URN evolves independently
  and much more rarely; a meta-schema bump is its own future ADR.

## Consequences

- Zero cost until the first real bump: every existing declaration is v1,
  every existing document is implicitly v1, nothing changes on disk.
- The first field rename in any substrate becomes the proving ground: bump,
  freeze, stamp, rename-map, dry-run — the whole lifecycle exercised once
  on real data before the pattern is trusted (Tenet 11: earned, not
  assumed).
- Diagnostics surface through existing seams: registry diagnostics, watcher
  output (0117), and the Desk's HEALTH class (aged/quarantined counts are
  exactly its shape).

## Build shape (on GO)

Slice A: unpin + freeze-on-bump + registry diagnostics + suite class.
Slice B: write-stamp + three-state read path.
Slice C: migrate verb with declared maps, dry-run first.
Each slice independently shippable; nothing here touches ranking.
