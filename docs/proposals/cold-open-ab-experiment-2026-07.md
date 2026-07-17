---
title: "EXP-2 — Cold-Open A/B on an Unfamiliar Repo: the Released Tool Loses to Raw Files, and Exactly Why"
date: 2026-07-16
status: Proposed
author: onyx
relates_to:
  - ../NORTH-STAR.md
  - amnesia-test-continuity-engine-2026-07.md
---

# EXP-2 — Cold-Open A/B (erent), quantified

## The experiment

**Design.** Same unfamiliar repo (`~/Documents/goga/erent` — approved via
ask-human q-20260716-214623-46, granite's four containment conditions applied
and evidenced below), same five orientation questions (what is this / key
decisions / active work / constraints / how do I run it), two arms, two fresh
subagent runs per arm, blind grading:

- **Arm A (tool-only)**: released CLI (`dist/cli/index.mjs`, v0.62-line,
  docs-native) — wakeup first, then search/get/recall/list; ≤8 calls; **no
  direct file reads**.
- **Arm B (raw-only)**: file exploration only; no backlog tooling.
- **Grading**: a fifth subagent built its own answer key from the repo
  (including `git log` ground truth for "most recent work") and graded the
  four answer sets **anonymized and shuffled**, 0–2 per question.

**Results.**

| run | arm | correctness /10 | tokens | wall-clock | calls |
|---|---|---|---|---|---|
| A1 | tool-only | 8 | 39,516 | 89.9s | 8 |
| A2 | tool-only | 8 | 40,795 | 84.4s | 8 |
| B1 | raw files | **10** | 22,103 | 43.6s | 9 reads |
| B2 | raw files | **10** | 23,438 | 53.1s | 4 reads |

**Raw files won on every axis: +2 points correctness at ~57% of the tokens
and ~55% of the wall-clock.** Both arms aced Q1/Q2/Q4 (identity,
architecture, constraints — erent's docs corpus is excellent and both arms
reached it). The whole gap is two specific mechanisms:

1. **Q3 staleness (both A runs: 1/2).** The tool sees only the docs corpus;
   erent's most recent truth (the 2026-07-15 Resend release + subsequent UI
   commits) lives in `git log`. Both A runs confidently reported a 07-11
   prompt as "most recent" and called already-shipped work "in flight." The
   briefing has no temporal source but document frontmatter.
2. **Q5 gaps (both A runs: 1/2).** `pnpm dev` and ports live in README/
   AGENTS.md — which are NOT part of the claimed corpus, so tool-only agents
   could not surface them in budget.

**Friction log (first-class results, deduplicated across A runs):**
- **The empty-wakeup problem**: wakeup reported all-zero counts +
  `identity: absent` on a repo with 20+ rich, indexed documents — "a
  knowledge-rich repo looks empty at wakeup." (The released build predates
  Phase C.2's decisions/vision sections; erent also names its vision doc
  `NORTH_STAR.md` — underscore — which even the C.2 vision pointer's
  `NORTH-STAR.md` convention would miss.)
- `get` on a 30KB ADR blows the output cap into a side file + extra read; no
  section-level get.
- The resource namespace (`adr/`, `product/`, `runbooks/`…) is
  undiscoverable — `list` shows only claimed PROMPT items.
- `recall` returns empty (no memories yet) with no hint that search is the
  right fallback; id formats are inconsistent (`mcp://` URIs vs `PROMPT
  0003`).
- Positive: the migration gate correctly ignores virgin repos — true
  zero-setup bolt-on held.

**Containment evidence** (granite's conditions): erent `git status` clean
before and after, HEAD unchanged (`478b134`), `git diff HEAD` empty, tool
writes confined to `.backlog/` which was removed after the runs.

## Impact

The measured value of the *released* tool as sole orientation on a
docs-disciplined repo is **negative**: −2 correctness at +76% tokens. That is
the honest baseline, and it localizes the missing value precisely — three
buildable gaps, each with a number attached:

1. **Temporal grounding** (fixes Q3, worth +1/run here): the briefing needs a
   git-derived recency signal (or op-journal once writes exist) — "recent"
   must mean the repo's truth, not frontmatter dates.
2. **Root-doc ingestion** (fixes Q5, worth +1/run here): README/AGENTS.md are
   the highest-density orientation documents in every real repo and are
   invisible to the corpus. The Cold-Open scenario's "how do I run it" lives
   there.
3. **The empty-wakeup fix** (kills the worst first impression): when claimed
   sections are empty but the resource corpus is rich, the briefing should
   say so and point at it — count what exists, never render a rich repo as
   nothing.

Also directly informative for EXP-1's bolt-on thesis: adoption cost truly was
zero (no migration, no config), and containment held (Invariant 8 survived an
adversarial-ish trial).

## Excitement

Would Goga demo this result? Not this one — this is the measurement that
makes the *next* demo honest. The exciting part is its precision: we now know
the briefing loses to `cat AGENTS.md` on exactly two questions and why, and
that the fix list is short, concrete, and testable by rerunning this same
A/B. A repeat run post-C.2 (decisions/vision sections) plus temporal
grounding plus root-doc ingestion is the demo: same repo, same questions,
tool wins or the thesis shrinks.

## Trunk or branch

**TRUNK.** This is the Cold-Open scenario itself, measured — the north star's
first acceptance test run against reality instead of a fixture. The gaps it
found (temporal grounding, root-doc ingestion, empty-wakeup honesty) are all
on the critical path of "agent oriented in a minute from the committed
folder."

## Cost & falsifiability

- **Cost of the fixes**: temporal grounding S–M; root-doc ingestion S;
  empty-wakeup honesty S. Rerun of this experiment: S (fully scripted via
  subagents; ~170k subagent tokens total).
- **What kills the conclusions**: (a) rerunning with a post-C.2 build +
  fixes and seeing no correctness gain — the orientation-value thesis
  shrinks to repos with backlog-shaped artifacts only; (b) the same A/B on a
  repo with a *thin* docs folder (no AGENTS.md) showing raw files winning
  anyway — the tool's premise (docs ARE the memory) fails on the corpora
  that need it most; (c) N=2/arm is small — a flipped result at N=5 voids
  the specific numbers (the friction findings stand regardless).
- **Limits stated**: Arm A was tool-ONLY (purer, but real usage is
  tool+files, so this measures the briefing's standalone value, not the
  tool's marginal value — the marginal-value A/B is the natural follow-up);
  the released build predates C.2; B runs saw the `.backlog/` dir name in
  git status (concurrency artifact; read nothing from it).
