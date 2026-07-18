---
title: "Compiled Process — Cross-Validating the Meta-State-Machine Against Our Own Law"
date: 2026-07-18
status: Proposed (cross-validation; one line drawn, one seam designed, one experiment chartered)
author: granite (architect)
relates_to:
  - ../prompts/0013-meta-state-machine-compiled-workflows.md
  - ../prompts/0012-seven-pressures-assessment.md
  - ../prompts/0005-judgment-uplift-tenet.md
  - ../adr/0113-user-defined-substrates.md
  - ../adr/0119-agent-substrate-and-derived-correlation.md
  - ../PRESSURE-LEDGER.md
---

# Compiled Process

Goga's idea (PROMPT 0013): substrates declare identities AND the state
machines those identities may execute — "postgres for agent identities and
workflows" — a meta-state-machine, so we compile not just agent interfaces
but entire workflows, processes, eventually the system. Cross-validated
against the vision, the tenets, and the document we absorbed three hours ago.

**Verdict up front: the kernel is vision-true and four-fifths already built.
The idea decomposes into five layers; three are shipped, one is the real new
gold with a designed seam, and one is the umbrella temptation our own
pressure-map warned against this morning. The line that keeps it all lawful:
compile interfaces, constraints, and gates — never the run-loop. The store
may know who may act, what is legal, and what is satisfied. It must never
say "go."**

## The five layers

**L1 — Substrates declare state machines. SHIPPED.** The `workflow` field
(initial/terminal/transitions) is exactly this, scoped exactly where
PROMPT 0012's diagram places it.

**L2 — Identities as substrate. SHIPPED.** ADR 0119 + the 0119.1 ladder:
agents are documents, principals are attribution, identity is data.

**L3 — Grants: which identities may execute which transitions. THE REAL NEW
GOLD.** This is the postgres analogy landing precisely: roles and grants
live in the catalog as data (`GRANT transition ON substrate TO role`), and
checking "is this transition legal for this actor" is a *validation*
question — the same class as schema validation, safely inside the store
boundary. The compiler consequence is elegant: identity (resolved by the
ladder) × intent registry = **per-agent compiled interfaces** — beryl's
session compiles `accept_adr`; a builder's compiles only `propose`. Declared
in the substrate's workflow block:

```json
"transitions": [
  { "name": "accept", "from": ["proposed"], "to": "accepted",
    "permitted": ["human:goga", "role:domain-architect"] }
]
```

Absent `permitted` = everyone (today's behavior, byte-identical; optionality
law). **Honest evidence check: the evidence column is empty.** In two days
of five-agent fleet operation, every process failure was mechanical (id
collisions, a died builder, a marker leak) — zero wrong-actor-wrong-
transition incidents. So per our own pressure-ledger discipline: the seam is
designed (above), the build waits for the first real violation. Seam cost:
one optional field in the meta-schema, reserved now under ADR 0122's
versioning so it lands as a non-breaking additive change whenever triggered.

**L4 — Process as data: the meta-state-machine. RICH, WITH A HARD LINE.**
Declaring cross-substrate process (charter → build → review → gate → land)
as a substrate is powerful for a reason hiding in plain sight: **it is the
mechanism by which Tenet 11's adaptivity clause becomes real.** The tenet
says judgment placement "is adaptable based on how deterministic, resilient
and trustworthy the process and layers get" — but you can only relocate a
judgment point that is *named*. Today our process is prose law scattered
across ADRs and memories; a declared process gives every gate an address,
and an addressed gate can accumulate evidence, and evidence is how
absorption is *earned* rather than assumed. Goga's idea is the missing
infrastructure of his own tenet.

