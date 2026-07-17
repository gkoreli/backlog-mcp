---
title: "Rerun: Nisli EXP-1a Acceptance — Wakeup First Impression"
date: 2026-07-17
status: Complete
author: "acceptance rerun harness (Claude), replicating agate's EXP-1a protocol"
relates_to:
  - ../proposals/wakeup-first-impression-2026-07.md
  - ../proposals/nisli-zero-setup-cold-open-2026-07.md
  - exp1-nisli-bolton/README.md
---

# Rerun: Nisli acceptance (charter harness item 1)

**VERDICT: PASS — first wakeup 10/10 (bar >=8/10); useful in ~4.9 s
end-to-end (bar <60 s); all five root/index pointers hydrate via `get`
with the catalog ID (bar met, one caveat below); no source rewrite
(zero tracked-file changes); git porcelain identical before and after
(both empty).**

The original trial (`nisli-zero-setup-cold-open-2026-07.md`, released
0.62.0) scored the first wakeup **0/10**. This rerun, against the merged
main build **0.63.0**, scores **10/10** on the same five-question rubric
with the same untouched corpus.

## Acceptance bars

| Charter bar (harness item 1) | Result | Evidence |
| --- | --- | --- |
| Clean bolt-on, no source rewrite | **PASS** | `git diff --stat HEAD` empty; all 59 corpus files byte-identical |
| First-wakeup grade >=8/10 | **PASS (10/10)** | per-criterion table below |
| Useful in under 60 seconds | **PASS (~4.9 s)** | wakeup 3.24 s + 1 search 0.34 s + 5 hydrations ~1.3 s |
| Root/index pointers hydrate | **PASS, 1 caveat** | all 5 hydrate via `get mcp://backlog/<path>` in ~0.26 s each; bare-path `get <path>` silently returns `content: null` (defect, recorded below) |
| Git stays clean (derived-state hygiene) | **PASS** | before/after porcelain both empty; tool-owned `.backlog/.gitignore` created; no human file overwritten |
| (Slice C context) payload <=3,072 pretty bytes | **PASS** | first briefing 1,214 pretty UTF-8 bytes at the CLI `--json` boundary |

## Protocol

- Target: `/Users/goga/Documents/goga/nisli` at `ece4a81`
  (`chore(release): core 0.54.1, router 0.5.1, ssg 0.4.0`), read-only on
  repo content, no backlog-mcp state present (`.backlog/` absent).
- Build: `node packages/server/dist/cli/index.mjs` from backlog-mcp main,
  `--version` = **0.63.0**.
- Command shape mirrored from the original trial:

```sh
node <backlog-mcp>/packages/server/dist/cli/index.mjs --json \
  --home project --project-root /Users/goga/Documents/goga/nisli wakeup
```

### Cold-state corpus census (identical to the original trial)

| Corpus slice | Files |
| --- | ---: |
| `docs/adr/` | 33 |
| `docs/issues/` | 21 |
| `docs/worklists/` | 5 |
| **Total `docs/**` Markdown** | **59** |

Root `README.md` (6.6 KB) and `AGENTS.md` (7.5 KB) present; nisli's
`.gitignore` does **not** mention `.backlog`. No file with a
northstar-stem name exists anywhere in the repo (checked case-insensitive
`*north*star*` to depth 2), so the absence of a vision pointer in the
briefing is **correct**, not a silent miss.

## Timing and payload

| Step | Time | Payload |
| --- | ---: | ---: |
| First wakeup (cold, index build) | **3.24 s** | **1,214 pretty UTF-8 bytes** |
| Search (to learn the resource-ID scheme) | 0.34 s | — |
| `get` each of the 5 pointers (by catalog ID) | ~0.26 s each (1.30 s total) | 1,159–15,448 bytes each |
| **Stranger pass total (tool time)** | **~4.9 s** | |
| Second wakeup (warm, 1 memory present) | 0.34 s | 1,337 bytes |

Adding the failed bare-path `get` detour (5 calls, ~1.3 s) the worst-case
pass is ~6.2 s — still 10x under the 60-second bar. The first briefing's
1,214 bytes sit at 39.5% of the 3,072-byte Slice C ceiling. (Measured at
the CLI `--json` boundary; the MCP adapter emits the same pretty-JSON
composition.)

## Grade: 10/10 (original rubric, 0/1/2 per question)

Graded on what a fresh agent gets from **wakeup + hydration only**, per
the original trial's acceptance clause ("a fresh agent using only wakeup
and hydration scores at least 8/10 on the same five questions in under
60 seconds").

