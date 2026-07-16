---
title: "The Amnesia Test: Cold-Open and Compaction Recovery Are the Same Capability"
date: 2026-07-16
status: Accepted (goga, 2026-07-16)
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

## Proof that it needs to exist

**1. Harness amnesia is a law of the environment, not an edge case.** Codex
auto-compacts at 250K tokens; Claude compacts within a 1M window. Any agent that
works long enough WILL be wiped — the only variables are when and how much is
lost. Tonight, **six of the nine fleet agents were compacted or context-cleared
within a single working day** (granite twice — one deliberate self-compact, one
harness compact; quartz mid-turn at the night's most critical gate; pyrite,
agate, shale, chert once each). A product that stores agent memory but has no
answer for the moment the agent's mind is actually erased is solving the easy
half of its own problem statement.

**2. The user already named the pain, verbatim.** The aime prompt archive
(PROMPT 0001, 2026-07-16): *"agents continue working and working, and then
forget what is aime cli, what was north star vision, who are all these fleet
agents and stuff like that, because they go through compactions and forget who
they are what they are doing everything, including you."* This proposal is that
prompt answered on the store side; aime's ADR 0032 is it answered on the
trigger side. Both halves exist tonight — only the store half is unproductized.

**3. The pressure already forced the solution into existence — three times, by
hand.** Tenet 9 says build under pressure, never for a theory. The pressure
test is passed in the strongest possible way: the operation anchor was
hand-invented tonight (a memory file for granite, a re-anchor message for
quartz, a brief file for pyrite) because nothing else worked, and all three
recoveries succeeded — including quartz closing the two-key Phase D gate
*while amnesiac*. Promoting a thrice-hand-rolled artifact into a substrate is
the opposite of speculation; it is the definition of extracting a pattern.

**4. Harness summaries drift; deliberate anchors don't.** Concrete incident:
granite's harness-generated compaction summary stated a ruling as "Goga picks
before build" for the context-lifecycle thread. Goga's verbatim prompt on disk
said the opposite — *"delegate the engineering."* The disk anchor corrected the
summary, and the build proceeded without stalling on a phantom approval. A
compaction summary is a lossy, unaudited paraphrase produced at the worst
possible moment; an operation document is curated state written calmly, under
version control, in advance. Tonight produced a measured instance of the
former being wrong and the latter fixing it.

**5. Nobody else tests for this.** The verified idea-garden survey shows the
field building memory *consultation* — Letta's MemFS and sleep-time
consolidation, Mem0's session-start rubric, claude-mem's search-first indexes.
None of them state, let alone test, "your agent survives its own harness." The
lane is empty, and we are already standing in it with evidence.

## Impact if adopted

- **Compaction flips from a loss event into a rhythm.** Tonight quartz ran to
  86% context mid-gate — degraded, risky, and rescued only by a hand-sent
  anchor. With recovery guaranteed by the store, the optimal strategy inverts:
  compact *early and often* (our own doctrine says ~50%), keep every context
  fresh, and pay ~600 budgeted tokens to re-orient instead of dragging hundreds
  of thousands of degraded tokens forward. Continuity stops being the reason to
  fear compaction and becomes the reason to schedule it.
- **Fleets become durable beyond a session.** Tonight's single point of failure
  was the orchestrator's hand-rolled anchor. With operation documents as
  substrate entities, any orchestrator — or its replacement — recovers from the
  store. That is the difference between a fleet that survives an evening and a
  fleet that survives a month; long-horizon multi-day operations are only
  possible on the far side of this.
- **It feeds aime ADR 0032 cleanly.** The daemon (trigger half) detects
  compaction and needs content to re-prime with. Today that content is ad-hoc
  files in a scratchpad. With this proposal it is a `wakeup(operation=...)`
  call — store-owned, budget-bounded, provenance-bearing. Two projects, one
  seam, zero coupling.
- **The demo writes itself.** Kill an agent mid-task. Restart it. One `wakeup`
  call, and it states its goal, its next action, and its constraints, then
  continues the work. No surveyed competitor can run that demo. It is the
  memory-you-can-see differentiator extended to identity-you-can-restore.

## Falsifiability

Evidence that would kill or shrink this proposal: harness compaction summaries
becoming lossless, structured, and auditable (removes claim 4); context windows
becoming large and cheap enough that long-horizon agents stop compacting at all
(removes claim 1); operation documents rotting unmaintained in practice — if
agents won't keep them current, the briefing lies. The mitigation for the last
is already product law: provenance stubs (ADR 0115) make staleness visible
(`age_days` on the operation doc), and the write discipline is
write-on-state-change, which tonight's orchestrator sustained by hand across an
entire operation without missing a gate.

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
