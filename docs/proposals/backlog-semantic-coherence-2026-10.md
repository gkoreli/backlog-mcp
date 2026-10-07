---
title: "Backlog semantic coherence — audit and design brief"
date: 2026-10-07
status: Proposed — initial code-grounded audit, not an accepted architecture decision
backlog_item: EPIC-0001
---

# Backlog semantic coherence

Goga's direction is to improve the semantics of the entire backlog. Recall and
search overlap is one symptom. Both have distinct intent, ergonomics and
implementation; merging them is not the starting assumption.

This brief examines the current checkout at `9598779`, extends the questions in
[report 0012](../reports/0012-tool-surface-workflows.md) and
[report 0014](../reports/0014-tool-surface-architecture.md), and supplies the next
design input for EPIC-0001. Older report findings are not treated as current
without checking their owning paths. Evidence here is code inspection and this
session's observed wakeup. The subsequent mutation probes and accepted pathway
decision are recorded in [ADR 0106.6](../adr/0106.6-one-substrate-operation-path.md).

## Product contract

A user should be able to predict what an object represents, what an action
changes, which records are authoritative, and what a result establishes. The
same concept should retain that meaning across CLI, MCP, viewer and native
Markdown. Adapters may differ in ergonomics and access policy.

The design must preserve the [North Star](../NORTH-STAR.md): readable Markdown,
one source of truth, local capabilities, open substrates, progressive disclosure,
no LLM in the server write path, and an external agent doing interpretation.
ADRs [0134](../adr/0134-engineering-rules.md),
[0135](../adr/0135-complete-reads-and-managed-mutation-consistency.md) and
[0136](../adr/0136-domain-ownership-and-application-patterns.md) remain binding.

## Maintainer direction — one declarative mutation authority

Goga clarified that updating and remembering should be composable or declarative
implementations executed through `executeSubstrateIntent`, and that there should
not be different ways to access operations on a substrate. One substrate-owned
operation catalog must serve CLI and MCP. CLI and MCP already belong above core;
merely adding separate validators to every existing write entry point would
retain competing action implementations and access models.

The target dependency direction is:

```text
CLI / MCP
    -> the same selected-home substrate operation catalog
    -> resolve a declared operation and its input
    -> executeSubstrateIntent
        -> validate input and substrate-owned rules
        -> construct a typed operation plan
        -> execute through injected publication capabilities
        -> return the committed outcome and derived-effect diagnostics
```

Substrate declarations own the action vocabulary, field bindings, transitions,
relationships and lifecycle policy. Pure typed policy helpers implement checks
and plan construction that cannot be expressed as field assignment alone.
Trusted core handlers compose those helpers and injected effects. Project data
selects supported mechanics; it does not contain executable callbacks or code.

`updateEntity` and `remember` cease to be independent public mutation entry
points. Their domain mechanics become composed implementations of declared
operations. Both adapters expose the same supported operations, inputs and
semantic outcomes; transport spelling and presentation can differ. Memory
remember/correction/retraction and task creation/transition are declarations in
that catalog, rather than special parallel APIs beside it.

Generic CLI field mutation does not remain a second normal access model. Where
record editing is warranted, declare its operation and substrate-owned policy
through the same catalog and executor. A compatibility spelling, if retained
temporarily during migration, resolves that same declared operation and adds no
authority. Existing raw-maintenance exceptions must be revisited in the ADR;
adding an override beside the common executor would retain the divergence Goga
explicitly rejected. Native file editing remains the human-owned external lane.

The executor currently depends on `createEntity`/`updateEntityPostimage`, and
`remember` runs beside it through `MemoryComposer.store`. Extract their existing
publication mechanics into cohesive internal handlers so delegation through the
executor does not introduce recursion. Input-schema validation must also live at
the core execution boundary, rather than relying on MCP registration to have
validated a call first.

Memory operations retain their actual semantics: normalization, explicit source
provenance, temporal/derived-source checks, a new memory holder, coordinated
predecessor closure for supersedes/state_key, and post-commit advisory collision
review. Compose the existing `core/memory-correction.ts` policy and coordinated
storage capability; do not lower correction to an ordinary single-document save.
Task transitions and declared relation operations likewise retain their subject,
preimage, endpoint and compensation contracts.

Each execution owns one sampled operation time and one semantic journal attempt.
Existing committed diagnostics, exact-revision conflicts and partial-recovery
outcomes remain distinguishable. Nested completion capture is a derived memory
operation with explicit attribution and timing; prevent it from replaying the
primary semantic write or generating duplicate primary journal entries.

Implementation phases for the decision ADR:

1. Extend compiled operation/policy contracts and compilation in
   `packages/shared/src/substrates/` and `core/substrates/`; declare memory and
   normal update mechanics explicitly. Establish how policy is compiled for both
   built-in and project-defined substrates before changing public definitions.