| Stranger needs | Ground truth (original table) | Wakeup pointer | Hydrated evidence | Score |
| --- | --- | --- | --- | ---: |
| What is Nisli? | root `README.md` | `README.md` (role `readme`, title "nisli") | Full framework description: reactive web-component framework on browser standards; signals, typed factories, light-DOM templates, DI, routing, SSG; no virtual DOM/compiler | **2/2** |
| What decisions shape it? | `AGENTS.md` + current ADRs | `docs/adr/README.md` (role `index`) | Complete dated ADR index with per-ADR status (Proposed/Active/Accepted/Open); AGENTS.md also pointed | **2/2** |
| What work is actually open? | `docs/issues/README.md` | `docs/issues/README.md` (role `index`, title "Framework Issues") | Full ledger table distinguishing open vs resolved with priorities; open P0s 0005–0008 visible | **2/2** |
| What contributor constraints apply? | root `AGENTS.md` | `AGENTS.md` (role `agents`) | Repository shape, package layout, doc-placement rules, worktree discipline, root gates | **2/2** |
| How do I install, test, typecheck, build? | `AGENTS.md`, `README.md`, `package.json` | `AGENTS.md` + `README.md` | AGENTS.md `## Commands`: `pnpm install/build/test/typecheck`, `--filter` guidance; README install + quick start | **2/2** |

### Adversarial deductions considered (none change answerability)

1. **Bare-path `get` silently nulls.** The orientation stubs carry
   `path` but no `id`; `get README.md` returns
   `{"items":[{"id":"README.md","content":null}]}` with exit 0 and no
   error. Recovery is one natural search (any query returns
   `mcp://backlog/<path>` IDs), after which every pointer hydrates
   fully. Cost: ~1.6 s detour. This is a real defect (recorded below)
   but every rubric question remains fully answered inside the
   wakeup+hydration protocol and the time bar.
2. **`package.json` is still not indexed** (Markdown-only discovery per
   the charter's Slice A scope). Run commands are nevertheless fully
   answered by AGENTS.md/README.md, the same sources the original
   ground-truth table names first.
3. The orientation `note` sentence appears only in the cold briefing and
   drops once knowledge exists — by charter design; the pointer list
   itself persists (verified in the second wakeup).

## Pointer hydration verification

| Pointer path | Hydrating ID | `get` time | Body bytes |
| --- | --- | ---: | ---: |
| `README.md` | `mcp://backlog/README.md` | 0.27 s | 13,784 (JSON) / 6,573 content chars |
| `AGENTS.md` | `mcp://backlog/AGENTS.md` | 0.26 s | 15,448 / 7,483 |
| `docs/adr/README.md` | `mcp://backlog/docs/adr/README.md` | 0.25 s | 7,791 / 3,736 |
| `docs/issues/README.md` | `mcp://backlog/docs/issues/README.md` | 0.26 s | 5,514 / 2,593 |
| `docs/worklists/README.md` | `mcp://backlog/docs/worklists/README.md` | 0.25 s | 1,159 / 469 |

All five bodies are lossless full contents (verified against expected
headings and tables). Vision pointer correctly absent (no
northstar-stem file exists). The cold briefing explicitly refuses the
empty-project implication: `"note": "No tasks, memories, or constraints
are recorded yet, but 61 existing documents are indexed and searchable.
Open first: README.md, AGENTS.md, docs/adr/README.md."`

## Bug-by-bug retest (0.62.0 filings vs 0.63.0 build)

| Bug | Original defect | Rerun result | Verdict |
| --- | --- | --- | --- |
| BUG-0001 (P0) discovery omits root orientation docs | index had `docs/**` only; purpose/commands searches missed README/AGENTS | Root `README.md` and `AGENTS.md` are indexed resources (`mcp://backlog/README.md`, `mcp://backlog/AGENTS.md`); commands query ranks AGENTS.md #2 and README.md #4; purpose query ranks AGENTS.md #1, README.md #3. Caveat: `package.json` still not indexed (out of Markdown scope); its command intent is covered by AGENTS.md | **FIXED** |
| BUG-0002 (P0) wakeup hides indexed existing docs | 59 indexed docs, empty briefing, 0/10 | `orientation` section with 5 role-tagged pointers + `indexed_documents: 61` + explicit not-empty note; persists when tool-authored memories exist | **FIXED** |
| BUG-0003 (P1) resource status not searchable | stubs omit frontmatter status; `--status open/resolved` return zero generic resources | **Identical behavior reproduced**: exact trial query returns resolved issues 0019/0017/0016 with no `status` field in stubs; `--status open` total 0; `--status resolved` total 0; `get` still shows `status: resolved` in the same document | **NOT FIXED** |
| BUG-0004 (P1) variadic `--tags` consumes remember content | `remember --tags a b c "content"` failed with `missing required argument 'content'` | `--tags <tags>` is now non-variadic, documented "Comma-separated labels (e.g. exp-1,friction)"; the original failing invocation now succeeds (write lands, journal row emitted); `--tags rerun,acceptance,sanity` carries all three tags with content intact. Note: in the old space-separated shape, trailing bare words fold into content rather than erroring | **FIXED** |
| BUG-0005 (P1) read-only wakeup dirties checkout | untracked `.backlog/` with 4,801,653-byte cache | First wakeup creates `.backlog/.gitignore` (43 bytes: `.gitignore`, `config.local.json`, `cache/`, `state/`) so the whole directory is self-ignored; porcelain empty immediately after; cache is 5,099,255 bytes but git-invisible; nisli's own `.gitignore` and `.git/info/exclude` untouched | **FIXED** |

**Fixed: 4/5.** BUG-0003 is unchanged from the original filing and
remains open at its original P1.

## Derived-state hygiene proof

```
$ git -C /Users/goga/Documents/goga/nisli status --porcelain   # BEFORE
(empty — exit 0)

$ git -C /Users/goga/Documents/goga/nisli status --porcelain   # AFTER
(empty — exit 0)

$ git -C /Users/goga/Documents/goga/nisli diff --stat HEAD     # AFTER
(empty — zero tracked-file changes)
```

All read-path operations (2 wakeups, 12 `get`s, 6 searches, 1 recall)
left porcelain empty throughout. The only git-visible artifact at any
point was `docs/memories/` from the two **deliberate** `remember` writes
in the BUG-0004 retest — the docs-native write substrate working as
designed, not read-path dirt. Both trial-authored memory files were
removed afterwards to restore the exact BEFORE state; the ignored
`.backlog/` derived state remains, invisible to git.

## Recall/search sanity (original strength — no regression)

1. **Original P0 query** `highest priority current open issue P0 query`:
   `docs/issues/README.md` ranked **#1** (0.34 s vs the original's
   0.68 s), with open P0 issue `0005-query-logical-request-coordination.md`
   ranked #2 — strictly better than the original result.
