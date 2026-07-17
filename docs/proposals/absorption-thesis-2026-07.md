---
title: "The Absorption Thesis — What backlog-mcp Actually Is"
date: 2026-07-17
status: Proposed (distilling PROMPT 0004; positioning + aime rulings requested)
author: granite (architect), distilling goga
relates_to:
  - ../prompts/0004-absorption-positioning-drop.md
  - ../NORTH-STAR.md
  - worktree-native-access-lattice-2026-07.md
  - moat-map-2026-07.md
  - vision-gaps-audit-2026-07.md
  - memory-flywheel-2026-07.md
---

# The Absorption Thesis

Goga's correction, distilled: *"agent memory" is the wedge, not the boundary.*
backlog-mcp absorbs adjacent concerns of agentic work — memory, context
engineering, task management, coordination, and eventually human judgment — by
bolting onto what already exists. The product is the **spine**, not a feature
category.

## Why the spine claim is already true in the architecture

The absorption mechanism is not aspiration; it is the shipped design, three
primitives deep:

1. **Substrates** — any knowledge type is a declared document type (bounded
   schema, projections, intents). Proven three times with zero product code:
   operation-state, reference/prior-art, and the packaged ADR/REQ/prompt set.
   Absorbing a domain = declaring its substrates.
2. **Homes and the lattice** — global, project, and (proposed) branch/canonical/
   agent/user-private scopes with isolation-by-default, sharing-by-grant. Where
   an absorbed domain's truth lives, and who sees it.
3. **Disclosure** — wakeup/recall/get with byte budgets, provenance, and honest
   omission. How an absorbed domain reaches an attention window without flooding
   it.

Each domain Goga names maps onto those primitives, and most are partially built:

| Absorbed domain | Status today | The absorbing move |
|---|---|---|
| Task management | The origin; 16 semantic verbs | Done — the founding substrate family |
| Memory | Read side built and measured; write side is the flywheel proposal | In progress — the current wedge |
| Context engineering | Byte budgets, progressive disclosure, orientation map, substrate-declared sections | In progress — it IS the disclosure engine |
| Storage engine (bolt-on) | Docs-native homes, lossless reads, public-standard ingestion (AGENTS.md/README today; substrate pack proposed) | In progress — moat M2 |
| Worktree/agent delegation | Lattice proposal (W1–W3), 0119 identity design | Proposed — PROMPT 0003 |
| **Human judgment & attention** | Fragments exist without a frame: collision queue, quarantine visibility, R8 review, parked-decision lists, the owner's briefing | **The unnamed branch — chartered below** |

## The human judgment & attention branch (chartered)

The insight that makes this branch trunk-shaped rather than a dashboard feature:
**the discipline we built for agent attention applies verbatim to human
attention.** Byte budgets, worst-first ordering, provenance, honest omission —
wakeup is an attention protocol, and humans need one more than agents do.

What the product already generates but does not surface as one thing: collision
candidates awaiting `distinct_from`, quarantined documents, candidate qrels
awaiting review, ADRs at `Proposed`, decisions parked on the owner, divergence
between a briefing's claims and the human's stated intent. Today these live in
N places; the human finds them by being told.

The branch's product shape, in one sentence: **a wakeup for the human** — one
budgeted, worst-first, provenance-bearing briefing of exactly what needs a
judgment call, where every verdict is durably recorded as memory (closing GAP 4's
tenet gap: *the engine asks for human judgment rarely, precisely, and remembers
the answer*). The viewer is its natural surface; the owner's briefing I wrote
today is its hand-rolled prototype; aime's ask-human queue is its field-proven
prior art.

Not yet chartered as build work — it enters through the same door as everything
else: an experiment (e.g., count and unify the currently-scattered judgment
items; measure time-to-decision before and after one unified surface).

## The aime question — two directions, one recommendation

