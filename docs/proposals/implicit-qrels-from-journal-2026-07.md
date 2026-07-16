---
title: "Implicit Qrels: The Operations Journal Is a Relevance-Judgment Mine"
date: 2026-07-16
status: Proposed
author: granite (aime orchestrator), from cross-thread audit
relates_to:
  - 0116 (search & RAG uplift — judged relevance fixtures)
  - 0106.5 (semantic write attribution)
  - ../evaluation/JUDGING.md
---

# Implicit Qrels from the Operations Journal

*An orchestrator's audit finding: the evaluation program is corpus-starved while
the store's own journal records real retrieval behavior every day.*

## The observation

Tonight exposed the bind concretely: beryl ruled recall-affecting ranking work
blocked until baseline v2, which needs **real recall queries with judgments** —
and the global store turned out to be empty, so no such corpus exists. Meanwhile,
every real session against the store *generates* exactly this evidence and we
discard it: an agent issues `recall("...")` or `search("...")`, receives stubs,
and then **hydrates one of them with `backlog_get`** — a real query paired with
a real relevance signal, logged (post-0106.5) with semantic attribution in the
operations journal. A `remember` following a fruitless `recall` is a signal too
(the answer wasn't there — a miss judgment).

The field calls this implicit feedback; search teams have bootstrapped
evaluation corpora from click logs for twenty years. We own the whole pipeline
end to end and log it already. The evaluation program's scarcest resource is
lying in `state/` as JSONL.

## Proposal

1. **A read-only extraction fold** (script or CLI subcommand beside
   `search-eval.mjs`): scan the operations journal for
   query→stubs→hydration sequences within a session window, emit **candidate
   qrels** — versioned JSONL: query, corpus snapshot ref, hydrated id
   (positive candidate), shown-but-skipped ids (weak negatives), follow-up
   `remember` (miss marker).
2. **Candidates, never gold.** Implicit signals are noisy (agents hydrate for
   many reasons). Extracted pairs enter the corpus as *ungraded candidates*
   that a human or judging agent grades per `docs/evaluation/JUDGING.md`
   (builder≠judge stands; extraction is not judgment). Provenance on every
   line: which session, which agent, mined-not-judged.
3. **R1 compliance by construction**: the fold reads the journal through the
   established read surfaces; zero writes to the store; the artifact lives in
   `docs/evaluation/` like the other fixtures.
4. **First corpus is already on disk**: tonight's fleet session ran hundreds
   of real retrievals against the project home while nine agents built the
   product. Baseline v2's "≥4 real recall queries" (beryl's exit bar) is
   minable from a single evening.

## Why this is the smallest answer

The alternative paths to a recall corpus are: wait for months of organic solo
usage, or synthesize queries (which JUDGING.md rightly distrusts). Mining real
usage is one read-only script and yields queries *nobody invented* — the
strongest possible provenance for a relevance fixture.

## Non-goals

No online learning, no automatic ranking updates from implicit signals (the
fixture gate governs all ranking change — R3 untouched), no telemetry beyond
what the journal already records, no new storage.

## Falsifiability

If mined candidates grade out as mostly noise (judge rejection rate ~high), the
extraction heuristics tighten or the approach dies cheaply — one script. The
session-window and hydration-signal definitions are the tunable surface.

## Suggested owner

chert — it owns 0116, the baseline runner, and the v2 exit bar this directly
feeds; beryl grades and gates per JUDGING.md.
