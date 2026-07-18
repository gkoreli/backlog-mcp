---
title: "PROMPT 0012 — The Pressure Map: Provenance, Decay, Economics, Destruction, Turnover, Sync (verbatim)"
date: 2026-07-18
status: Captured verbatim (external assessment supplied by Goga; source unstated — sections 4-9 of the document whose section 3 became ADR 0122)
author: goga (conveying an external assessment)
relates_to:
  - ../proposals/pressure-map-2026-07.md
  - ../adr/0122-substrate-schema-evolution.md
  - 0011-schema-evolution-versioning.md
---

# PROMPT 0012 — verbatim

> lets consider all of this: 4. Causality and provenance
> In an agentic environment, "what is stored?" is only half the question. The other half is:
> Who wrote it?
> Acting on whose behalf?
> In response to which request?
> Derived from which sources?
> Which prior fact did it supersede?
> Which agent run produced it?
> Was it observed, inferred, or generated?
> What confidence or authority should it carry?
> This may be one of your richest opportunities. Traditional databases store records; backlog-mcp can store why the record exists and how much authority it deserves.
> Your actor attribution, operation journal, supersedes, state_key, references, and memory provenance are early pieces of an epistemic ledger.
>
> 5. Epistemic decay
> A storage engine preserves things. An agent memory system must also understand that preserved things can become wrong.
> Future pressure includes:
> Facts that were once correct but are no longer correct.
> Two valid facts applying in different contexts.
> Plans mistaken for established decisions.
> Derived summaries outliving their sources.
> Frequently recalled information acquiring undeserved authority.
> Contradictions that cannot be resolved automatically.
> This is where backlog-mcp differs from generic Markdown search. The system needs to preserve history while keeping the agent's current working belief set clean.
> That points toward richer validity and provenance semantics—not toward actors.
>
> 6. Retrieval economics
> The data will grow much faster than the context windows available to consume it.
> The boundary must survive:
> 100,000+ documents.
> Many substrate types.
> Multiple homes.
> Competing memories.
> Queries with ambiguous intent.
> Expensive embeddings or unavailable local models.
> Retrieval that is technically relevant but operationally useless.
> Token budgets that remove important caveats.
> Your real product contract is not merely "we can store and search it." It is:
> We can disclose the smallest sufficient context without hiding material uncertainty or omission.
>
> Progressive disclosure may ultimately be more important than the storage backend.
>
> 7. Derived-state destruction
> Indexes, embeddings, telemetry, caches, projections, and future sync metadata will become increasingly sophisticated.
> A fundamental survival test should remain:
> Delete every derived artifact. Can the system reconstruct itself from the authoritative documents without losing meaning?
>
> If yes, you retain freedom to replace Orama, embeddings, ranking algorithms, viewers, or sync technologies later. If no, a supposedly disposable implementation detail has become a second source of truth.
>
> 8. Harness and model turnover
> Codex, Claude, local models, MCP, and today's orchestration frameworks will change. The store should not encode one harness's transient worldview.
> Survive:
> Different tool protocols.
> Different agent identity formats.
> Agents that cannot use MCP.
> Models with radically different context capacity.
> Clients that only understand files and shell commands.
> New transports and invocation styles.
> Your Markdown surface and transport-free core are strong defenses. Keep "MCP" as a port, not the product ontology.
>
> 9. Sync without centralization
> Local-first eventually encounters:
> Laptop and desktop copies.
> Offline work.
> Git branches and worktrees.
> Peer agents on several machines.
> Private global memories plus shared project memories.
> Selective sharing rather than syncing everything.
> You do not need to solve sync now. But it is worth preserving:
> Stable document identity.
> Explicit operation provenance.
> Deterministic reconciliation.
> Conflict visibility.
> A clear authoritative/derived boundary.
> Those seams leave room for Git, Loro, another CRDT, or something not yet selected.

## Continuation (same document's concluding sections, verbatim)