2. Extract cohesive mutation handlers from `core/create.ts`, `core/update.ts`
   and `core/remember.ts`; make the executor own input validation and execution
   orchestration while preserving their existing publication/recovery capabilities.
3. Expose the same compiled operation catalog through CLI and MCP, remove their
   separate normal CRUD/memory access models, and route mutations through the
   executor. Keep adapter-specific parsing/provenance presentation and specialized
   result fields. Resolve any temporary spelling compatibility explicitly; it
   must not introduce an independent operation or maintenance authority.
4. Move edit, retraction and deletion onto declared mechanics as their lifecycle
   policies are specified. Verify that ordinary managed paths cannot avoid the
   same substrate rules through a different entry point.
5. Verify custom declarations, direct core callers, CLI/MCP mappings, correction
   lineage, repeated actions, failure/compensation and post-commit diagnostics.

This is the maintainer's architectural direction. Specific operation schema,
catalog presentation and public compatibility changes remain design work;
this document does not claim that the migration has been implemented.

## Concepts and their responsibilities

These are explanatory roles, not proposed closed enums or new required types.
Existing built-in and project-defined substrates remain the declarations.

| Concept | What it represents | What it does not establish by itself |
|---|---|---|
| Document/entity | An addressable, human-readable record with declared fields | That every statement in its body is verified |
| Task/work | An intended outcome, its progress, blockers and completion evidence | A reusable lesson or accepted architectural ruling |
| Epic/milestone/folder | Declared grouping, planning or containment | That all children share a workflow or that finishing a parent finishes them |
| Decision/requirement | A recorded choice or standing constraint with its own lifecycle | That a newer mention silently replaces an accepted record |
| Memory | Captured experience, reusable knowledge or preference with provenance and validity | That relevance, usage or lack of expiry proves truth |
| Operation document | Agent-authored durable goal and continuation state | That the engine executes or keeps the operation current automatically |
| Mutation journal | Evidence of managed actions and their recorded receipts | A complete transcript of native edits or a substitute for a continuation record |
| Home | One selected corpus and its derived local state | A universal search of every project |
| Projection/index | A derived view used for retrieval or presentation | A second authoritative document store |

Avoid copying a decision into a memory as a competing ruling. A memory can
preserve the lesson and point to the decision. Completion captures should remain
recognizable event pointers; learned knowledge needs the doer's explicit capture.

## Action contracts

| Action | Intended question or change | Essential distinction |
|---|---|---|
| Wakeup | What matters now, or where does this operation resume? | Selective orientation; not an inventory or reconstructed session summary |
| Recall | What captured knowledge or experience applies? | Memory-specific retrieval, validity, ranking, provenance and disclosure |
| Search | Where is matching indexed material? | Document discovery; corpus membership and exclusions must be explicit |
| List | Which entities satisfy these filters? | Bounded enumeration; not relevance ranking or a complete corpus scan |
| Get | What does this source say? | Authoritative detail, optionally accompanied by relationship stubs |
| Declared intent | Propose, start, complete, supersede or another declared action | Preconditions, state changes, evidence and effects belong to the action |
| Remember/correct | Preserve knowledge or replace a prior holder | Correction lineage and prior-holder retirement, not ordinary field editing |
| Forget | Retract remembered knowledge | Soft expiry; expired-item garbage collection is a separate consequence |
| Managed record edit | Perform an edit permitted by its substrate | Declared action policy applies through the common executor; generic CRUD is not a second authority |
| Delete | Permanently remove a record | Different from completion, cancellation, supersession and retraction |

Recall is implemented through `core/recall.ts`, `MemoryComposer` and registered
`MemoryStore` implementations. The default `BacklogMemoryStore.recall` uses
`searchUnified` for candidates, then applies memory filters and usage ranking.
Search enters through `core/search.ts` and returns document matches. Sharing
candidate retrieval does not make these the same operation. Preserve their
separate contracts while testing whether the outputs make their value clear.

## Current tensions to resolve

Server source paths below are relative to `packages/server/src/`.

1. **A valid postimage and a valid action are different.**
   `core/update.ts` merges fields and persists a schema-valid postimage.
   `core/substrates/execute-substrate-intent.ts` additionally checks the subject
   and transition precondition. Generic update also treats null as field deletion;
   compiled postimages may retain literal null. ADR 0106.5 deliberately retained
   the generic CLI operator tail. ADR 0106.6 now supersedes that exception:
   managed writes use declared actions, with native Markdown editing available.

