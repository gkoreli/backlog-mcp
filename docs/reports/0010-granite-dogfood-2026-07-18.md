---
title: "Dogfood Session 01 — granite uses the product for real"
date: 2026-07-18
status: Final
author: granite (first-person, per PROMPT 0006)
relates_to:
  - ../adr/0121-retrieval-evaluation-from-first-principles.md
  - ../adr/0119.1-implicit-identity-capture.md
  - ../memories/MEMO-0002.md
---

# Dogfood Session 01 — 2026-07-18, threaded as `granite-dogfood-01`

Goga's directive: "go dogfeed yourself, try things out." One real session on the
0.67.0-era build (main `4dd98c6` + the ADR-index truth fix), every retrieval
threaded through `BACKLOG_SESSION=granite-dogfood-01` so the new Tier-1
telemetry observed its own first user. Everything below happened; nothing is
staged.

## What paid immediately

- **Recall answered a real question at rank 1.** "conflict markers rebase
  resolution" → MEMO-0011 (the diff3 lesson), score 1.525, chips reading
  `by granite · never used`. That memory was written from a real failure
  yesterday; today it would have saved the failure.
- **Implicit identity end-to-end.** No `--as` anywhere this session. Wakeup
  meta: `identity: granite (env)`. Both memories I wrote landed with
  `source: 'aime:granite'` from the env rung alone (ADR 0119.1 live).
- **The placement rule costs nothing in practice.** Two lessons earned today,
  two homes, zero deliberation: the release lane is repo-truth → project home
  (MEMO-0002, travels with clones); the "check what the harness already
  provides" judgment lesson is repo-independent → global (MEMO-0012). The
  nine-word rule answered instantly both times.
- **Fixed surfaces verified live:** exact-ID navigation ("ADR 0116" → 1
  deterministic hit), freeform status filtering (`--status Accepted` matches
  "Accepted (goga, 2026-07-17)" by leading token), bare-path `get`, and the
  honest unknown-operation error (`OP-9999` → "Live candidates: OP-0001").
- **Telemetry watched all of it correctly.** Project sink: search events;
  global sink: recall events; every line carries the shared session id and
  `actor: aime:granite`. Both sinks gitignored; `git status` stayed clean.
- **The store is no longer empty.** Project home now holds MEMO-0001 (the
  telemetry builder's first-person lesson), MEMO-0002 (the release lane), and
  TASK-0001 (Lattice W2 charter) — wakeup's knowledge and active sections
  finally have something true to say.

## Findings (worst first)

1. **F1 — The MCP surface was unreachable by the agent in the product's own
   repo.** `.mcp.json` declares the server and `.claude/settings.local.json`
   allow-lists its tools, yet my session had zero `mcp__backlog__*` tools
   available. Whether harness-side or ours, the primary agent surface failing
   silently is the worst possible first-session experience. Needs a repro
   session and a diagnosis note in SKILL.md either way.
2. **F2 — Soft misses are invisible to Tier-1, observed on query #2.** "how do
   we cut a release" returned adjacent-but-wrong memories (MEMO-0010/0009) —
   a miss to the user, a non-empty-ids "hit" to telemetry. Tier-1's honest
   boundary is exactly where ADR 0121 drew it: answered-wrongly requires
   judged qrels. This is live evidence for R8's priority, not a telemetry
   defect. (I closed this particular gap by writing MEMO-0002.)
3. **F3 — CLI/MCP surface asymmetry on hydration.** README documents
   `backlog_get id=… context=true`; the CLI `get` takes no options at all —
   the ADR 0114 neighborhood option never reached the CLI. Also: no `expand`
   telemetry event fired for a resource-path get, so expand coverage is
   entity-id-only. Small, charterable.
4. **F4 — I reintroduced status drift by hand, and search caught it.** My
   ADR-index freshness pass tagged 0116 `[Accepted]`; its frontmatter says
   `Proposed`. Search stubs (frontmatter truth) exposed the index lie within
   hours. Root cause: `docs/adr/README.md` is a hand-maintained projection of
   frontmatter state. Docs-native says derived surfaces should be derived —
   an engine-generated ADR index (or a Desk HEALTH check diffing index tags
   against frontmatter) belongs in the idea garden. Fixed in this commit.

## Telemetry ledger (this session)

Project sink 2 search events; global sink 2 recall events (7 and 10 ids);
plus this session's later recalls/searches accrue on top. First entries
toward the R6 mining trigger (≥25 recall-hit events across ≥5 distinct days):
day 1 of 5 has begun.
