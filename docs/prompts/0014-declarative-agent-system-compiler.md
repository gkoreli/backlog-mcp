---
title: "PROMPT 0014 — The Declarative Agent-System Compiler (verbatim; parked until pain)"
date: 2026-07-18
status: Captured verbatim — Goga's ruling attached: capture as proposal, NO action until we face the pain for it
author: goga (conveying the external assessment's response to PROMPT 0013)
relates_to:
  - 0013-meta-state-machine-compiled-workflows.md
  - ../proposals/compiled-process-2026-07.md
---

# PROMPT 0014 — Goga's framing, verbatim

> i want to capture this as a proposal but we are explicitly not going to take
> acation on it any time soon until we face the pain for it, and we need to
> assess if it even belongs to our substrates based architecture, our local
> git first md based storage layer, and our backlog mcp tenets and vision,
> but still cool thought experiment:

# The conveyed text, verbatim

> Yes—this could be the larger architecture hiding inside the substrate idea.
>
> But I would describe it as a **declarative agent-system compiler**, not one giant "meta state machine." The system contains typed entities, identities, policies, context, memory, and multiple interacting state machines. Reducing all of that to state machines would make the abstraction less expressive.
>
> The compelling vision is:
>
> > A repository declares its knowledge model, agent identities, permitted actions, workflows, context policies, and durable state. backlog-mcp compiles those declarations into validated interfaces that external agents execute.
>
> That preserves your storage boundary while making it far more powerful.
>
> ## What the repository could declare
>
> Substrates: What durable things exist?
> Identities: Who or what can act?
> Roles: What responsibility is an identity currently carrying?
> Capabilities: Which semantic intents may it invoke?
> Workflows: What lifecycle can each substrate follow?
> Policies: Who may perform each transition, under which conditions?
> Relations: How entities and actors connect.
> Disclosure: What context each identity receives at wakeup, recall, and expansion.
> Memory: What the system has learned and what remains currently valid.
> Operations: Live instances of processes that must survive compaction or restart.
> Events: What durable state changes external runtimes may observe.
>
> Then backlog-mcp compiles those declarations into several surfaces:
> [mermaid: Project declarations → Deterministic compiler → {Write validators, Identity-specific tool interfaces, Transition contracts, Context and disclosure plans, Viewer projections, Event contracts} → External agents → semantic intent → Durable Markdown store → validated change event → agents]
>
> The store owns truth and legality. External runtimes own execution.
>
> ## Model identity separately from role and capability
>
> I would resist putting all executable workflows directly on an identity. Identity, role, and permission change at different rates.
>
> Identity — builder:quartz — Stable attribution: who acted?
> Role — telemetry-engineer — Current assignment: what responsibility are they carrying?
> Capabilities — task.claim, task.complete, memory.remember, adr.propose — What may this role invoke?
> Workflow binding — task.claim may be invoked by telemetry-engineer when task.assignee is empty or equals the caller
>
> This lets the same identity change roles without changing historical identity. It also prevents duplicating workflow definitions for every agent.
>
> A transition declaration might resemble:
>
> { "name": "claim", "subject": "task", "from": ["open"], "to": "in_progress",
>   "allowedRoles": ["engineer"],
>   "guards": [{ "field": "assignee", "operator": "empty-or-caller" }],
>   "effects": { "assignee": "$caller" },
>   "emits": "task.claimed" }
>
> The compiler could derive: a backlog_claim_task tool; its minimal input schema; authorization checks; transition validation; actor attribution; the resulting event contract; context disclosure explaining why the action is available.
>
> An agent should not receive a universal mutation tool and a paragraph asking it to behave. It receives the precise legal interface compiled for its identity and role.
>
> ## What "compile the entire workflow" should mean
>
> Compilation should mean: validate the declarations; detect contradictions and structural problems; generate legal semantic interfaces; determine the legal next actions from current durable state; shape the context required to choose among those actions; validate and record the selected transition; emit an event that an external runtime may act upon.
>
> It should NOT mean that backlog-mcp: runs agents; schedules timers; calls models; retries failed work; supervises processes; executes arbitrary guard code; waits for external services; owns distributed workflow durability.
>
> backlog-mcp: TASK-12 may legally transition open → in_progress by role engineer; validates; persists; emits task.claimed.
> aime: observes task.claimed; starts agent; handles timeout/retry/crash; later requests task.complete.
>
> That division keeps your "store, not actor" invariant intact.
>
> ## The compiler could provide more than execution
>
> The strongest part may be static analysis. Once workflows, identities, policies, and relations are declarations, the compiler can answer: Is a state unreachable? Does a nonterminal state have no outgoing transitions? Can an operation become permanently stuck? Can an identity transition something it cannot subsequently read? Can two roles both claim exclusive ownership? Does a transition require context that disclosure policy hides? Can an agent grant itself additional capabilities? Does a workflow reference a nonexistent relation? Is a terminal state still writable? Which actions are legal for this identity right now? What changed between workflow definition versions?
>
> That is far more valuable than drawing workflow graphs. The declarations become an executable constitution for the agent system.
>
> ## Where memory and context enter
>
> Memory and context should not themselves be forced into state-machine semantics. Instead, workflow compilation should be able to declare its context requirements:
>
> { "transition": "approve",
>   "context": { "include": ["subject", "requirements", "referenced_adrs", "unresolved_contradictions"],
>                "budget": 1200, "requiredEvidence": ["review_artifact"] } }
>
> Then the compiled approve interface can ensure the agent sees: the current subject; applicable requirements; relevant architectural decisions; known contradictions; the evidence needed for approval.
>
> identity → receives role-specific context → sees legal semantic actions → chooses an action → store validates and records it → memory captures what was learned → future context changes
>
> Progressive disclosure becomes part of the compiled system, rather than a generic search call agents must remember to use correctly.
>
> ## Where the abstraction could consume you
>
> 1. Accidentally inventing a programming language. As soon as guards permit arbitrary expressions, effects become scripts, and transitions call services, you have created: a language runtime, a security model, a debugger, a package ecosystem, versioning and compatibility obligations, another orchestrator. Keep the declaration language bounded and non-Turing-complete: field comparisons; relation existence; caller identity/role checks; required evidence; fixed field assignments; possibly small boolean composition. Anything requiring computation belongs in an external actor that returns evidence or requests a transition.
>
> 2. Treating everything as workflow. Some entities have meaningful lifecycles: Task, ADR, Requirement, Review, Deployment, Operation. Others are primarily knowledge: Reference, Memory, Explanation, Design note, Artifact. A substrate should declare a state machine only when illegal transitions matter. Workflow should remain optional.
>
> 3. Mixing authorization with behavioral description. "An agent knows how to review code" and "an agent is permitted to accept an ADR" are different claims. Keep separate: Identity (who acted), Role (current responsibility), Capability (what may be requested), Skill (how an agent performs work), Workflow (legal state evolution), Policy (which identities or roles may invoke transitions), Harness (how the agent is executed). Otherwise descriptive metadata quietly becomes a security boundary.
>
> 4. Compiling too much before proving one loop. "Compile the entire agent system" is a powerful architectural direction but a dangerous initial project plan. Prove it through one live operation first.
>
> ## The smallest serious experiment
>
> One workflow involving three existing concepts:
> Operation substrate: proposed → active → awaiting_review → complete, ↘ blocked
> Roles: orchestrator, engineer, reviewer
> Bindings: orchestrator: activate, assign, cancel; engineer: block, request_review; reviewer: complete, return_for_changes
>
> Compile: role-specific tools; legal transition validation; current legal-actions disclosure in wakeup(operation=…); required context for every transition; actor and causation attribution; an event after every accepted transition.
>
> Acceptance test: a fresh agent wakes up with an identity and operation; learns its goal, constraints, current state, and legal actions; cannot see or invoke transitions outside its role; performs work through an external harness; the store records the transition and provenance; the agent is destroyed; a fresh agent resumes from the same durable operation; a human can understand the entire process from Markdown alone.
>
> If that works cleanly, you have demonstrated something substantially bigger than a backlog or memory store.
>
> ## What I would call the architectural center
>
> Internally: A declarative agent-system compiler backed by durable, human-readable state.
> Externally: A project can teach any agent who it is, what matters, what it may do, and where work currently stands—in one wakeup.
>
> That is the gold. Not "we have state machines," but: The repository becomes a self-describing operating environment for agents.
>
> State machines provide legal motion. Identities provide attribution and authority. Memory provides continuity. Context provides bounded awareness. Substrates provide the language. The compiler binds them together—but the agents still live and act outside the store.

Distilled into: docs/proposals/compiled-process-2026-07.md Part Two (the
belonging assessment + the PARK with named unpark triggers).