2. **Memory promises exceed the generic record schema.**
   `core/remember.ts` validates dates, derived-source requirements and correction
   inputs. Generic creation/update/body-edit paths do not pass through remember.
   Coordinated correction publication has improved under ADR 0135, but that does
   not settle which other managed paths may change memory lifecycle fields.
   ADR 0106.6 requires declared memory mechanics through the same executor;
   implementation must close the remaining managed-path bypasses. Native
   Markdown remains lossless and diagnostically readable.

3. **Context currently names different things.**
   Recall's `context` is an exact `parent_id` comparison in
   `memory/backlog-memory-store.ts`; get's `context:true` requests a relational
   neighborhood; configuration has a default entity context; wakeup's `scope`
   describes a subtree. `packages/shared/src/substrates/memory.ts` calls scoped recall
   subtree filtering, which the exact-parent implementation does not provide.
   Explain home, containment, retrieval scope and expansion separately. Choose
   exact versus descendant recall semantics explicitly before changing behavior.

4. **Relationships have different meanings and enforcement.**
   `core/container-routing.ts` chooses a parent using explicit input, intake,
   references, recent actor activity and scope defaults. Routing evidence is not
   parent-target validation. Declared relation intents validate endpoints and
   transitions; generic field assembly does not offer the same checks.
   `core/get-context/types.ts` already distinguishes structural links, references,
   declared relations and semantic similarity. Keep those distinctions visible:
   related by similarity is not evidence, containment or supersession.

5. **Mutation results do not consistently explain what happened.**
   Create/update/delete use committed diagnostics and journal context.
   `core/forget.ts` delegates to the composer and returns only a count; its store
   publishes expiry/deletion without the same semantic journal path.
   `tools/backlog-delete.ts` prints Deleted even when core returns deleted:false.
   Prefer accurate operation-specific receipts with common concepts: affected
   IDs, selected home, changed/no-op outcome, and existing commit diagnostics.
   Do not invent a universal transaction guarantee or erase specialized results.

6. **Capture vocabulary and its predicate disagree.**
   `core/memory-capture-rules.ts` describes task completion but checks only the
   status edge into done. `core/update.ts` invokes it for built-in entities.
   Decide whether capture means task completion or a broader completion event;
   align the predicate, provenance and labels. Reopening and completing again
   also requires an explicit event/duplicate policy, not silent deduplication.

7. **Orientation selection is not maintained continuation state.**
   This session's project wakeup surfaced September task states while ADR 0136
   records October engineering acceptance. Answering where work stopped required
   Git and the ADR. This is observed coverage/currency friction, not proof of an
   index defect. Define who updates the work record, what next-action fields mean,
   and how wakeup discloses missing or conflicting continuation evidence. The
   engine must not infer completion from commit prose or rewrite statuses itself.

8. **Defaults and absence can hide scope or capability differences.**
   `guides/homes-and-configuration.md` documents project discovery for CLI wakeup
   while other commands retain their existing defaults. Recall returns an empty
   result if no composer is wired; remember errors without one. List excludes
   memories by default and returns an open-substrate collection named tasks.
   Specify selected-home provenance, default exclusions, boundedness and the
   difference between no match and unavailable capability. Wire-name/default
   changes require explicit migration decisions, not incidental cleanup.

## Design and implementation sequence

1. **Build a semantic contract matrix.** For each existing action, record its
   user intent, concept, authority, preconditions, selection defaults, no-op/error
   behavior, durable effects, derived effects and output. Include custom
   substrates, generic CLI maintenance and native editing. Reconcile names and
   help with actual implementation before proposing renames or removals.
2. **Use journeys to choose rulings.** Cold-open, resume work, find a document,
   recall a lesson, complete work, accept/supersede a decision, correct/retract a
   fact and maintain an imperfect native document. Separate confusing semantics
   from missing discovery guidance and from genuine invariant bypasses.
3. **Write the decision ADR.** Carry the chosen model and file-level phases into
   TASK-0012. Revisit specific prior rulings only where evidence warrants it.
   Preserve recall/search as separate candidates; do not assume a merged verb,
   universal dispatcher, new package or broad schema migration.
4. **Repair cohesive contracts in core.** Follow the maintainer's declarative
   mutation direction above: compile substrate-owned rules once and compose
   execution through one authority. Couple migration with truthful receipts,
   relationship policy and capture semantics. CLI/MCP/HTTP adapt the same business
   contracts; their presentation and permission rules may differ.
5. **Validate complete journeys.** Follow the testing guide for unit work and
   use disposable real-process homes for manual validation. Cover malformed
   selection, wrong home, conflicting revisions, custom types, native anomalies,
   repeated actions and unavailable advisory services. Compare correctness,
   wrong action/source choices, calls, tokens and time to useful result.

The acceptance criterion is predictable meaning across the product. Fewer tool
names, more retrieval hits or a cleaner import graph alone cannot establish it.
No production behavior, version, publication or accepted ADR changes are made by
this brief. No tests were run for this documentation-only audit.