> Where state machines belong
> State machines belong here:
> Substrate definition
>   ├── schema
>   ├── identity
>   ├── relations
>   ├── disclosure
>   ├── lifecycle/workflow  ← state machine
>   └── semantic intents
> They help a substrate express legal lifecycle changes. They should not become the universal explanation of the product.
> Not everything important is a state transition:
> Search relevance is not a state machine.
> Provenance is not a state machine.
> Contradiction is not necessarily a state machine.
> Progressive disclosure is not a state machine.
> Identity and causality are not state machines.
> Human-readable authority is not a state machine.
> Semantic retrieval is not a state machine.
> Let workflows use state machines. Do not remodel the entire knowledge system as one enormous workflow graph.
> Likewise, actors can exist outside the boundary:
> Agent actors / orchestrators
>               ↓ intents
> backlog-mcp durable knowledge boundary
>               ↓ observations
> Humans, viewers, and other agents
> The store does not need to become an actor just because actors use it.
>
> The larger gold
> The most interesting thing you have may be substrates-as-data plus compiled agent interfaces.
> A project declares:
> What kinds of knowledge exist.
> What their valid shape is.
> How they relate.
> What lifecycle they follow.
> Which semantic actions are permitted.
> What should appear during wakeup, recall, search, and expansion.
> From that declaration, backlog-mcp can derive storage, validation, tools, retrieval projections, diagnostics, and human presentation.
> That is more than a storage engine. It resembles a:
> Project-owned context compiler for humans and agents.
>
> The state machine is one input to that compiler. It does not own the compiler.
> Your other possible gold is epistemic infrastructure: helping an agent know not merely what information exists, but which information is current, authoritative, contradictory, derived, stale, relevant, and worth spending context on. Most memory products stop at "store text and retrieve similar text." Your vision reaches beyond that.
>
> Where you may be tunnelling
> I would watch three assumptions particularly closely:
> "Most durable knowledge is a substrate."
> Perhaps—but not every document deserves a formal type. Require a distinct invariant, relation, lifecycle, disclosure policy, or intent before promoting something from generic document to substrate.
>
> "The viewer must never edit."
> Read-only preserves architectural clarity, but contradiction adjudication, correction, and trust management may eventually need a highly convenient human control surface. The invariant should perhaps be "all mutations pass through the same validated intent boundary," rather than permanently forbidding graphical mutation. Don't change it now; just recognize that it is a product bet, not a law of nature.
>
> "Local-first forever."
> This is an excellent wedge and trust position. But if the strongest demand becomes a shared memory layer for distributed teams of agents, synchronization and selective collaboration may become central. Local-first can survive that; "every useful interaction must occur on one filesystem" cannot.
>
> A practical way to think ahead
> I would maintain a small pressure ledger rather than a speculative architecture roadmap:
> Pressure    Evidence today    Seam to preserve    Build now?
> Parallel writers    ID collisions    identity, atomic creation, conflicts    Yes, smallest fix
> Stale updates    Likely soon    optional version preconditions    Design seam
> Retries    Agent/tool reality    idempotency and operation IDs    Small addition when observed
> Branch convergence    Already present    diagnostics and renumber protocol    Yes, operationally
> Peer sync    Not yet proven    stable IDs and causality    No
> CRDT merge    Not yet required    authoritative/derived separation    No
> Actor mailboxes    Belongs to aime    clean external intent port    No
> Schema aging    Inevitable    versioned definitions, lenient reads    Yes
> Epistemic authority    Core product pressure    provenance and validity    Continue
> Retrieval scale    Already observed    budgets, omissions, evaluation    Continue
>
> The strategic principle is:
> Future-proof the information model and boundaries; do not pre-build future execution machinery.
>
> Your tool is not being swallowed by the state-machine or actor umbrella. If anything, those concepts are smaller components being placed correctly inside a larger architecture concerned with durable, intelligible knowledge across humans, agents, time, and changing technology.

Distilled into: docs/proposals/pressure-map-2026-07.md (sections 4-9 + the
cross-validation addendum) and docs/PRESSURE-LEDGER.md (the living ledger,
adopted).
