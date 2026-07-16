---
title: "0117. The Write Boundary — Native Editing, Hook Attribution, and Strict Canonical Writes"
date: 2026-07-16
status: Proposed
spawned_by: "PROMPT 0002 — docs/prompts/0002-operating-principles-directives.md"
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

# 0117. The Write Boundary — Native Editing, Hook Attribution, and Strict Canonical Writes

**Status:** Proposed — research record and design rulings. Goga chooses the
direction before engineering.

## Decision summary

backlog-mcp should support two deliberately different write lanes:

1. **Native edit — the ordinary, lenient lane.** Humans and agents edit the
   authoritative Markdown with the editor already available to them. A
   docs-tree watcher reconciles the resulting bytes, updates derived indexes,
   and emits diagnostics after the write. It never silently rewrites,
   normalizes, or upgrades the source file.
2. **Strict canonical write — the opt-in lane.** An agent that wants
   pre-write substrate validation, canonical serialization, exact operation
   attribution, and an immediate success/failure result may use
   backlog-mcp's managed write surface. `write_resource` earns retention only
   in this narrower role; it is not the default way to edit a repository file.

Harness hooks improve the native lane when they exist. A `SessionStart` hook
registers session attribution; a successful `PostToolUse`/`AfterTool` hook for
native file editing places tool intent in a bounded attribution buffer consumed
by full reconciliation. Hooks are an enrichment layer, not the correctness
boundary: external editors, unsupported harnesses, hook failures, and dropped
hook events must still reconcile correctly.

This preserves ADR 0113's central law:

- external and historical files are read leniently and losslessly;
- backlog-mcp's own managed writes are strict and canonical;
- neither rule authorizes heuristics to mutate a user's file.

It also asks Goga to rule on one narrow conflict with ADR 0113 R4: whether a
body-edit request is sufficient consent to canonically adopt parseable but
noncanonical metadata. This ADR recommends that adoption remain separately
authorized.

The recommendation is therefore **both lanes, explicitly priced**, not two
equivalent tools competing for the same job.

## Context

`write_resource` currently duplicates an edit capability common coding
harnesses already ship:

- Claude Code has `Edit` and `Write`;
- Codex has patch/file editing;
- Gemini CLI has file replacement/write tools;
- IDE agents and humans already edit repository files directly.

That duplication has a real price:

- another tool schema enters the model's context;
- the agent must choose between two ways to perform the same textual edit;
- docs must explain an alternative whose name says nothing about the value it
  uniquely provides.

PROMPT 0002 records the unresolved human directive directly: Goga dislikes an
alternative tool that repeats native Edit and spends tokens, but also recognizes
that the managed path protects substrate validity; he explicitly rejects
heuristic repair that mutates user files. This ADR preserves that tension rather
than resolving it by hiding one side.

The tool was not pointless, however. It currently buys two properties that a
plain file edit does not:

1. the core write path records an attributed operation entry;
2. the post-edit entity is validated before the managed save succeeds.

ADR 0094 deliberately put operation logging inside core writes so MCP, CLI,
HTTP, and internal callers could not drift. ADR 0113 Phase B strengthens the
same boundary by routing managed writes through the project substrate registry.
Removing `write_resource` without replacing those properties would simplify
the tool list by weakening the write contract.

ADR 0112 changes the pressure point. Markdown under the selected docs home is
the source of truth, and its Parcel-backed watcher requests full
reconciliation after native edits. That makes direct editing viable without
making a cache authoritative. It does not make a watcher an operation log or
a schema gate: a filesystem event carries a path and change kind, not the
writer's intent, session, old/new strings, or a transaction boundary.

The unresolved question is therefore not "tool or files?" It is:

> Which guarantees belong to the default file-native path, which guarantees
> require a managed write, and how do we keep the two lanes honest?

## Constraints

1. **Markdown is authoritative.** Derived indexes, diagnostics, and session
   correlation caches are rebuildable state. The operation log is persistent
   best-effort local audit state under the current implementation; it is
   neither Markdown authority nor reconstructible from the current document
   tree.
2. **Native editing must remain real.** A human, IDE, script, or unsupported
   agent harness can edit a document without routing through backlog-mcp.
3. **No silent source mutation.** Reconciliation never adds frontmatter,
   fixes YAML, changes formatting, invents dates, or moves a file.
