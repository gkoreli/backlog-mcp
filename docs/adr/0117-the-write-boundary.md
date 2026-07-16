---
title: "0117. The Write Boundary — Native Editing, Diagnostics, and Strict Managed Writes"
date: 2026-07-16
status: Proposed
spawned_by: "PROMPT 0002 item 7 — docs/prompts/0002-operating-principles-directives.md"
extends:
  - 0094-transport-agnostic-operation-logging.md
  - 0098-unified-substrate-architecture.md
relates_to:
  - 0104-local-first-deployment-posture.md
  - 0106-semantic-intent-tools-at-mcp-boundary.md
  - 0107-loro-as-truth-local-first-history-substrate.md
  - 0112-docs-native-project-scoped-backlog.md
  - 0113-user-defined-substrates.md
---

# 0117. The Write Boundary — Native Editing, Diagnostics, and Strict Managed Writes

**Status:** Proposed — research and delegated rulings recorded. Goga accepts
or amends on read before engineering begins.

## Decision

Select two deliberately unequal lanes:

1. **Native Edit is the default lane.** Humans and agents edit the
   authoritative Markdown with the editor already available to them. The
   docs-tree watcher requests full reconciliation. Reconciliation reads,
   indexes, and diagnoses the resulting bytes; it never silently repairs,
   formats, canonicalizes, or upgrades the file.
2. **Managed edit is the strict lane.** `write_resource` remains only for a
   caller that explicitly wants anchored editing, complete postimage
   validation before success, canonical serialization, and one best-effort
   operation-log append with exact tool input and actor attribution. At the MCP
   boundary it is deferred behind tool discovery, not loaded into every
   session's baseline context.

Hooks are optional diagnostic enrichment. A supported harness may report a
successful native Edit/Write call after it occurs, but hooks do not validate
the file, do not repair it, and do not participate in reconciliation
correctness. Unsupported editors remain fully functional; they simply lack
immediate edit-aware feedback.

This is **native by default, strict on demand**. It is not two equivalent tools
competing for ordinary prose editing.

The recommendation preserves ADR 0113's governing law:

- external and historical content is read leniently and losslessly;
- backlog-mcp's managed writes are strict and canonical;
- neither rule authorizes heuristic mutation of a user's file.

It makes one narrow correction to ADR 0113 R4: editing a document body is
not sufficient consent to adopt noncanonical frontmatter. Canonical adoption
is a separately named, previewable action.

Granite issued these three rulings on 2026-07-16 with Goga's delegated
architecture authority:

1. select Option C — native by default, strict on demand;
2. keep the strict lane deferred at the MCP boundary;
3. accept separate consent as substrate law, narrowing ADR 0113 R4.

The ADR remains Proposed so Goga can accept or amend the record directly.

This ADR is chartered by
[PROMPT 0002 item 7](../prompts/0002-operating-principles-directives.md)
and continues the docs-native/substrate batch spawned by
[PROMPT 0001](../prompts/0001-tasks-and-vision.md).

## Context

`write_resource` duplicates a capability every coding harness and IDE already
provides: edit a file. That duplication has a visible cost:

- another tool schema consumes context;
- the agent must choose between two textual-edit mechanisms;
- documentation must explain an alternative tool whose value is not obvious
  from its name;
- the agent leaves the native edit path on which its harness is trained and
  optimized.

PROMPT 0002 captures the unresolved conflict directly. Goga dislikes an
alternative to native Edit and the heuristics required to make direct edits
look canonical, but recognizes that `write_resource` protects substrate
validity.

> "i don't like that backlog-mcp is just an alternative tool to what already
> exists, aka Edit file. All the agentic harnesses already come with the Edit
> tool natively… we will get rid of the wasted tokens… but at the same time…
> write_resource actually protects and enforces the substrate's schema
> validity… That introduces lots of heurestics and i kinda don't like that…
> And it mutate's user's files… Maybe its a problem we shouldn't solve and just
> leave it alone."

The answer should not hide either side:

- native file editing is the docs-native north star;
- a post-write watcher cannot provide pre-write validity;
- a managed write does buy a real guarantee, but only when the caller asks for
  it.

The pressure point is therefore:

> Which guarantees belong to ordinary file editing, and which guarantees are
> worth paying for through a backlog-mcp-managed write?

## Constraints

1. **Markdown remains authoritative.** Search, diagnostics, and other indexes
   are derived and rebuildable.
2. **Native editing remains real.** Humans, scripts, IDEs, and unsupported
   harnesses may write the file directly.
3. **No silent source mutation.** Watching, parsing, indexing, and diagnosis
   never change the source.
