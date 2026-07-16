---
title: "The Wakeup Budget Ledger: One Budget, Allocated — Not N Sections Each Self-Bounded"
date: 2026-07-16
status: Proposed
author: granite (aime orchestrator), from cross-thread audit
relates_to:
  - ../NORTH-STAR.md
  - 0113.1 (REQ disclosure)
  - 0113 Phase C.2 (registry-declared wakeup sections)
  - amnesia-test-continuity-engine-2026-07.md
---

# The Wakeup Budget Ledger

*An orchestrator's audit finding: four threads each added a wakeup section tonight,
each individually budget-bounded, and no code owns the sum.*

## The observation

The ~600-token wakeup briefing is the product's core discipline — the Cold-Open
Test's "oriented in under a minute" depends on it. Tonight the briefing gained,
in separate threads: a **constraints** section (ADR 0113.1), a **vision pointer**
(Phase C.2), **generic registry-declared substrate sections** (Phase C.2 — any
project definition can now declare one), and soon an **operation** section (the
accepted Amnesia Test). Each is bounded *locally* (its own stub caps, its own
omitted-counts). Nothing bounds the *total*.

The failure mode is not any one section — it is composition: a project that
declares six substrates with wakeup sections, plus constraints, plus operation,
plus knowledge, produces a briefing where every section honored its own cap and
the sum still blew the budget. Progressive disclosure dies by a thousand honest
sections. This is invisible to every section owner and visible only from the
cross-thread seat — which is why it is this document.

## Proposal

1. **One ledger, owned by the wakeup fold in transport-free core.** A single
   token budget (the existing ~600 order-of-magnitude) is *allocated* across
   sections, not assumed by them. Sections declare their need; the ledger grants.
2. **Fixed priority order for allocation**, echoing what orientation needs first:
   identity/scope (fixed cost) → constraints (they outrank knowledge — beryl's
   COND ruling already says so) → operation (an amnesiac's "what was I doing"
   outranks browsing) → knowledge → recent activity → declared substrate
   sections (registry order) → vision pointer (cheap, always fits). Later
   sections get the remainder; a section that gets zero is *listed by name with
   its omitted count* — pressure, not silence (same law as unfiled counts).
3. **Registry-declared sections bid, never demand.** A project substrate's
   disclosure declaration states a *preferred* stub count; the ledger may grant
   fewer. The compiled disclosure descriptor already carries the shape — this
   adds one field and one allocator loop, not a framework.
4. **The Cold-Open and Amnesia E2E tests assert the TOTAL**, not per-section
   caps: briefing ≤ the hard tripwire (today 1200) with *all* sections present
   at maximum declared load. That converts the composition risk into a CI gate.

## Why now

Phase C.2 is mid-build — the generic section consumer is being written this
week. Retrofitting an allocator after N projects declare sections is a breaking
conversation; building the ledger into the consumer's first version is a small
one. The smallest answer is one allocation loop + one test.

## Non-goals

No per-user tuning knobs, no dynamic budget learning, no token-exact accounting
(approximate packing as 0118.1 already accepts). The ledger is a loop and an
ordering, not a subsystem.

## Falsifiability

If real projects never declare more than one or two wakeup sections, the
allocator is dormant ordering logic and its cost was one loop. If the total-load
E2E never fires, the composition risk was theoretical — the test was still the
cheapest possible insurance on the product's core promise.

## Suggested owner

onyx — it owns the C.2 section consumer and both E2E scenarios; the ledger is
the natural third act of that thread (after amnesia substrate).