4. **Lenient reads, strict managed writes.** ADR 0098 and ADR 0113 remain the
   governing law.
5. **No LLM in the write or reconcile path.** Validation and diagnostics are
   deterministic.
6. **Attribution must be truthful.** Unknown writers are recorded as unknown;
   watcher timing is not evidence of actor identity.
7. **Hooks cannot be required for correctness.** Harness coverage and payload
   fidelity vary.
8. **Local-first only.** Hooks, filesystem watching, and local operation logs
   do not need a D1 parity story.
9. **Do not over-engineer.** No distributed transaction protocol, universal
   hook abstraction, auto-migration engine, or file-history system enters the
   first slice.

---

# Part 1 — Current-system audit

## `write_resource` is an anchored body editor, not a general filesystem API

`packages/server/src/tools/backlog-write-resource.ts` exposes three operations:

- exact unique `str_replace`;
- line-based `insert`;
- end-of-body `append`.

Creation was removed by ADR 0087 after overlapping creation paths caused
confusion and corruption. `backlog_create` owns creation; `write_resource`
edits an existing entity body.

The transport calls `core/edit.ts`, which:

1. loads the entity;
2. applies the anchored text operation;
3. saves the merged entity;
4. records a `write_resource` mutation only after success.

Today, docs-native storage validates built-in entities with `EntitySchema` and
canonically serializes them. ADR 0113 Phase B proposes routing the complete
candidate through the project substrate registry so runtime-defined substrates
receive the same guarantee. The important value is therefore not "it can
replace text." The value is:

- pre-return validation of the complete postimage;
- exact operation parameters for the activity view;
- caller-provided actor attribution;
- a single synchronous result.

## ADR 0094's current completeness claim assumes managed writes

ADR 0094 calls the operation log the canonical write journal and requires every
successful write to produce exactly one attributed entry. That is structurally
true for `createItem`, `updateItem`, `deleteItem`, and `editItem` because
`WriteContext` is mandatory.

A native file edit does not call those functions. Once ADR 0112 makes native
editing a first-class path, the old claim needs a precise amendment:

- managed writes remain exact, attributed operations;
- native writes become observed document reconciliations;
- hook metadata may enrich the observation, but missing metadata must not hide
  the state change.

Pretending both records have equal fidelity would make the log lie.

## The ADR 0112 watcher is an invalidation signal

Quartz's docs-native runtime uses `@parcel/watcher` behind an injected
`DocsTreeWatcher` contract. A non-empty event batch requests reconciliation.
The runtime collapses bursts while preserving a trailing pass, and full
reconciliation remains the correctness boundary.

That is the right foundation:

- watcher events are not applied as entity mutations;
- dropped events cannot make the cache authoritative;
- Git checkout bursts collapse;
- native edits become visible without requiring a backlog-specific tool.

The remaining gap is diagnostics and attribution. Reconciliation currently
answers "what bytes exist now?" It does not answer "who intended what edit?"

---

# Part 2 — Competitive scan

## Method

Four independent research tracks covered:

1. agent-harness lifecycle and tool hooks;
2. Basic Memory and Obsidian's file/index behavior;
3. Mem0 and Letta's managed memory write surfaces;
4. watcher semantics and post-write diagnostic patterns.

Accepted evidence is limited to official documentation, first-party
repositories, and first-party issue/source records where the public contract
is still moving. Absence of documentation is recorded as a gap, not proof that
a capability cannot exist.

## Finding 1 — Claude and Gemini can expose native edit intent