2. **Recall** `variadic tags rerun acceptance`: 1/1 exact hit
   (MEMO-0001) in 0.34 s with digest, layer, source, and score.
3. **Commands query** `install test typecheck build commands`:
   AGENTS.md #2, README.md #4 — the sources the original trial found
   missing entirely.

## Residual defects surfaced by this rerun

1. **P2 — orientation stubs are not directly hydratable as printed.**
   Stubs expose `path` only; `get <path>` exits 0 with
   `content: null` instead of resolving or erroring. Either resolve
   bare paths to the catalog resource, include the `mcp://backlog/`
   ID in the stub, or fail loudly.
2. **P1 — BUG-0003 unchanged** (see table).
3. **Note — `remember` old space-separated tag shape** silently folds
   trailing bare words into content; consistent with the new
   non-variadic contract but worth a doc/UX glance.

## Appendix A — first wakeup transcript (verbatim, 1,214 bytes, 3.24 s)

```json
{
  "now": {
    "active_tasks": [],
    "current_epics": []
  },
  "knowledge": [],
  "constraints": [],
  "sections": {
    "decisions": []
  },
  "orientation": {
    "docs": [
      {
        "path": "README.md",
        "role": "readme",
        "title": "nisli"
      },
      {
        "path": "AGENTS.md",
        "role": "agents",
        "title": "AGENTS.md — nisli"
      },
      {
        "path": "docs/adr/README.md",
        "role": "index",
        "title": "Framework Architecture Decision Records"
      },
      {
        "path": "docs/issues/README.md",
        "role": "index",
        "title": "Framework Issues"
      },
      {
        "path": "docs/worklists/README.md",
        "role": "index",
        "title": "Worklists"
      }
    ],
    "indexed_documents": 61,
    "note": "No tasks, memories, or constraints are recorded yet, but 61 existing documents are indexed and searchable. Open first: README.md, AGENTS.md, docs/adr/README.md."
  },
  "recent": {
    "completions": [],
    "activity": []
  },
  "metadata": {
    "generated_at": "2026-07-17T20:51:20.060Z",
    "constraints_omitted": 0,
    "sections_omitted": {
      "decisions": 0
    },
    "unfiled_count": 0
  }
}
```

## Appendix B — second wakeup transcript (verbatim, 1,337 bytes, 0.34 s; one tool-authored memory present)

```json
{
  "now": {
    "active_tasks": [],
    "current_epics": []
  },
  "knowledge": [
    {
      "id": "MEMO-0001",
      "layer": "semantic",
      "title": "Rerun sanity memory",
      "age_days": 0,
      "uses": 0
    }
  ],
  "constraints": [],
  "sections": {
    "decisions": []
  },
  "orientation": {
    "docs": [
      {
        "path": "README.md",
        "role": "readme",
        "title": "nisli"
      },
      {
        "path": "AGENTS.md",
        "role": "agents",
        "title": "AGENTS.md — nisli"
      },
      {
        "path": "docs/adr/README.md",
        "role": "index",
        "title": "Framework Architecture Decision Records"
      },
      {
        "path": "docs/issues/README.md",
        "role": "index",
        "title": "Framework Issues"
      },
      {
        "path": "docs/worklists/README.md",
        "role": "index",
        "title": "Worklists"
      }
    ],
    "indexed_documents": 62
  },
  "recent": {
    "completions": [],
    "activity": [
      {
        "ts": "2026-07-17T20:54:18.196Z",
        "tool": "backlog remember",
        "actor": "goga",
        "entity_id": "MEMO-0001"
      }
    ]
  },
  "metadata": {
    "generated_at": "2026-07-17T20:54:50.746Z",
    "constraints_omitted": 0,
    "sections_omitted": {
      "decisions": 0
    },
    "unfiled_count": 0
  }
}
```

The second briefing confirms two charter clauses: the pointer line
remains available when tool-authored memories exist, and the `remember`
write journaled exactly one actor-attributed activity row with its
resource ID.