4. **Lenient reads, strict managed writes.** ADR 0098 and ADR 0113 remain the
   governing precedent.
5. **No LLM in the write or reconcile path.** Validation is deterministic.
6. **Attribution remains truthful.** Absence of hook evidence means unknown,
   not inferred identity.
7. **Hooks are optional.** Harness support is uneven and versioned.
8. **Local-first only.** No D1 parity work is required.
9. **Do not over-engineer.** No correlation protocol, auto-migration engine,
   file-history subsystem, or universal hook framework enters the first slice.

---

# Part 1 — Current-system audit

## `write_resource` is an anchored body editor

`packages/server/src/tools/backlog-write-resource.ts` exposes:

- exact unique `str_replace`;
- line-based `insert`;
- end-of-body `append`.

ADR 0087 removed creation after overlapping create paths caused confusion and
corruption. Creation belongs to canonical create/intent surfaces;
`write_resource` edits an existing entity body.

`packages/server/src/core/edit.ts`:

1. loads the current entity;
2. applies the anchored operation;
3. saves the complete merged entity;
4. records `write_resource` only after the save succeeds.

Docs-native storage routes managed saves through
`ProjectSubstrateRegistry.validateWrite()` before canonical serialization
(`packages/server/src/storage/local/docs-native-filesystem-storage.ts`).
That is the tool's real value: not text replacement, but strict postimage
validation and a synchronous success/failure result.

## Managed operation logging is exact but best-effort

ADR 0094 moved logging into core so MCP, CLI, HTTP, and internal callers could
not drift. Each managed core write receives `WriteContext` and builds one
exactly attributed entry.

The local log is not crash-atomic or durable:

- `recordMutation()` appends after persistence;
- `OperationStorage.append()` returns `void` and swallows append failures.

The honest guarantee is therefore:

> one successful managed write makes one best-effort append attempt carrying
> exact actor, tool, resource, and operation parameters.

This ADR does not introduce a transaction or change that failure policy.

## The watcher is already an invalidation signal

ADR 0112's `ParcelDocsTreeWatcher` sends only "something changed" into
`LocalRuntime`. The runtime collapses bursts, preserves a trailing pass, and
requests full reconciliation.

That is the correct correctness boundary:

- event order is not treated as document history;
- a Git checkout burst is reconciled from final bytes;
- dropped or coalesced events cannot make the event stream authoritative;
- startup reconciliation can rebuild derived state.

The watcher currently refreshes storage/search projections. It does not retain
or expose the discovery and substrate-validation diagnostics needed for a
good native-edit experience.

## Discovery already knows about malformed documents

`packages/server/src/core/document-discovery.ts`:

- preserves the document content;
- records non-fatal `malformed-frontmatter` diagnostics;
- continues discovering the file and neutral filename identity.

Typed storage omits a document whose frontmatter cannot be parsed. The generic
resource path can still expose and search the underlying Markdown. This is the
right bolt-on posture: invalid typed data loses its typed projection, not its
bytes or usefulness.

The smallest missing seam is diagnostic disclosure, not repair.

## ADR 0113 R4 contains the remaining consent question

ADR 0113 says an external document becomes canonical when backlog-mcp is asked
to mutate it. That is coherent for an explicit canonical adoption or semantic
intent.

It is less clearly authorized for a body-only edit. A request to replace one
paragraph does not necessarily authorize:

- reordering frontmatter;
- removing external aliases;
- moving unknown metadata into an extensions bag;
- changing filename or formatting.

ADR 0117 makes that conflict explicit instead of letting implementation choose
silently.

---

# Part 2 — Competitive scan

## Method

Four delegated research tracks reviewed first-party documentation and
repositories:

1. harness lifecycle/tool hooks and Herdr integration management;
2. Basic Memory and Obsidian file/index behavior;
3. Mem0 and Letta managed memory surfaces;
4. Parcel watcher semantics and diagnostic/fix separation.

Claims below distinguish documented behavior from inference.

## Harness hooks: useful, but not portable enough for correctness