The line, drawn hard because PROMPT 0012 drew it first ("the store does not
need to become an actor"; "do not remodel the entire knowledge system as one
enormous workflow graph"): the process substrate is **descriptive and
validating, never driving**. The store records "gate G satisfied by evidence
E, by actor A, at T" and answers "what gate is this work at?" It has no
scheduler, no mailboxes, no dispatch, no run-loop. Execution belongs to
actors — aime, harnesses, humans. A compiled agent receives its identity,
its permitted intents, the process graph it stands in, the gate it faces,
and its memory and context — **everything except the impulse.**

**L5 — "Compile the entire system." THE UMBRELLA — REFUSED AS A GOAL,
ACCEPTED AS AN ASYMPTOTE.** The same document that gave us "context
compiler" warned against exactly this totalization, and the warning was
right: search relevance, provenance, disclosure, and judgment are not state
machines and must never be forced into one. The system asymptotically
approaches fully-declared as each piece *earns* declaration; it is never
remodeled wholesale.

## The experiment — E-PROC (evidence before engine)

Per 0121 discipline, no engine code until declaration proves its worth on
paper: **declare OUR OWN operating process** — the merge law (worktree →
stamp → build → rebase → full validation → ff-merge → push), the review
gate (review 0001's shape), and the release lane (MEMO-0002) — as a
`process` substrate fixture in this repo. Then two structural-suite
assertions: (a) the declaration validates against the meta-schema; (b) the
last N landings' journal entries are *consistent* with the declared graph
(every landed branch shows validation-before-merge, stamp-before-write).
That is process-as-data proving descriptive value on real history, zero
engine changes, zero orchestration. If the declaration is honest enough to
detect its own violations (e.g., a landing that skipped revalidation), L4
has earned its ADR.

## Cross-validation scorecard

| Against | Verdict |
|---|---|
| Substrates-as-data (0113) | L3/L4 are pure declarations — mechanically consistent; meta-schema change is additive under 0122 versioning |
| Store-is-not-an-actor (0119) | Preserved iff validate-never-drive; violated by any dispatch/run-loop |
| Tenet 11 (PROMPT 0005) | STRENGTHENED — named gates are the precondition for earned absorption; this is the tenet's missing infrastructure |
| PROMPT 0012 warnings | L5 totalization refused; state machines stay one input to the compiler, not its owner |
| Pressure-ledger discipline | L3 evidence-empty → seam now, build on first violation; L4 → E-PROC experiment first |
| Postgres prior art | Grants-in-catalog maps exactly; our differentiator stays git-native docs, not a server catalog |
| aime boundary | Execution/mailboxes stay aime's; backlog-mcp compiles the world the executor acts in |

## Rulings requested

1. **R-A:** adopt the line as law — *compile interfaces, constraints, and
   gates; never the run-loop* — recorded in the NORTH-STAR boundary section.
2. **R-B:** reserve the `permitted` field in the workflow meta-schema (seam
   only, additive, no enforcement) when 0122 Slice A lands.
3. **R-C:** GO E-PROC — declare our own merge law as the first process
   fixture and let the suite check history against it. Zero engine code.

New pressure-ledger rows added: actor-transition authorization (seam, no
build) and process-as-data (E-PROC chartered).

---

# Part Two — The Declarative Agent-System Compiler (PROMPT 0014)

**Status: PARKED UNTIL PAIN (goga, 2026-07-18).** Captured as design record;
explicitly no build, no engine change, no meta-schema change beyond what
Part One's R-B already reserved. This section records the belonging
assessment Goga asked for and the tripwires that unpark it.

The external text refines PROMPT 0013 into its mature form: not a meta
state machine but a **declarative agent-system compiler** — declarations
(substrates, identities, roles, capabilities, workflows, policies,
relations, disclosure, memory, operations, events) compiled into validated
surfaces (validators, identity-specific tools, transition contracts,
context plans, projections, event contracts), with the store owning truth
and legality and runtimes owning execution. Its "should NOT mean" list is
Part One's line, independently restated: never runs agents, schedules,
retries, supervises, executes guard code, or owns distributed durability.

## Belonging assessment — the three anchors

**1. Substrates-based architecture: BELONGS, mechanically.** Every noun in
the declaration list is a declaration — 0113's registry extended, additive
under 0122 versioning. Three refinements are adopted into the design record
now (no code):
- **Identity ≠ role ≠ capability** — they change at different rates. Half
  is already ours: the agent substrate has separate `principal` (identity)
  and `role` fields, with 0119's own comment "roles move while identity
  stays." Capability is the genuinely new third axis; policies bind
  role→transition, never identity→transition, so workflows are never
  duplicated per agent.
- **The bounded guard language as LAW**: field comparisons, relation
  existence, caller identity/role checks, required evidence, fixed field
  assignments, small boolean composition — and nothing else, ever.
  Danger 1 (accidentally inventing a programming language) is the
  abstraction's death mode; anything requiring computation lives in an
  external actor that returns evidence.
- **Static analysis is the compiler's strongest yield** — unreachable
  states, stuck operations, self-granting capabilities, transitions whose
  required context disclosure hides, diffs between workflow definition
  versions (0122's frozen history makes this computable). "An executable
  constitution" — pure functions over declarations, zero runtime cost,
  and honestly the part most aligned with our deterministic-truth
  instincts (structural suite lineage).

**2. Local git-first markdown storage: BELONGS, with one seam noted.**
Declarations are JSON files; live process state is markdown operations
(shipped); events map to the journal — which D2's taxonomy already classes
as append-only evidence; locally "observe events" is the watcher/SSE we
have. The one genuinely new demand: identity-specific tool listing requires
the server to know the caller at interface-compilation time — the 0119.1
ladder provides exactly this ambient identity. Cross-machine event
observation is sync territory: parked with sync, seams already preserved
(§9 of the pressure map).

**3. Tenets and vision: BELONGS, and twice strengthens them.**
Context-requirements-per-transition makes progressive disclosure *compiled
rather than remembered* — "an agent should not receive a universal mutation
tool and a paragraph asking it to behave" is our intent-port tenet stated
better than we state it. And the loop (role-specific context → legal
actions → validated transition → memory capture → changed context) is
Tenet 11's earned-absorption cycle with infrastructure. The four dangers
map onto refusals we already hold: danger 2 = workflow-stays-optional
(shipped: knowledge substrates carry no workflow); danger 3 = the
identity/role/capability/skill/policy/harness separation (adopted above —
"descriptive metadata must never quietly become a security boundary");
danger 4 = prove one loop first, which is Goga's park ruling itself.

## The two experiments, ordered

- **E-PROC (Part One R-C)** remains the paper-first step: zero engine code,
  declaration + suite-vs-history. Parked with everything else, but it is
  the designated first move on unpark.
- **The live-loop experiment (PROMPT 0014's)** — one operation workflow,
  three roles, compiled role tools, the destroy-and-resume acceptance test
  ending in "a human can understand the entire process from Markdown
  alone." Second move on unpark, only after E-PROC's declaration proved
  descriptively honest.

## Unpark tripwires (any one suffices; adjudicated on the Desk)

1. First wrong-actor-wrong-transition incident in real fleet operation
   (the grants evidence column stops being empty).
2. First time a briefing must include a paragraph of behavioral pleading
   that a compiled role interface would have made structural.
3. First duplicated workflow-definition-per-agent (the role-axis pain).
4. E-PROC-style drift observed: our prose process law contradicted by
   journal history and nobody noticed for a week.
5. aime (or any orchestrator) requests a legal-next-actions disclosure or
   event contract from the store — external demand for the compiled
   surface.

## Naming, for the NAME thread's file

Internal: *a declarative agent-system compiler backed by durable,
human-readable state.* External: *a project can teach any agent who it is,
what matters, what it may do, and where work currently stands — in one
wakeup.* And the sentence that subsumes both registers so far: **the
repository becomes a self-describing operating environment for agents.**
