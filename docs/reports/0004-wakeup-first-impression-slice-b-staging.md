---
title: "Wakeup First Impression — Slice B staging verdict (observed recency)"
date: 2026-07-17
status: Recorded
author: fable (wakeup-first-impression builder)
relates_to:
  - ../proposals/wakeup-first-impression-2026-07.md
  - 0002-exp1-aime-bolt-on-bugs.md
---

# Slice B staging verdict — did frontmatter chronology close it?

The charter mandates a staged answer before any git-backed recency ships:
replay the real corpora with frontmatter `updated_at` only, record the
result, and keep an injected recency map only if it changes the measured
selection. Replays ran the real wakeup fold and LocalRuntime over read-only
copies of both corpora (originals untouched).

## Aime — 39 ADRs, 38 without managed `updated_at`

| Stage | Top decisions disclosed | Verdict |
| --- | --- | --- |
| 1. frontmatter only | ADR 0001, 0004, 0006, 0007, 0008 | **Stale** — the exact B-2 reproduction (oldest IDs win the tie) |
| 2a. injected mtime map | ADR 0032, 0009, 0031, 0030, 0025 | Changed, but checkout-time noise: ADR-0027 (current accepted execution plan) still missing |
| 2b. injected git map | ADR 0032, 0009, **0027**, 0031, 0030 | **Closes** — newest applicable decisions surface; the current accepted plan is present |

Frontmatter chronology does **not** close the Aime environment; the
git-backed map changes the measured selection and surfaces the current
decision record, so the adapter earned its keep and ships:
`storage/local/git-recency.ts` (one `git log` pass, last-commit date per
docs file), injected as plain data through the grounding reader. Working
mtimes remain only the fallback for untracked files — they do not survive
a fresh clone and misordered the replay (missed ADR-0027).

The same replay also confirmed the B-3 exposure on real data: four Aime
ADRs (0002, 0003, 0005, 0023) and REQ-0004 have unparseable frontmatter
and now surface as visible quarantines instead of vanishing.

## Erent — disciplined docs, 3-digit ADR ids

Erent's ADRs (`001-…` through `016-…`) sit below the packaged ADR
substrate's 4-digit identity minimum, so they never claim as decisions —
the sections comparator has nothing to order, with or without a recency
map. Frontmatter-only vs git-injected replays are identical (empty
decisions). Erent's temporal seam is the identity grammar (ADR 0112
territory), not Slice B; its first-impression gain comes from the Slice A
orientation pointers (root `README.md`, root `NORTH_STAR.md` vision
discovery), which this workstream does deliver.

## Byte check on the real corpus

The full Aime first-impression briefing through the shipped composition
(orientation + vision + recency + quarantine) measured **2,859 pretty
bytes** before the Slice C reductions — under the 3,072-byte gate the
acceptance tests now enforce at the MCP boundary.
