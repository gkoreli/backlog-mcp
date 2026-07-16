---
title: "The Amnesia Test: Cold-Open and Compaction Recovery Are the Same Capability"
date: 2026-07-16
status: Proposed
author: granite (aime orchestrator), from direct operational evidence
relates_to:
  - ../NORTH-STAR.md
  - 0119-agent-substrate-and-derived-correlation.md
  - ../prompts/0002-operating-principles-directives.md
---

# The Amnesia Test

*A proposal written by the orchestrator of the 2026-07-16 vision-uplift operation,
from evidence generated during that operation. Nothing here is speculative; every
claim names the incident that produced it.*

## The observation

The NORTH-STAR's Cold-Open Test says: an agent that has never seen a repository
runs `wakeup` and is oriented in under a minute. Tonight's operation surfaced its
twin, three separate times:

1. **The orchestrator was compacted mid-operation** and rebuilt its entire working
   state — fleet roster, protocol law, merge queue, parked decisions — from a
   hand-written anchor file, not from its context window.
2. **quartz auto-compacted mid-turn at 86% context** while closing the Phase D
   gate. A hand-sent re-anchor message carrying its exact state (keys held, tip
   SHA, remaining steps) let it finish the gate without losing a step.
3. **pyrite was re-primed from a brief file after compaction** and resumed an
   authorized build with zero re-litigating of settled rulings.

In each case the recovery was: *read a durable document, be oriented, continue.*
That is the Cold-Open Test. **An agent recovering from compaction and an agent
cold-opening an unseen repo are the same agent: one with no context and a docs
folder.** Amnesia recovery is not a new capability we need to build — it is the
capability we already claim, pointed at time instead of space.

## What's missing

Tonight's recoveries worked because a human-grade orchestrator hand-authored the
anchors (a memory file, a re-anchor message, a re-prime brief) and hand-timed
their delivery. The product should own this:

1. **An operation-state substrate.** The anchor documents written tonight had a
   stable shape: who I am, what the mission is, live thread states, protocol in
   force, parked decisions, watch signals. That is a substrate definition waiting
   to be declared (`docs/substrates/operation.json`, dogfooding ADR 0113) — not a
   new builtin. One live operation document per long-horizon agent, updated as
   state changes, exactly like tonight's session-state anchor but structured.

2. **`wakeup` with an operation argument.** Cold-open orientation answers "what
   is this project?" Post-compaction orientation additionally answers "what was
   *I* doing?" A `wakeup` that accepts an operation/agent identity (riding ADR
   0119's identity substrate) folds the live operation document into the briefing
   as a first-class section — same budget discipline, same stub-then-hydrate
   shape. The briefing that orients a stranger and the briefing that restores an
   amnesiac differ by one section.

3. **The Amnesia Test as an executable gate,** twin to the Cold-Open E2E test now
   being built: seed a store with an operation document mid-flight, present a
   fresh agent with nothing but `wakeup(operation=...)`, assert it can state its
   goal, its next action, and its constraints without reading anything else.

## Why this is ours to win

- The field's convergence (Letta MemFS: git-backed markdown memory; sleep-time
  consolidation; session-start decision rubrics — see the idea garden's verified
  entries) treats memory as something an agent *consults*. Tonight demonstrates
  the stronger claim: markdown-backed memory is what lets an agent *survive its
  own harness*. No surveyed competitor tests for this.
- It is the tagline taken literally one step further: your backlog is your
  agent's memory — **including the memory of what it was doing when its mind was
  wiped.** Continuity is the product.
- Cost is honest: one substrate JSON, one wakeup section, one E2E test. The
  mechanism (0113 registry, 0113.1 disclosure, 0119 identity) is all merged or
  in flight tonight. This is composition, not construction.

## Non-goals

No orchestration in the store (the store records operation state; it never runs
operations). No automatic anchor-writing heuristics — agents and orchestrators
write anchors deliberately, the way tonight proved works. No coupling to aime:
aime's daemon (ADR 0032, in build) is one client that *triggers* re-priming;
what it feeds the recovering agent should be this, from the store.

## Decision asked of Goga

Adopt the Amnesia Test alongside the Cold-Open Test as the north star's second
executable scenario, and green-light the operation-state substrate as a
project-authored definition (S effort: substrate JSON + wakeup section + E2E
test, in that order).