**Direction 1: absorb aime into backlog-mcp.** Fold orchestration, observation,
and the ask-human loop into the OSS product.
- For: one codebase, one vision; the judgment branch gets aime's proven organs.
- Against: aime is private for structural reasons — it watches Goga, holds
  personal context, and its authority model (companion-not-commander) is a
  personal covenant, not a product feature. Open-sourcing the orchestration
  layer also hands the moat map's coordination insights to every competitor.

**Direction 2: backlog-mcp becomes the spine for aime's daemon.** Aime keeps its
private orchestration and observation; its store, memory, context lifecycle, and
judgment queues run on backlog-mcp.
- For: the bolt-on trial already proved aime's corpus works here (71 docs, EXP-1b);
  aime becomes the flywheel's heaviest honest customer; the private/public split
  stays clean (private *judgment*, public *substrate*); every aime need that
  generalizes becomes an OSS substrate pattern rather than private code — the
  ask-human queue generalizing into the adjudication substrate is the first
  example. And the deep convergence is already visible: aime's north star (scale
  human judgment) and this branch are the same lattice approached from opposite
  ends — aime from the human side, backlog-mcp from the store side.
- Against: two products to maintain; aime's daemon takes a dependency it must
  trust.

**Recommendation: Direction 2, pattern-absorption not code-absorption.** It is
reversible (Direction 1 stays open forever; a spine that proves itself makes
absorption *easier* later), it is dogfood-driven, and it turns aime into the
first external-shaped consumer of the product — the strongest possible forcing
function for the bolting tenet. Concrete first step when authorized: aime's
context-lifecycle state and ask-human queue declared as substrates in aime's own
`docs/`, served by backlog-mcp — zero aime-specific code in the OSS product.

## Positioning: wedge and horizon, not either/or

The correction Goga is making is real: "memory layer for agents" shrinks us into
a crowded feature category (Mem0, Letta, agentmemory) that the moat map shows we
do not want to win on their terms. But a spine claim with no wedge is
unmarketable. The resolution is standard and honest:

- **The horizon (vision statement):** *backlog-mcp is the open spine for agentic
  work — memory, context, tasks, coordination, and human judgment as declared
  data in your repo.* This belongs in NORTH-STAR and the README's vision section.
- **The wedge (entry story):** the cold-open — *point it at any repo and the
  first briefing orients an agent in under a minute for under 3 KiB.* This stays
  the demo, the benchmark, and the npm one-liner, because it is the provable
  minute-one value.
- **The category sentence** (from the moat map, now upgraded by this thesis):
  not "another memory layer" but **the runtime for agentic work artifacts** —
  the committed-markdown ecosystem's engine.

Proposed NORTH-STAR amendment (one paragraph, applied on Goga's accept): the
core sentence stays as the wedge scenario, joined by an absorption clause —
"memory is the first absorbed domain, not the definition: the same substrate,
scope, and disclosure primitives absorb context engineering, task management,
coordination state, and human judgment, each entering as declared data with a
measured experiment, never as a bolted subsystem."

## Judgment calls (Goga's)

1. **Positioning ruling**: adopt horizon/wedge/category as stated? (Then I apply
   the NORTH-STAR amendment + README vision section verbatim-reviewed by you.)
2. **The aime direction**: Direction 2 recommended — confirm, reverse, or park.
3. **The judgment branch's first experiment**: authorize the unify-the-queues
   count/measure probe (S), or hold until the flywheel and lattice land?
4. **Public naming of the horizon** (interacts with the parked NAME decision —
   a spine name carries differently than a memory-tool name; Kvali's fit is a
   taste call that just changed shape).

## Trunk verdict

TRUNK — this is not a new direction but the naming of the direction the
architecture has been walking all along: substrates absorbed tasks first, memory
second, references third; the lattice and judgment branches are absorptions four
and five. The thesis's falsifiable claim: any domain we absorb must enter as
declared data + measured experiment with zero new subsystems. The first absorbed
domain that *requires* a bespoke engine falsifies the spine claim.
