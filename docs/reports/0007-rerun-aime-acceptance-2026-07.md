---
title: "Aime acceptance rerun — wakeup first impression (EXP-1b bar)"
date: 2026-07-17
status: Recorded
author: fable (acceptance rerun runner)
type: acceptance-rerun
tool: "backlog-mcp 0.63.0 (main, local dist)"
corpus: "~/Documents/goga/aime @ 17bf5e3 (live production repo, read-only)"
relates_to:
  - ../proposals/wakeup-first-impression-2026-07.md
  - ../proposals/aime-bolt-on-trial-2026-07.md
  - 0002-exp1-aime-bolt-on-bugs.md
  - 0004-wakeup-first-impression-slice-b-staging.md
---

# Aime acceptance rerun — wakeup first impression

## Verdict

**FAIL on the grade component; the other three bar components pass.** Charter
acceptance item 2 (Aime EXP-1b) is not yet met:

| Bar component | Result |
| --- | --- |
| First-briefing grade >= 4/5 | **FAIL — 3.0/5** (up from 1.0/5 on 0.62.0, still under the bar) |
| Newest applicable decisions beat oldest-ID fallback | **PASS** — ADR 0032, 0009, 0027 disclosed, in git-recency order; the 0.62.0 oldest-ID picks (0001/0004/0006/0007/0008) are gone |
| Malformed REQ readable and visibly quarantined | **PASS** — REQ-0004 named in `metadata.quarantined`, hydrates losslessly with a labeled `frontmatterError` |
| First read leaves Git clean | **PASS** — `git status --porcelain` empty before and after; byte-identical |

The staging replay's two predictions (report 0004) both held live: git-recency
ordering surfaces the current decision set, and the five malformed documents
(ADR 0002/0003/0005/0023 + REQ-0004) surface as visible quarantines.