Claude Code's hook envelope includes `session_id`, cwd, tool name, tool input,
and `tool_use_id`; subagent calls may also include `agent_id` and
`agent_type`. Its native `Edit` input carries `file_path`, `old_string`,
`new_string`, and `replace_all`, while `Write` carries the path and content.
`PostToolUse` runs after the write and may return additional context, but it
cannot undo the already-applied file mutation.
([Claude Code hook reference](https://code.claude.com/docs/en/hooks))

Gemini CLI exposes a comparable `SessionStart`, `BeforeTool`, and `AfterTool`
model. Hooks receive a common session envelope; `BeforeTool` can deny or
rewrite arguments, while `AfterTool` receives the original input and tool
response.
([Gemini CLI hook reference](https://geminicli.com/docs/hooks/reference/))

GitHub Copilot CLI and the Copilot SDK likewise expose pre/post tool hooks and
session lifecycle hooks, including audit/logging use cases.
([Copilot hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference),
[Copilot SDK session hooks](https://docs.github.com/en/copilot/how-tos/copilot-sdk/hooks/hooks-overview))

**Implication:** hook-captured edit intent is a proven integration shape. A
portable envelope can normalize required common fields:

- harness;
- session ID;
- cwd;
- canonical file path;
- native tool name;
- native tool input;
- observed time.

Harness-specific tool-use and agent/subagent identifiers remain optional.

## Finding 2 — Hook coverage is not portable enough to own correctness

Claude's native Edit/Write coverage is strong. Gemini's tool hooks are broad.
Copilot has multiple hook surfaces. Codex's public configuration schema
currently exposes a `hooks` feature flag but does not itself document a stable
lifecycle or pre/post-tool event contract. A community-authored tracker in the
first-party repository reports partial pre/post coverage, including incomplete
coverage across write paths.
([Codex hook configuration schema](https://github.com/openai/codex/blob/main/codex-rs/core/config.schema.json),
[Codex full hook-parity tracking](https://github.com/openai/codex/issues/21753))

The installed Codex migration guidance on the development machine is stricter:
it currently treats pre/post-tool migration as shell-focused and warns that
Claude Edit/Write fixups need another boundary. That local observation is
version-specific and must be rechecked before implementation, but it is enough
to reject a universal-hook correctness claim.

Cursor did not expose a comparable first-party native-edit hook contract in
the inspected public material.

**Implication:** the watcher must handle every write correctly without hook
metadata. A hook is an optional attribution and feedback adapter.

## Finding 3 — Herdr proves explicit, per-harness integration management

Herdr's first-party repository documents direct integrations installed with
an explicit per-harness command:

```text
herdr integration install <harness>
```

The installed CLI also exposes matching `status` and `uninstall` commands.
([Herdr repository and integration overview](https://github.com/ogulcancelik/herdr))

This proves a useful operating pattern, not a specific config-merging
implementation:

- one explicit install command;
- one adapter per harness;
- status and uninstall are first-class;
- generated files have clear ownership;
- upgrades replace only owned artifacts.

**Implication:** backlog-mcp should not silently edit harness configuration
during npm installation or server startup. It should offer explicit,
idempotent per-harness installation with inspection and removal.

## Finding 4 — File-first systems accept native edits, but mutation policy matters

Basic Memory calls Markdown the source of truth and its database a derived
index. Its watcher reparses external changes and refreshes the graph/search
projection. It also exposes structured `write_note` and `edit_note` tools.
([Basic Memory technical information](https://docs.basicmemory.com/reference/technical-information),
[Basic Memory user guide](https://docs.basicmemory.com/local/user-guide))

That broad architecture aligns with backlog-mcp. Its current default
`ensure_frontmatter_on_sync=true` does not: missing frontmatter may be injected
during synchronization. Formatting is separately opt-in.
([Basic Memory configuration](https://docs.basicmemory.com/reference/configuration))

Obsidian similarly treats vault files as truth and metadata caches as derived.
Its `Vault.process()` API exists for explicit concurrency-safe mutation, while
external filesystem changes invalidate cached reads. Its public
`processFrontMatter()` method is an explicit mutating API and may throw
`YAMLParseError`; it is not a mandate to rewrite external files.
([Obsidian Vault API](https://docs.obsidian.md/Plugins/Vault),
[Obsidian API definitions](https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts))

Obsidian Linter demonstrates the correct separation: normalization is a
user-enabled plugin action with configurable rules, not an automatic property
of indexing.
([Obsidian Linter](https://github.com/platers/obsidian-linter))

**Steal:** files as truth, derived caches, native editing, explicit structured
write helpers, explicit lint/fix commands.

**Reject:** watcher-triggered frontmatter injection or formatting.

## Finding 5 — Managed API writes buy history and invariants by giving up file-native truth

Mem0 mutations go through identified API operations. Its per-memory history
records add/update/delete events, old and new values, input, timestamps,
metadata, and user attribution.
([Mem0 history API](https://docs.mem0.ai/api-reference/memory/history-memory),
[Mem0 memory operations](https://docs.mem0.ai/core-concepts/memory-operations/add))

Letta's standard memory blocks and archival passages are likewise managed
through agent tools and APIs. Blocks may be read-only, carry limits, and expose
managed mutation tools. Its ordinary filesystem document surface is primarily
a read/search interface.
([Letta memory blocks](https://docs.letta.com/guides/core-concepts/memory/memory-blocks),
[Letta context hierarchy](https://docs.letta.com/guides/core-concepts/memory/context-hierarchy))

Letta Code's newer MemFS mode is the revealing exception: it syncs memory
blocks to local Markdown and uses Git/worktrees for history and collaboration,
but conflict resolution becomes part of the design.
([Letta Code](https://github.com/letta-ai/letta-code),
[lettabot MemFS configuration](https://github.com/letta-ai/lettabot/blob/main/docs/configuration.md#memory-filesystem-memfs))

**Implication:** managed writes genuinely buy validation, audit fidelity, and
stable mutation semantics. They should be retained only where those properties
justify leaving the native edit path.

## Finding 6 — A watcher observes state, not intent

Parcel watcher events carry an absolute path and a `create`, `update`, or
`delete` type. Events are batched and coalesced; a rename appears as delete plus
create, and transient create/delete pairs may disappear. The API also supports
snapshots and changes-since queries, with backend-specific implementation
details.
([`@parcel/watcher`](https://github.com/parcel-bundler/watcher))

It does not provide:

- file contents;
- an edit diff;
- writer identity;
- a tool-use ID;
- a logical transaction boundary.

**Implication:** reconcile current bytes after a quiet window. Do not infer
rename identity, operation order, or attribution from the event batch.

## Finding 7 — Diagnostics and fixes are separate product concepts

Language-server and IDE APIs commonly report diagnostics separately from code
actions and formatting. VS Code's public extension API is a clear example:
diagnostic collections report problems, while code actions and formatting are
explicit mutation providers.
([VS Code programmatic language features](https://code.visualstudio.com/api/language-extensions/programmatic-language-features))

**Implication:** a malformed document should receive a revision-bound
diagnostic with path, hash, rule, message, and optional location. Repair is a
separate explicit command. Reconciliation never acts as a fixer.

---

# Part 3 — Rulings

## R1. Native file editing is the default existing-document lane

An agent or human editing an existing document should normally use the native
editor already available in the harness or IDE.

backlog-mcp documentation and tool descriptions do not teach
`write_resource` as the ordinary way to change prose. This keeps the agent in
its trained edit path and removes the alternative-tool smell from the common
workflow.

Native editing is lenient in timing, not in interpretation:

- the file may be temporarily invalid immediately after the editor writes it;
- the watcher validates and reconciles after the write;
- invalid bytes remain the source of truth and are diagnosed;
- no invalid projection is silently presented as canonical.

Creation and semantic lifecycle changes remain owned by the substrate's
declared intents or canonical create/update surfaces. This ADR does not turn
arbitrary file creation into a replacement for identity allocation.

## R2. Hooks enrich native edits; they never own correctness

Every supported harness adapter may install:

1. a session-start hook that reports the harness, session ID, cwd, and optional
   agent/subagent identity;
2. a successful post-tool hook that reports native file-edit intent.

Both hooks feed a bounded, local path/hash attribution buffer consumed by the
existing full-reconciliation boundary. The post-tool hook never writes the
document and never creates a second validation path.

If a hook is absent, late, duplicated, malformed, or unavailable, the watcher
still reconciles the same final bytes. The only lost property is attribution
fidelity.

Post-write hooks cannot retroactively make a write strict. They may return
diagnostic feedback to the agent after reconciliation, but they cannot claim
the file was validated before mutation.

## R3. Hook installation is explicit, idempotent, inspectable, and removable

The intended CLI shape follows Herdr:

```text
backlog-mcp hooks install claude
backlog-mcp hooks install gemini
backlog-mcp hooks status
backlog-mcp hooks uninstall claude
```

Rules:

- no hook installation during package install, MCP startup, or project scan;
- preserve unrelated user configuration;
- generated shims identify backlog-mcp ownership and version;
- reinstall replaces only owned artifacts;
- config changes are previewed or summarized;
- uninstall removes only owned entries and files;
- harness trust/approval remains visible to the user;
- hook commands have a short timeout and do not make a successful native edit
  fail because backlog-mcp is unavailable.

Version one implements only harnesses whose native edit payload and config
merge are verified. There is no empty "universal hooks framework."

## R4. Watcher reconciliation validates after write and never mutates source

The watcher continues to convert non-empty event batches into ADR 0112
full-reconciliation requests. Full reconciliation compares current documents
with prior derived hashes, discovers and validates through ADR 0112/0113, and
atomically replaces derived indexes and revision-bound diagnostics. Hashes
support stale-result rejection and optional attribution correlation; they do
not create a second per-path correctness path.

The reconciler does not:

- add or reorder frontmatter;
- rewrite YAML;
- format Markdown;
- infer and persist identity/date/status;
- move or rename a file;
- apply a suggested fix.

Startup/full reconciliation remains the correctness boundary and the backstop
for dropped watcher events. Parcel snapshots may accelerate recovery later;
they are not required for correctness.

## R5. Diagnostics are revision-bound derived state

A diagnostic contains at least:

```ts
interface DocumentDiagnostic {
  homeKey: string;
  sourcePath: string;
  contentHash: string;
  severity: 'error' | 'warning';
  code: string;
  message: string;
  line?: number;
  column?: number;
  substrateType?: string;
}
```

Diagnostics live under the home's control directory, outside the watched
source tree. A diagnostic is displayed only while its `contentHash` matches the
current document.

Minimum read surfaces:

- concise hook feedback after a native agent edit;
- `backlog-mcp diagnostics` for humans and unsupported harnesses;
- viewer/API projection when the docs-native runtime is active.

A syntactically malformed frontmatter document remains byte-preserved,
readable, and searchable as a generic document with a diagnostic; it has no
typed projection. A parseable but noncanonical claimed document receives ADR
0113's lenient, lossless projection plus canonical-schema diagnostics.
Previously indexed canonical data must not remain silently current after the
source becomes invalid.

## R6. `write_resource` is retained only as the strict canonical edit lane

`write_resource` remains available for an agent that explicitly wants:

- exact anchored edit semantics;
- full postimage substrate validation before success;
- canonical managed serialization;
- synchronous error reporting;
- exact actor/tool/operation attribution;
- no watcher-correlation ambiguity.

Its description must say when to choose it:

> Use when you want backlog-mcp to validate and canonically persist an
> existing entity edit before reporting success. For ordinary repository prose
> edits, use your native Edit tool; the watcher will reconcile and diagnose
> afterward.

The price is explicit:

| Cost | Why it remains acceptable |
|---|---|
| Extra tool schema/tokens | Deferred/tool-search discovery should keep it out of the ordinary path where supported. |
| A second edit choice | The choice is guarantee-based: native convenience versus strict pre-return validation. |
| Less harness-native behavior | The lane is selected for validation, not edit fluency. |
| Canonical reserialization | Managed writes are intentionally canonical; external formatting is preserved only by the native lane. |

If deferred tool discovery is unavailable, Goga may still choose to remove the
MCP registration and retain only the core/CLI strict editor. That is a product
surface choice, not an architecture change.

## R7. External messy frontmatter is indexed and diagnosed, never upgraded uninvited

The posture is:

- preserve the exact file;
- claim it only through explicit folder/identity/substrate rules;
- derive useful title and chronology through the lenient read adapter;
- expose unknown fields losslessly;
- keep syntactically malformed frontmatter generic and diagnosed;
- project parseable but noncanonical claimed documents leniently and diagnose
  the canonical gap;
- refuse an ordinary strict body edit until canonical adoption is separately
  authorized.

backlog-mcp does not copy Basic Memory's default frontmatter injection.

This ruling explicitly supersedes the automatic-adoption clause in ADR 0113
R4, which says any backlog-mcp mutation adopts an external document into
canonical form. Calling a body-edit operation is consent to change the requested
body text; it is not consent to reorder frontmatter, relocate unknown fields,
or remove external aliases. Canonical adoption requires a separately named,
previewable action.

This is a proposed narrow supersession, not an unnoticed contradiction. Goga
must accept or reject it at the human decision gate. Canonical-adoption UX is
out of scope here and remains owned by ADR 0113.

## R8. The operation log distinguishes exact managed writes from observed native edits

ADR 0094 is amended, not discarded.

### Managed lane

The existing invariant remains:

- write and log happen in one core operation;
- actor and exact parameters are known;
- failure/no-op produces no mutation entry;
- one success entry is attempted with exact attribution.

“One core operation” is ADR 0094's call-boundary invariant, not crash-atomic
coupling between Markdown persistence and the JSONL append.

The current `OperationStorage.append()` swallows append failures, so neither
ADR 0094 nor this ADR may call the journal durable or promise an entry after
I/O failure. The strict lane buys an exact attribution payload and one append
attempt; durable transaction semantics are a separate problem. The managed
logger must report `logged` or `failed` to the correlation marker so
reconciliation can classify the observed transition honestly. An append
failure does not roll back or misreport the already-persisted Markdown write.

### Native lane

The log records the reconciliation that made a changed source document visible:

```ts
interface ObservedDocumentMutation {
  kind: 'document-reconciled';
  sourcePath: string;
  beforeHash?: string;
  afterHash?: string;
  validation: 'canonical' | 'diagnosed';
  attribution:
    | {
        status: 'hook-attributed';
        harness: string;
        sessionId: string;
        toolUseId?: string;
        toolName?: string;
      }
    | { status: 'unknown' };
}
```

The bounded attribution buffer accepts hook metadata keyed by canonical path
and expected postimage hash. Full reconciliation consumes a matching record as
`hook-attributed`; an absent, late, or mismatched record is truthfully
`unknown`. Observed reconciliations use this attribution union rather than the
mandatory managed-write `Actor` contract.

An uninitialized home establishes its current path/hash baseline without
emitting mutation entries. Only transitions from a previously observed
revision are journal candidates. If the derived baseline is missing or
untrusted, full reconciliation rebuilds it without pretending that every
existing file was newly edited.

The log does not claim:

- one entry per keystroke or tool call;
- an exact diff when multiple edits coalesced;
- attribution derived from timing alone;
- transactional coupling between the filesystem write and journal append.

Hook and watcher do not each append an entry. Reconciliation appends once for
the observed state transition.

The local managed-write boundary computes the canonical postimage and hash,
then establishes a runtime-owned in-flight marker keyed by canonical path and
postimage hash before persistent bytes become visible. Reconciliation always
updates derived state, but delays observed-entry classification while a
matching marker is in flight:

- if the managed append succeeds, reconciliation emits no duplicate observed
  entry;
- if the managed operation or append fails after the bytes became visible,
  reconciliation may attempt one observed fallback entry with truthful
  attribution;
- an unmatched or expired marker never suppresses reconciliation or hides a
  transition.

Correlation never relies on timing alone. The marker coordinates audit
classification; it is not a lock, transaction, or second source of truth.

## R9. Strict and lenient lanes share one validator and one reconciliation model

There is one substrate compiler and one project registry.

- The strict lane validates the postimage before persistence.
- The lenient lane parses losslessly, then runs the same canonical validator to
  produce diagnostics after persistence.

There is not a hook validator, watcher validator, MCP validator, and CLI
validator. Transport adapters normalize input and call the shared core.

## R10. This work is local-only and does not extend D1

Hook installation, native filesystem watching, derived file diagnostics, and
path/hash correlation target the local runtime.

The remote/D1 code remains a constrained satellite. No parity adapter, remote
hook relay, or hosted filesystem abstraction is required.

---

# Part 4 — Options and recommendation

## Option A — Remove `write_resource`; native edits plus hooks/watcher only

**Pros**

- smallest tool list;
- no alternative-tool choice;
- all editors use the same file-native path.

**Cons**

- no opt-in pre-write substrate validation;
- operation attribution is harness-dependent;
- strict failure is available only after the file is already invalid;
- unsupported harnesses lose intent-rich logging.

**Verdict:** coherent, but gives up a useful guarantee to save one tool.

## Option B — Keep `write_resource` as the required agent write path

**Pros**

- exact operation capture;
- strict validation;
- predictable activity rendering;
- harness-independent behavior.

**Cons**

- duplicates native Edit;
- spends tool tokens and agent choice on every session;
- keeps agents outside their trained edit path;
- treats ordinary repository files as if they require a remote API.

**Verdict:** rejects the docs-native north star.

## Option C — Native by default; strict managed lane on demand

**Pros**

- ordinary edits are native and cheap;
- humans, scripts, and agents share one source-of-truth workflow;
- hooks improve attribution without becoming mandatory;
- strict validation remains available when it is worth the price;
- external messy files stay lossless and unmolested.

**Cons**

- two lanes must be explained honestly;
- native validation is after the write;
- operation-log fidelity differs by lane;
- hook adapters are harness-specific.

**Verdict:** **recommended.** The lanes are complementary because their
guarantees differ; they are not two names for the same operation.

## Option D — Native edits plus substrate semantic intents; delete generic strict editing

Phase D of ADR 0113 and ADR 0106.5 may eventually make semantic intents rich
enough that a generic strict body editor is unnecessary.

**Verdict:** plausible later simplification. Do not delete the strict escape
hatch before the intent set proves it covers real use.

---

# Part 5 — Smallest engineering plan

This is a design document. No phase starts until Goga selects the direction.

## Phase A — diagnostics in the existing reconcile path

- Extend the existing `BacklogService`/`LocalRuntime` full-reconciliation
  boundary with revision-bound diagnostics and observed-change logging.
- Reuse ADR 0112 discovery and ADR 0113 registry validation.
- Persist revision-bound diagnostics outside `docs/`.
- Ensure invalid files remain readable and are never rewritten.
- Append one honest observed-reconciliation operation.
- Establish an initial path/hash baseline without synthesizing history.
- Expose `backlog-mcp diagnostics`.

This phase works without any hook.

## Phase B — one proven hook adapter

- Add the normalized session/edit hook envelope.
- Implement explicit install/status/uninstall for Claude Code first, because
  its `Edit`/`Write` payload and session attribution are documented.
- Feed hook metadata into a bounded path/hash attribution buffer consumed by
  full reconciliation.
- Return concise post-write diagnostics to the agent.
- Measure missed correlation, duplicate suppression, and hook latency before
  adding another harness.

Do not create adapters for undocumented surfaces.

## Phase C — reprice the strict lane

- Rewrite the `write_resource` description around strict guarantees.
- Use deferred Tool Search registration where the transport supports it.
- Keep the core/CLI strict editor even if Goga removes default MCP exposure.
- Establish the managed path/hash correlation marker before persistence so a
  watcher event cannot double-log the same postimage.
- Make the best-effort append outcome observable to that marker without
  claiming rollback or transactionality.
- Verify strict edits reject a non-canonical external document without
  rewriting it.

---

# Acceptance criteria

The selected design is successful when:

1. an agent can use its native Edit tool on a docs-native entity and the viewer,
   search index, and diagnostics converge without a backlog-specific edit call;
2. the same edit made in an ordinary human editor converges through the same
   reconcile path;
3. a malformed frontmatter edit leaves the file byte-for-byte unchanged after
   reconciliation and surfaces a revision-bound diagnostic;
4. fixing the file clears the diagnostic and restores the canonical typed
   projection;
5. a supported hook attributes the reconciled mutation to the correct
   harness/session/tool use;
6. an unsupported, late, or failed hook still produces a truthful
   observed-reconciliation entry with unknown attribution;
7. watcher plus hook produces one operation entry, not two;
8. a managed write followed by its watcher event produces one exact managed
   append attempt, not a second observed-reconciliation append attempt;
9. `write_resource` rejects an invalid postimage before persistence and logs
   one successful strict edit when the best-effort journal append succeeds;
10. the strict tool is not described as the ordinary prose-edit path;
11. no implementation writes frontmatter or formatting during discovery,
    watching, validation, or diagnostic generation;
12. startup/full reconciliation repairs derived state after missed events;
13. an uninitialized or rebuilt baseline does not synthesize mutation history
    for pre-existing documents;
14. no D1 code is added or expanded.

## Human decision gate

Goga chooses:

1. select Option A, B, C, or D; this ADR recommends Option C;
2. if selecting Option C, choose whether `write_resource` remains MCP-visible
   by default, deferred behind Tool Search, or core/CLI-only;
3. if selecting Option C, accept or reject the proposed supersession of ADR
   0113's automatic-adoption clause;
4. authorize the first hook adapter after the Phase A diagnostics boundary is
   proven.

Until then, this ADR is evidence and a proposed ruling set—not an engineering
mandate.