Claude Code documents `SessionStart`, `PreToolUse`, `PostToolUse`, and related
events. `PostToolUse` receives the tool name/input and session information
after a successful tool call. Native Edit/Write inputs contain the file path
and edit content. A post hook can report feedback, but it cannot undo bytes
already written.
([Claude Code hooks](https://code.claude.com/docs/en/hooks))

Gemini CLI documents `SessionStart`, `BeforeTool`, and `AfterTool`; pre hooks
may block or modify tool execution, while after hooks observe the completed
tool input/output.
([Gemini CLI hooks](https://geminicli.com/docs/hooks/reference/))

Codex exposes an evolving hook/configuration surface, but the inspected
first-party material does not yet establish one stable native-edit attribution
contract across its write mechanisms.
([Codex configuration schema](https://github.com/openai/codex/blob/main/codex-rs/core/config.schema.json))

Herdr demonstrates the operating model we should copy: explicit per-harness
integration installation, inspection, and removal. It does not prove a
universal file-edit hook or justify silently mutating harness configuration.
([Herdr](https://github.com/ogulcancelik/herdr))

**Steal:** explicit adapter ownership, install/status/uninstall, documented
payload mapping.

**Reject:** hooks as a correctness dependency or a universal abstraction
before two real adapters need one.

## Basic Memory and Obsidian: files can be truth while writes stay explicit

Basic Memory states that Markdown is authoritative and its database/search
state is derived. Its watcher reparses external changes, while its structured
`write_note`/`edit_note` tools remain available.
([technical information](https://docs.basicmemory.com/reference/technical-information),
[MCP tools](https://docs.basicmemory.com/reference/mcp-tools-reference))

Its default `ensure_frontmatter_on_sync=true` may insert missing frontmatter
during synchronization. Formatting is separately opt-in.
([configuration](https://docs.basicmemory.com/reference/configuration))

That is the exact policy line backlog-mcp should not cross: steal file truth
and derived indexing; reject watcher-triggered metadata insertion.

Obsidian's core Vault APIs provide explicit read/transform/write and
frontmatter-mutation surfaces. Core documentation supports file-backed storage
and cache invalidation, but it does not establish a Basic-Memory-style generic
graph reconciler.
([Vault API](https://docs.obsidian.md/Plugins/Vault),
[API definitions](https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts))

Obsidian Linter is a separate, user-enabled plugin with explicit rules and
actions. It is evidence for separating diagnosis/fix from indexing, not an
Obsidian core policy.
([Obsidian Linter](https://github.com/platers/obsidian-linter))

**Steal:** explicit structured write helpers and explicit lint/fix actions.

**Reject:** automatic formatting or frontmatter repair as a side effect of
watching.

## Mem0 and Letta: managed surfaces buy control

Mem0 exposes identified add/update/delete operations and per-memory history
containing event type, old/new values, input, timestamps, metadata, and user
identity.
([Mem0 memory history](https://docs.mem0.ai/api-reference/memory/history-memory))

Letta memory blocks are managed API objects with size limits, explicit update
operations, and optional read-only enforcement. Updating a block replaces the
managed value.
([Letta memory blocks](https://docs.letta.com/guides/core-concepts/memory/memory-blocks))

Letta Code's MemFS is the useful counterexample: memory becomes a normal local
Git repository, direct file editing is supported, and multi-agent work uses
worktrees. Conflict handling then becomes part of the product.
([Letta Code](https://github.com/letta-ai/letta-code),
[MemFS configuration](https://github.com/letta-ai/lettabot/blob/main/docs/configuration.md#memory-filesystem-memfs))

**Implication:** managed APIs genuinely buy validation, limits, attribution,
and stable mutation semantics. They earn a place only when those guarantees
justify leaving the native file path.

## Parcel and editor diagnostics: observe state; separate fixes

Parcel watcher events contain a path and `create`/`update`/`delete` kind.
Events are throttled and coalesced; rename is represented as delete plus
create, and transient pairs may disappear.
([Parcel watcher](https://github.com/parcel-bundler/watcher#watching))

The watcher does not carry:

- file contents or a reliable diff;
- writer/session identity;
- a logical transaction boundary;
- a substrate validation result.

VS Code's extension API reports diagnostics independently from code actions
and formatting providers.
([programmatic language features](https://code.visualstudio.com/api/language-extensions/programmatic-language-features))

**Implication:** reconcile current bytes and report problems. A repair is a
separate explicit action.

---

# Part 3 — Rulings

## R1. Native file editing is the default existing-document lane

Humans and agents normally edit an existing document with their native editor.

Native editing is lenient in timing, not in interpretation:

- the file may be temporarily invalid immediately after a write;
- the watcher requests full reconciliation;
- reconciliation withdraws an invalid typed projection and reports why;
- the original file remains authoritative and unchanged.

Creation, identity allocation, and semantic lifecycle transitions remain owned
by substrate intents and canonical create/update surfaces. Native editing does
not invent a second creation policy.

## R2. Reconciliation validates after write and never repairs source

Every non-empty watcher batch requests the existing full reconciliation.
Reconciliation:

- reads current bytes;
- runs ADR 0112 discovery and ADR 0113 claim/validation;
- refreshes typed and generic projections;
- replaces the current diagnostic set for the home.

It never:

- adds, removes, or reorders frontmatter;
- rewrites YAML or Markdown;
- persists inferred identity, date, or status;
- moves or renames a document;
- runs a formatter or fixer.

Startup/full reconciliation remains the backstop for coalesced or missed
events. Parcel snapshots stay deferred until measured recovery cost requires
them.

## R3. Diagnostics are derived disclosure, not a new storage system

Phase one should thread diagnostics already produced by discovery, substrate
claiming, and canonical validation through the reconciliation result and
active `LocalRuntime`.

The minimum diagnostic shape is:

- home;
- source path;
- severity;
- stable code;
- message;
- optional line/column and substrate type.

The runtime replaces the home diagnostic set on every full pass, so stale
diagnostics disappear when the file is fixed. Persist diagnostics only if a
real cross-process CLI/viewer need appears; do not create a revision database
preemptively.

Minimum disclosure:

- `backlog-mcp diagnostics`;
- viewer/API projection from the active runtime.

Concise hook feedback can reuse that surface later.

## R4. Hooks enrich feedback; they never own correctness or the journal

Hook support is adapter-by-adapter.

An adapter may use:

- `SessionStart` only when needed to establish home/session metadata;
- successful `PostToolUse`/`AfterTool` events for native Edit/Write intent.

A post-edit adapter may submit the harness, session, path, native tool name,
and exact tool input to request reconciliation and return concise diagnostics.
It does not derive the operation from a watcher event.

Neither hook nor watcher appends to ADR 0094's mutation journal. A post hook
may be retried, duplicated, or observe bytes that are immediately overwritten;
without a stable delivery key and postimage proof, direct append would violate
the journal's logged-once semantics. Therefore no path/hash correlation buffer,
managed-write in-flight marker, delayed classification, fallback journal
entry, or duplicate-suppression protocol is required.

If persistent native-edit activity becomes valuable, design it as a separately
named observation stream or expand the journal only after one real adapter
proves an idempotency contract. Version one does neither.

If a hook is absent or fails:

- reconciliation still converges;
- diagnostics still appear;
- only immediate edit-aware feedback is missing.

Do not implement a hook adapter until the diagnostic lane is useful and one
documented harness is selected.

## R5. Hook installation is explicit and reversible

Follow the Herdr operating shape:

```text
backlog-mcp hooks install <harness>
backlog-mcp hooks status
backlog-mcp hooks uninstall <harness>
```

Rules:

- no installation during npm install, server startup, or project discovery;
- preserve unrelated user configuration;
- identify backlog-mcp-owned entries/files;
- reinstall replaces only owned artifacts;
- uninstall removes only owned artifacts;
- show harness trust/approval behavior;
- hook failure never makes a completed native edit fail.

Version one contains one concrete adapter, not a universal hooks framework.

## R6. `write_resource` remains only as the strict managed lane

Use the managed editor when the caller explicitly wants:

- exact anchored replacement/insert/append semantics;
- complete postimage substrate validation before success;
- canonical serialization;
- synchronous validation failure;
- one best-effort, exactly attributed operation-log append attempt.

Its documentation should say:

> Use when you want backlog-mcp to validate and canonically persist an existing
> entity edit before reporting success. For ordinary repository prose edits,
> use your native Edit tool; reconciliation will update indexes and
> diagnostics afterward.

The cost remains explicit:

| Cost | Why it may still be worth paying |
|---|---|
| Extra tool schema/context | The caller selects it for a stronger guarantee. |
| A second edit choice | The choice is native convenience versus strict pre-return validation. |
| Canonical serialization | Managed writes intentionally produce backlog-mcp's canonical form. |
| Non-native edit path | It is an escape hatch, not the default workflow. |

At the MCP boundary this tool is deferred behind the existing discovery
mechanism. It does not tax every session's baseline context, but an agent may
discover it when a schema-critical edit needs pre-return validation. The
strict core/CLI boundary remains available to local operators.

## R7. Messy external frontmatter is indexed and diagnosed, never upgraded uninvited

The native lane:

- preserves exact bytes;
- derives useful title/identity/chronology when possible;
- preserves unknown metadata in the read projection;
- keeps malformed frontmatter generic and diagnosed;
- never canonicalizes the document.

For a parseable but noncanonical document, this ADR recommends:

- an ordinary strict body edit rejects with canonical diagnostics;
- canonical adoption requires a separately named, previewable action;
- only that explicit action may move aliases/unknown metadata or reserialize
  frontmatter.

This ruling narrows ADR 0113 R4: a general body edit is not canonical-adoption
consent. The separate action remains design-only until its own implementation
phase is approved.

## R8. ADR 0094's completeness claim is scoped to managed writes

The operation journal remains exact for writes that pass through backlog-mcp
core.

It is not a complete history of arbitrary filesystem changes:

- unsupported editors may leave no actor/tool entry;
- hook-observed edits are deliberately not appended;
- watcher events do not contain sufficient evidence to reconstruct intent.

Do not weaken the exact managed journal by adding coarse watcher-derived
operations. A future separate "document reconciled" activity stream may exist
if users need it, but it is not the mutation journal.

## R9. One validator serves both lanes

There is one project substrate registry:

- managed writes call it before persistence;
- reconciliation uses it after native persistence to produce typed
  projections and diagnostics.

There is no hook validator, watcher validator, MCP validator, or repair
validator.

## R10. This work is local-only

Hook installation, filesystem watching, and diagnostic disclosure target the
local runtime. No D1 parity adapter, remote relay, or hosted filesystem design
is required.

---

# Part 4 — Options

## Option A — Remove `write_resource`

Native edits plus watcher diagnostics only.

**Benefit:** smallest tool list and one ordinary edit path.

**Cost:** no opt-in pre-write substrate validation; native edits do not enter
the canonical mutation journal.

## Option B — Keep `write_resource` as the required agent write path

**Benefit:** exact anchored intent and strict validation.

**Cost:** preserves the alternative-tool smell and rejects docs-native use.

## Option C — Native by default; strict managed lane on demand

**Benefit:** ordinary editing stays native while strict validation remains
available.

**Cost:** two lanes must be explained honestly.

**Selected:** Option C, by Granite's delegated architecture ruling on
2026-07-16. Goga may amend while the ADR remains Proposed.

## Option D — Native edits plus semantic intents; remove generic strict editing

ADR 0113/0106.5 intents may eventually cover enough real workflows that a
generic managed body editor is unnecessary.

**Disposition:** revisit after actual intent usage. Do not delete the strict
escape hatch based on theoretical coverage.

---

# Part 5 — Smallest engineering plan

No engineering begins until a phase receives an explicit GO.

## Phase A — disclose diagnostics from existing reconciliation

- Preserve discovery/claim/validation diagnostics through the local runtime.
- Replace the current in-memory diagnostic set on each full pass.
- Expose `backlog-mcp diagnostics` and a viewer/API projection.
- Prove malformed documents remain byte-identical and generic-searchable.
- Prove fixing a document clears its diagnostic and restores typed projection.

No hooks, persistence layer, history stream, or source mutation.

## Phase B — reprice the strict lane

- Rewrite `write_resource` documentation around strict guarantees.
- Apply Goga's MCP visibility choice.
- Make logging language accurately say "best-effort append attempt."
- Resolve the ADR 0113 R4 canonical-adoption consent question.

## Phase C — one hook adapter, only if feedback demand remains

- Select one harness with documented native edit payloads.
- Implement explicit install/status/uninstall.
- Use exact hook-observed intent to request reconciliation and return
  diagnostics; do not append it to the mutation journal.
- Measure hook latency, missed events, and usefulness before a second adapter.

No shared hook framework until a second concrete adapter creates common code.

---

# Acceptance criteria

The selected direction is successful when:

1. a native agent Edit and a human editor change converge through the same
   reconciliation path;
2. search/viewer state reflects the final Markdown;
3. malformed frontmatter remains byte-for-byte unchanged and surfaces a
   diagnostic;
4. fixing the source clears the diagnostic and restores typed projection;
5. reconciliation never writes frontmatter, formatting, identity, or inferred
   values;
6. strict managed edits reject an invalid postimage before persistence;
7. strict managed edits attempt one exact attributed journal append;
8. hook absence does not affect correctness;
9. a future supported hook uses exact native tool intent for immediate
   diagnostic feedback without claiming journal completeness;
10. no D1 code is added or expanded.

## Ruling record and remaining gate

Resolved by Granite under delegated authority on 2026-07-16:

- Option C selected;
- strict MCP lane deferred behind tool discovery;
- separate canonical-adoption consent accepted.

One implementation gate remains intentionally empirical: after ordinary
watcher diagnostics are proven, decide whether immediate edit-aware feedback
justifies one harness adapter. Until a phase receives a GO, this ADR is a
Proposed direction—not an engineering mandate.