The whole shortfall concentrates where the charter chose to defer. The
independent grader scored active/blocked work 0 because the briefing's empty
work arrays still contradict four live Investigating issue documents (two P0)
— the recorded active-work boundary ("do not invent a generic issue
heuristic"). With Q3 structurally at 0, reaching 4/5 requires perfect scores
on all four remaining questions; the grader gave two half-credits (decisions
depth, run-guidance indirection), landing at 3.0. The mechanical fixes all
held; the bar now hinges on the deferred active-work decision, not on the
shipped slices regressing.

## Protocol

Same shape as the original EXP-1b trial (`aime-bolt-on-trial-2026-07.md`),
rerun against the live Aime repo, read-only:

- Tool: local main build `packages/server/dist/cli/index.mjs`, version **0.63.0**
  (`--home project --project-root ~/Documents/goga/aime`).
- Corpus: Aime @ `17bf5e3` — 74 indexed documents (71 Markdown files under
  `docs/` plus root `README.md`/`AGENTS.md`/`CLAUDE.md`). Drift since the
  original trial's `538ecae`: exactly one docs-touching commit.
- Store state at start: `.backlog/` contained only an **empty** `cache/`
  directory (no index, no journal, no memories), so the first wakeup was a
  genuine cold index build.
- Grading: an independent read-only subagent received only the verbatim
  briefing JSON, then inspected the corpus for what evidence was available —
  the original grader's protocol, with the original 0.62.0 grading table given
  as the severity calibration.
- The `remember` write test (B-4) ran only against a throwaway copy of four
  Aime docs in a scratch directory; no write intent ever touched the real repo.

## Timings and payload

| Measurement | Rerun (0.63.0) | Original (0.62.0) |
| --- | ---: | ---: |
| Cold wakeup (index build included) | **4.05 s** | 4.42 s |
| Warm wakeup | **0.35 s** | 0.87 s |
| Cold wakeup payload (pretty UTF-8, CLI `--json`) | **2,607 bytes** | n/a |
| Warm recall, live store (0 memories -> honest empty) | 0.35 s | 0.76 s (hit) |
| Recall in throwaway store after `remember` (exact hit) | 0.27 s | — |

The 2,607-byte live payload sits under the 3,072-byte Slice C gate. The gate
itself passes at the real MCP boundary: `wakeup-wire-budget.test.ts` 3/3, with
the broadest (pressure) fixture measured at 3,034 pretty bytes (~758 tokens).
Warm and cold briefings are byte-identical (2,607 bytes; semantically identical
ignoring `generated_at`).

## Grade — first briefing, five stranger questions

Independent grader verdict (calibrated against the original 1.0/5 table):

| Stranger question | Rerun | Original | Evidence-based reason (grader's words, condensed) |
| --- | ---: | ---: | --- |
| What is this? | **1.0** | 0 | Three role-labeled pointers each resolve identity one `get` away; `README.md` (role "readme") delivers "The companion that watches how I work... AI + me"; the vision pointer carries the "me, uploaded" meaning the original grader found missing. |
| Key decisions? | **0.5** | 0.5 | Current work now surfaces — ADR-0027 (the accepted execution plan whose absence the original faulted) and latest ADR-0032, honestly bounded by `sections_omitted.decisions: 28` — but 28 of 31 parseable decisions stay hidden with no ADR-index pointer in orientation to reach them. |
| Active or blocked work? | **0.0** | 0 | All work arrays empty, contradicting ISSUE-0015..0018 (all Investigating; 0017/0018 P0) and recent completions; same failure the original was penalized for, and no issues pointer is offered. |
| Constraints? | **1.0** | 0.5 | REQ-0001..0003 surfaced honestly (intake/unchecked); previously silently-dropped REQ-0004 now explicitly named under `metadata.quarantined` (frontmatter genuinely unparseable); incompleteness honestly visible with the requirements-index pointer. |
| How do I run it? | **0.5** | 0 | No install/run/test text in the briefing body, but readme + agents pointers reach it one `get` away (`aime watch`/`aime status`; `bun link`, `bun test`); reachable via role-labeled docs but not surfaced directly. |
| **Total** | **3.0/5** | **1.0/5** | Bar: 4/5 — **not met**. |

The grader's net: orientation pointer stubs earn real credit on identity and
make run guidance reachable; the quarantine diagnostic converts REQ-0004's
silent loss into honest, visible incompleteness. The unchanged failure is Q3 —
empty work arrays flatly contradict four live Investigating issues, with no
pointer to the issues corpus. (Aime has no `docs/issues/README.md`, so no
index pointer was available for orientation to offer under current rules.)

## Recency ordering — prediction vs live

Staging replay (report 0004) predicted the git-recency map would disclose
**ADR 0032, 0009, 0027, 0031, 0030** (in that order). Live wakeup disclosed:

| Position | Live disclosure | Status | Staging prediction |
| ---: | --- | --- | --- |
| 1 | ADR 0032 — Context lifecycle management | proposed | ADR 0032 |
| 2 | ADR 0009 — Outbound comms through the daemon | accepted | ADR 0009 |
| 3 | ADR 0027 — Post-exploration execution plan | accepted | ADR 0027 |

The live briefing discloses three decision stubs (Slice C budget) with
`sections_omitted.decisions: 28`; 3 + 28 = 31 matches the 35 readable ADRs
minus 4 quarantined. The top three match the staging prediction exactly, in
order; predicted #4/#5 (0031, 0030) are the next ranks under the same
comparator and fell below the disclosure cap. ADR-0027 — the current accepted
execution plan whose absence anchored bug B-2 — is present.

Git corroboration (last-commit dates, read-only `git log`): disclosed
0032/0009/0027 and next-rank 0031/0030 were all last committed **2026-07-16**;
the 0.62.0 oldest-ID picks date to 2026-07-09 (0001, 0004) and 2026-07-10
(0006, 0007). None of the oldest-ID picks appear in the rerun briefing.

## Quarantine — prediction vs live, and hydration

`metadata.quarantined` lists **5** entries — exactly the staging prediction:

| Quarantined document | Type shown | Hydration via search-returned ID |
| --- | --- | --- |
| `adr/0002-herdr-substrate-and-aime-topology.md` | adr | lossless, 9,993 chars |
| `adr/0003-cli-parser-commander.md` | adr | lossless, 8,026 chars |
| `adr/0005-paste-strand-submit.md` | adr | lossless, 13,576 chars |
| `adr/0023-herdr-plugin-ecosystem-inspiration-surface-only.md` | adr | lossless, 190,775 chars |
| `requirements/REQ-0004-being-aime-one-mind.md` | requirement | lossless, 4,935 chars |

- Every document is a top search hit as a `resource` with an
  `mcp://backlog/docs/...` ID, and `get` on that same ID returns content that
  byte-matches the source file (B-3's `content: null` is gone).
- REQ-0004's `get` result carries a labeled diagnostic:
  `frontmatterError: "incomplete explicit mapping pair; ... at line 3, column 90"`
  — the real YAML defect in its human-authored frontmatter.
- `list --type requirement` still returns only REQ-0001..0003: the malformed
  file is **not** coerced into a requirement and is never rewritten. The
  briefing no longer implies complete constraints: the requirement-typed
  quarantine entry sits beside the three disclosed constraints, so
  incompleteness is visible in the same payload (`constraints_omitted: 0`
  counts only budget omissions of compiled constraints).

## Orientation pointers

`orientation.docs` in the briefing, all hydrated losslessly by path ID:

| Pointer | Role | Hydrates |
| --- | --- | --- |
| `README.md` — "Aime" | readme | 779 chars; identity ("The companion that watches how I work...") and Quick Start run commands |
| `AGENTS.md` — "Aime" | agents | 14,088 chars (symlink to `CLAUDE.md` resolved); contributor rules |
| `docs/requirements/README.md` — "Requirements — the intake" | index | 1,747 chars |
| `docs/NORTH-STAR.md` — "Aime — North Star" (vision) | vision | 26,581 chars |

`docs/adr/README.md` and `docs/issues/README.md` do not exist in Aime, so
their absence from the pointer line is correct, not an omission.

## Git-clean proof (B-1)

```text
git status --porcelain   (before first read)  -> empty
git status --porcelain   (after first read)   -> empty; diff: IDENTICAL
git status --porcelain   (after all reads)    -> empty
HEAD unchanged: 17bf5e3f6c3a1d28f7c4f33cd96b903911748def
```

The first read created `.backlog/.gitignore` (tool-owned, 43 bytes:
`.gitignore` / `config.local.json` / `cache/` / `state/`) and a
7,271,672-byte `cache/search-index.json`; `git check-ignore` confirms the
cache is covered by the tool-owned ignore. The 0.62.0 trial's `?? .backlog/`
dirty state (B-1) is gone. No `docs/memories/` was created in the real repo.

## B-4 — remember journaling (throwaway store only)

Two successful CLI `remember` calls and one failed call (missing content,
exit 1) against a scratch copy of four Aime docs produced exactly two journal
rows in `.backlog/state/operations.jsonl` — one per successful intent, none
for the failure, no double-count from internal entity creation:

```json
{"ts":"2026-07-17T20:56:27.586Z","tool":"backlog remember","mutation":"create","params":{"title":"B4 daemon socket fact","layer":"semantic"},"result":{"id":"MEMO-0001"},"resourceId":"MEMO-0001","actor":{"type":"user","name":"goga"}}
{"ts":"2026-07-17T20:56:27.815Z","tool":"backlog remember","mutation":"create","params":{"title":"B4 second fact","layer":"semantic"},"result":{"id":"MEMO-0002"},"resourceId":"MEMO-0002","actor":{"type":"user","name":"goga"}}
```

The MCP path is covered by the dedicated regression
`src/__tests__/remember-journal.test.ts` ("one successful MCP remember ->
exactly one actor-attributed row with the MEMO id"; "a failed remember adds
no row") — 2/2 passing on this build. A follow-up recall in the throwaway
store returned the remembered fact as an exact hit in 0.27 s.

Friction note (not a defect): CLI `remember` now requires `--title`; the
original trial's title-less invocation shape fails fast with a clear error
and journals nothing.

## Residual honesty notes

- **Active work is still empty — and it is now the binding constraint.**
  `now.active_tasks`/`current_epics` are `[]` while ISSUE-0015..0018
  (Investigating, two P0) exist in the corpus. The charter deliberately
  deferred issue-substrate inference; under the original rubric that deferral
  costs a full point, which mathematically caps the grade at 4/5 and, combined
  with two half-credits, produces the 3.0. Passing this bar requires either a
  decision on active-work orientation (recognized/declared substrate, an
  issues-index pointer, or claim-narrowing per the original trial's own
  recommendation) or an explicit charter amendment to the bar.
- The briefing discloses 3 decision stubs, not the staging replay's 5 — a
  Slice C budget consequence, with the omitted count stated honestly.
- Rerun ran on the live corpus (`17bf5e3`), 3 files richer than the frozen
  original (`538ecae`); one docs-touching commit of drift.

## Full cold-wakeup transcript (verbatim)

```json
{
  "now": {
    "active_tasks": [],
    "current_epics": []
  },
  "knowledge": [],
  "constraints": [
    {
      "id": "REQ-0001",
      "title": "Fleet identity boots from the system prompt, not a manual whoami inject",
      "status": "intake",
      "compliance": "unchecked",
      "domain": "fleet"
    },
    {
      "id": "REQ-0002",
      "title": "herdr is Aime's private substrate — agents live in an aime-only world, never told \"herdr\"",
      "status": "intake",
      "compliance": "unchecked",
      "domain": "fleet"
    },
    {
      "id": "REQ-0003",
      "title": "Project-scoped fleet lifecycle — aime launches, repairs, and manages agent sessions",
      "status": "intake",
      "compliance": "unchecked",
      "domain": "fleet"
    }
  ],
  "sections": {
    "decisions": [
      {
        "id": "ADR 0032",
        "title": "Context lifecycle management — observe, compact, re-prime, and clear",
        "status": "proposed"
      },
      {
        "id": "ADR 0009",
        "title": "Outbound comms through the daemon — the PTY write arbiter (collision avoidance)",
        "status": "accepted"
      },
      {
        "id": "ADR 0027",
        "title": "Post-exploration execution plan — the mined work from ADR-0023/0024, sequenced for build",
        "status": "accepted"
      }
    ]
  },
  "vision": {
    "path": "docs/NORTH-STAR.md",
    "title": "Aime — North Star"
  },
  "orientation": {
    "docs": [
      {
        "path": "README.md",
        "role": "readme",
        "title": "Aime"
      },
      {
        "path": "AGENTS.md",
        "role": "agents",
        "title": "Aime"
      },
      {
        "path": "docs/requirements/README.md",
        "role": "index",
        "title": "Requirements — the intake"
      }
    ],
    "indexed_documents": 74
  },
  "recent": {
    "completions": [],
    "activity": []
  },
  "metadata": {
    "generated_at": "2026-07-17T20:51:53.626Z",
    "constraints_omitted": 0,
    "sections_omitted": {
      "decisions": 28
    },
    "quarantined": [
      {
        "type": "adr",
        "path": "adr/0002-herdr-substrate-and-aime-topology.md"
      },
      {
        "type": "adr",
        "path": "adr/0003-cli-parser-commander.md"
      },
      {
        "type": "adr",
        "path": "adr/0005-paste-strand-submit.md"
      },
      {
        "type": "adr",
        "path": "adr/0023-herdr-plugin-ecosystem-inspiration-surface-only.md"
      },
      {
        "type": "requirement",
        "path": "requirements/REQ-0004-being-aime-one-mind.md"
      }
    ],
    "unfiled_count": 0
  }
}
```
