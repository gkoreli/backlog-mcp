---
title: "Nisli Bolt-On Trial: Cold-Open Needs Bootstrap Pointers"
date: 2026-07-16
status: Proposed
author: agate
relates_to:
  - ../NORTH-STAR.md
  - 0000-phase-two-proposal-template.md
---

# Nisli bolt-on trial: cold-open needs bootstrap pointers

## The experiment

### Protocol and untouched corpus

I ran released `backlog-mcp@0.62.0` against a clean Nisli worktree with no
backlog-mcp configuration, substrate definitions, identity file, or migration.
Before the first command, `docs/` contained 59 Markdown files:

| Corpus slice | Files |
| --- | ---: |
| `docs/adr/` | 33 |
| `docs/issues/` | 21 |
| `docs/worklists/` | 5 |

The corpus is unusually good cold-open material. A read-only stranger pass found
the five requested answers in the root `README.md`, root `AGENTS.md`,
`package.json`, `docs/issues/README.md`, and current ADRs. The issue ledger alone
names six unresolved implementation issues and distinguishes them from fourteen
resolved or wont-fix records.

At `2026-07-17T04:47:52Z`, I ran:

```sh
npx --yes backlog-mcp@0.62.0 --json \
  --home project --project-root "$PWD" wakeup
```

The call took 4.33 seconds. It indexed all 59 documents, but returned:

- zero active tasks or epics;
- zero decisions, knowledge, constraints, completions, or activity;
- no identity; and
- zero unfiled entities.

The first wakeup therefore scored **0/10** against the five-question stranger
rubric (0/1/2 each):

| Stranger needs | Ground-truth source | First wakeup |
| --- | --- | ---: |
| What is Nisli? | root `README.md` | 0/2 |
| What decisions shape it? | `AGENTS.md` + current ADRs | 0/2 |
| What work is actually open? | `docs/issues/README.md` | 0/2 |
| What contributor constraints apply? | root `AGENTS.md` | 0/2 |
| How do I install, test, typecheck, and build? | `AGENTS.md`, `README.md`, `package.json` | 0/2 |

There was **no useful cold-open wakeup for the pre-existing repository during
the trial**. After I created an experiment task, a second wakeup took 0.64
seconds and showed that task. This was 2.1 minutes after the experiment began,
but it oriented only to state authored during the experiment, not to Nisli. A
third wakeup similarly showed the experiment requirement and activity while
all repository-orientation sections remained empty.

### Real task: find Nisli's next P0

I then used the released tool to track a bounded read-only task: identify the
strongest source for Nisli's current highest-priority engineering work.

The useful loop was:

1. create and start `TASK-0002`;
2. recall the five experiment memories before re-deriving the friction;
3. search for `highest priority current open issue P0 query` with content;
4. hydrate the result and finish the task with evidence; and
5. remember the result.

Recall returned all **5/5** logged friction memories in 0.65 seconds. Hybrid
search took 0.68 seconds, ranked `docs/issues/README.md` first, returned its full
ledger, and exposed issue 0005 plus the other three open P0 query defects. It
also returned a stale historical ADR, so the ledger's explicit status table was
load-bearing.

This is the trial's most important distinction: **retrieval worked once the
agent already knew what to ask; wakeup did not provide the pointers needed to
form those questions.** The missing capability is a cold-open disclosure layer,
not another search engine.

### Usage and friction data

At the reporting cutoff, the trial had used two tasks, one requirement, seven
durable memories (including one automatic completion memory), two recalls,
search, hydration, and repeated wakeups. No Nisli source file was changed and no
server crashed or lost data.

There is one telemetry-integrity caveat. I omitted the `BACKLOG_ACTOR_*`
environment on the `TASK-0002` command block. Operations 4–6 and memories
`MEMO-0006`/`MEMO-0007` therefore attribute Agate's actions to the process-user
fallback, `goga`. The final experiment close restored the explicit Agate actor.
Tool-call counts and outcomes remain usable; actor-level attribution for that
block does not. This was experiment operator error, not filed as a product bug.

Five product frictions were logged as they occurred:

1. first wakeup was empty despite an indexed 59-document corpus;
2. root `README.md`, `AGENTS.md`, and `package.json` were absent from discovery;
3. generic-resource frontmatter status was visible through `get` but absent
   from search stubs and status filters;
4. variadic `--tags` consumed trailing `remember` content and caused the first
   memory write to fail; and
5. the first read-only wakeup dirtied the checkout with an untracked
   `.backlog/cache/search-index.json` measuring 4,801,653 bytes.

Each is filed separately under
[`docs/reports/exp1-nisli-bolton`](../reports/exp1-nisli-bolton/README.md).

## Impact

The measured baseline is stark: **0/10 orientation and no useful existing-repo
wakeup**, even though the correct corpus was present and focused retrieval could
find its best work index in under a second.

The smallest response is a budget-bounded **bootstrap pointers** section for a
project whose ordinary wakeup sections are empty:

1. discover the root `README.md` and `AGENTS.md` alongside `docs/**`; and
2. point to those files plus existing directory indexes such as
   `docs/adr/README.md` and `docs/issues/README.md`.

These are stubs, not generated summaries. The agent hydrates only the pointer it
needs. There is no LLM, migration, rewriting, schema inference, or new tool.
Once canonical tasks, requirements, memories, identity, and decisions can fill
the normal briefing, the fallback disappears.

For Nisli, four pointers would have exposed the exact files the stranger pass
needed while staying well inside the wakeup budget. The next validation should
require a fresh agent using only `wakeup` plus hydration to score at least 8/10
in under one minute. That is an estimate until the slice is built and rerun,
not a claimed result.

The resource-status, CLI parsing, and local-cache defects should be fixed on
their own merits. They are not prerequisites for this smallest cold-open slice.

## Excitement

Yes. The demo is the product sentence made literal: point one released command
at an unchanged, mature repo and immediately see where its purpose, rules,
decisions, and live work are recorded. Today the same demo produces `{}`-shaped
silence. Turning already-indexed truth into four honest pointers is not flashy
machinery; it is the moment the docs-native adoption thesis becomes believable.

## Trunk or branch

**TRUNK.** This is the Cold-Open Test and Tenet 6, "docs-native,
zero-migration adoption," failing on their exact day-0 scenario. It also serves
Tenet 2: pointers first, hydration on demand. A fallback made of existing file
stubs preserves Invariant 8 because it neither normalizes nor edits human prose.

The other recorded defects are branches off this result. They affect trust and
ergonomics, but the bootstrap pointer is the direct path from the measured
failure to the North Star.

## Cost & falsifiability

**S/M.** The proposed slice is a small discovery extension, one conditional
wakeup section sharing the existing budget ledger, and focused unit/E2E tests.
It should stop if implementation requires summaries, heuristics, a configuration
surface, or a new substrate.

Acceptance for the rerun:

- a clean Nisli checkout stays unmodified by the corpus itself;
- first wakeup includes budgeted pointers to the root orientation files and
  existing docs indexes;
- a fresh agent using only wakeup and hydration scores at least 8/10 on the same
  five questions in under 60 seconds; and
- the fallback is absent when normal canonical sections already orient the
  agent.

Evidence that kills or shrinks the proposal:

- a second untouched repo has no conventional orientation/index files and the
  pointers do not improve its score;
- the Nisli rerun remains below 8/10 or above one minute;
- the pointers consume enough budget to displace canonical constraints or live
  work; or
- agents ignore the pointers and go directly to filesystem search, showing that
  this disclosure does not beat native exploration.
