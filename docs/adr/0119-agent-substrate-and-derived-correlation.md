---
title: "0119. Agent Substrate — Durable Identity, Derived Work Correlation"
date: 2026-07-16
status: Proposed
---

# 0119. Agent Substrate — Durable Identity, Derived Work Correlation

**Status**: Proposed — design only; no implementation authorized by this ADR

**Driver**: Goga's *One Hundred Pull Requests* pressure: agents are durable
knowledge objects, but modeling them must not turn backlog-mcp into an
orchestrator.

**Grounds in**: North Star; ADR 0094 (mutation attribution); ADR 0106.5
(semantic journal attribution); ADR 0113 (user-defined substrates).

## Decision summary

An Agent is a normal **project-defined substrate**, declared as
`docs/substrates/agent.json`. It is not a compiled builtin.

The Agent entity stores only durable identity knowledge:

- a human-readable title and body;
- one stable, namespaced `identity_key` such as `aime:agate`.

It does **not** store `threads_worked`, task counts, commit counts, current
assignments, runtime status, model choice, or session state.

Task/thread correlation and track record are derived on read from facts that
already have the right owners:

- the operation journal: actor, task context, mutated entity, semantic tool,
  mutation class, timestamp;
- Git trailers: contributing agent, backlog item, commit SHA.

The first consumer is Aime. Aime remains an external client that supplies
stable attribution while it dispatches and executes work. backlog-mcp stores
and projects the evidence; it never dispatches, schedules, retries, starts,
stops, or supervises an agent.

The first product surface, if implementation is later authorized, folds the
derived projection into existing `get(id, context: true)`. There is no new MCP
tool, no agent dashboard, no scoring system, and no generic derived-relation
framework.

## Context

### The north-star boundary is already explicit

backlog-mcp is a store whose orchestrators are external clients
(`docs/NORTH-STAR.md:71-83`). The viewer observes and agents mutate
(`docs/NORTH-STAR.md:98-125`). Adding an Agent must therefore deepen the
storage model without importing Aime's control plane.

The substrate thesis also sets the implementation test: a new durable
knowledge kind should cost one declaration, not a new subsystem
(`docs/NORTH-STAR.md:148-150`, `:230-255`). ADR 0113 has already opened the
runtime entity contract (`packages/shared/src/runtime-entity.types.ts:4-27`)
and current main can compile strict project definitions containing an
arbitrary bounded JSON Schema
(`packages/shared/src/substrates/substrate-definition.schema.ts:37-50`).

### The mutation journal already knows more than an Agent document should copy

The existing journal actor contains:

```ts
interface Actor {
  type: 'user' | 'agent';
  name: string;
  delegatedBy?: string;
  taskContext?: string;
}
```

`OperationEntry` also carries `resourceId`, semantic `tool`, stable
`mutation`, params, result, and timestamp
(`packages/server/src/operations/types.ts:5-30`). Core writes record that
attribution after successful mutation
(`packages/server/src/core/operation-log.ts:33-60`).

This is already the correct source of truth for "agent X mutated entity Y
while working in context Z." Copying those facts into `agents/*.md` would
create a second history that can drift from the journal.

The journal is positive evidence, not a completeness oracle. Local JSONL
append intentionally swallows I/O errors so a failed log write cannot break
the entity mutation (`packages/server/src/operations/storage.ts:18-27`), and
direct Markdown edits bypass the journal. Git can cover committed direct
edits, but an absent journal entry never proves that no work occurred. Every
projection must state which evidence sources were available.

### Today's nine-agent fleet proves both the pressure and the gap

The 2026-07-16 Aime fleet snapshot contained nine named agents:

| Agent | Observed thread / role | What durable evidence exists today |
|---|---|---|
| granite | orchestrator, merge gate | Merge commits exist, but do not structurally name granite. |
| chert | ADR 0116 search/RAG | Branch and terminal state identify the thread; commits are authored as Goga/Claude. |
| basalt | ADR 0113 substrates | Branch and commits identify the work, not the fleet principal. |
| onyx | ADR 0113.1 Requirement disclosure | Branch and commits identify the work, not the fleet principal. |
| quartz | ADR 0112 docs-native homes | Branch and commits identify the work, not the fleet principal. |
| shale | independent reviewer | Some merge subjects contain informal `shale-approved` text. |
| pyrite | Aime delivery/runtime reliability | Evidence lives in the Aime repository, outside backlog-mcp Git. |
| agate | Nisli architect, then this ADR | `52cf4d9` records the Nisli consumer merge and shale review, but not agate as owner. |
| beryl | search/memory architect and reviewer | Some merge subjects contain informal `beryl-approved` text. |

This table is a captured pressure snapshot from `aime fleet` and terminal
reads, not a claim that today's full fleet state can be reconstructed from
the repository. The durable, reproducible falsification evidence is the Git
metadata below. A checked-in nine-agent fixture is an implementation gate so
the next corpus is replayable.

Representative commits demonstrate the limit:

- `b27a700` says the ADR 0113 merge was "beryl+shale approved";
- `b0f7445` says ADR 0116 was "beryl-approved";
- `52cf4d9` says the Nisli resource migration was "shale-approved";
- commits use a general Goga author plus a Claude co-author/session trailer.
  The same Claude session trailer appears across unrelated merges, so it is
  not a unique Aime run identity.

This is valuable human evidence, but not a deterministic agent↔thread
contract. Parsing prose such as `shale-approved`, branch names, terminal logs,
or timestamps would create plausible-looking false correlations. The design
must instead make future evidence explicit and leave today's incomplete
history honestly incomplete.

V1 does not recover reviewer or merger identity. The current fast-forward,
frozen-SHA workflow has no honest post-verdict commit trailer boundary:
adding a reviewer or merger after approval would require rewriting the
reviewed commit or manufacturing a metadata-only commit. Git can prove that a
contribution is reachable from `main`; it cannot prove who reviewed or
fast-forwarded it without a separate explicit fact.

### ADR 0113 relations are not a derived-edge plugin

ADR 0113's relation declarations describe canonical frontmatter fields. Its
in-flight compiler resolves `disclosure.get.relations` only through declared
field/cardinality/target metadata. It has no resolver or executable hook, by
design: project definitions are data and cannot run business logic.

The Agent identity can therefore dogfood ADR 0113 directly. Journal/Git work
edges remain a separate, transport-free read projection. A generic
"derived relation provider" is not introduced until a second real substrate
needs one.

## Rulings

### R1. Agent is a project-defined substrate, not a builtin

The first definition is expressible by current ADR 0113 main:

```json
{
  "$schema": "urn:backlog-mcp:schema:substrate-definition:1",
  "definitionVersion": 1,
  "type": "agent",
  "label": {
    "singular": "Agent",
    "plural": "Agents"
  },
  "folder": "agents",
  "identity": {
    "strategy": "prefixed-number",
    "prefix": "AGENT",
    "minimumDigits": 4,
    "displayTemplate": "AGENT-{key}"
  },
  "schema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "minLength": 1,
        "maxLength": 200
      },
      "type": {
        "const": "agent"
      },
      "title": {
        "type": "string",
        "minLength": 1,
        "maxLength": 300
      },
      "content": {
        "type": "string",
        "maxLength": 2000000
      },
      "identity_key": {
        "type": "string",
        "minLength": 3,
        "maxLength": 200
      }
    },
    "required": [
      "id",
      "type",
      "title",
      "content",
      "identity_key"
    ],
    "additionalProperties": false
  }
}
```

A canonical entity is ordinary markdown:

```markdown
---
id: AGENT-0001
type: agent
title: agate
identity_key: aime:agate
---

Nisli architect and framework owner. Works architecture-heavy framework and
consumer-validation threads.
```

There is no workflow, no status, and no Agent-specific intent. Agent profiles
can be created through docs-native authoring or the existing low-level local
write path. A new public tool has not earned its context cost.

Fields deliberately omitted from v1:

- current goal, branch, worktree, pane, heartbeat, availability;
- model/provider, token usage, context size;
- role, because fleet law says identity is stable while roles move;
- sessions, assignments, queues, retries, deadlines;
- stored work/history aggregates.

Those are either transient orchestration state or derived facts.

### R2. `identity_key` is the stable join contract

`title` is display text. `identity_key` contains the exact, namespaced
principal key supplied by the first external client:

```text
aime:agate
```

The operation journal's `actor.name` and Git's `Backlog-Agent` trailer use the
same key. Display-name changes therefore do not rewrite history.

The JSON Schema deliberately does not enforce a namespace pattern because
ADR 0113 rejects project-authored regex. The Agent resolver enforces the
smallest grammar:

- exactly one `:` separator;
- non-empty namespace and local key;
- no ASCII whitespace;
- the schema's existing 200-character maximum.

An invalid key leaves the Agent document readable but excludes it from
correlation with a visible diagnostic.

Resolver behavior is fail-closed:

- zero matching Agent entities → evidence remains unattributed;
- one matching Agent entity → correlation is valid;
- more than one matching Agent entity → emit a duplicate-key diagnostic and
  attribute to neither.

No fuzzy matching, case folding, title matching, or "closest known agent" is
allowed. ADR 0113's schema can store the key today; uniqueness across
entities belongs to the future projector's deterministic identity index, not
to a new substrate capability.

Multiple aliases and cross-orchestrator identity linking are deferred. If one
real Agent must later correlate evidence from two stable external principals,
the schema can evolve from scalar to array in one deliberate migration. V1
does not pre-build that case.

### R3. Correlation is an evidence projection, never an Agent field

The derived unit is conceptually:

```text
(agent identity, backlog subject, role, source evidence, timestamp)
```

It is built from these explicit facts:

| Source | Agent fact | Subject fact | Derived role | Source evidence |
|---|---|---|---|---|
| Operation journal | `actor.type=agent`, `actor.name` | `actor.taskContext` when it is an exact entity ID | `worked-in-context` | journal timestamp + entry |
| Operation journal | `actor.type=agent`, `actor.name` | `resourceId` | `mutated` | journal timestamp + semantic tool/mutation |
| Git commit | exactly one `Backlog-Agent` trailer | one or more `Backlog-Item` trailers | `contributed` | commit SHA + committer timestamp |

Recommended Git shape:

```text
Backlog-Agent: aime:agate
Backlog-Item: ADR 0119
```

Git evidence is read only from commits reachable from the project repository's
local `main` ref. If `main` is absent or unreadable, Git is an unavailable
source; v1 adds no branch-name configuration.

The Git evidence timestamp is the commit's committer timestamp, normalized to
UTC. It is part of the immutable commit object addressed by the SHA and does
not imply that the committer is the contributing agent.

Trailer parsing is fail-closed:

- exactly one `Backlog-Agent` occurrence is required; zero, duplicate, empty,
  malformed, or conflicting occurrences produce no contribution edges for
  that commit and emit a diagnostic;
- one or more `Backlog-Item` occurrences are required;
- each item must be a canonical entity display ID that resolves in the active
  project home—for example `ADR 0119`, not `ADR-0119`;
- duplicate item values collapse to one;
- malformed or unresolved items are excluded individually with diagnostics,
  while valid sibling items remain;
- an invalid contributor never inherits otherwise-valid item trailers.

One contributing agent owns every valid item on the commit. If
multi-contributor pairwise attribution becomes common, that pressure may
justify a structured work trailer later; it is not anticipated now.

The following are not evidence:

- commit author/co-author alone;
- branch/worktree names;
- prose in commit subjects such as `shale-approved`;
- `Reviewed-by`/`Merged-by` prose or trailers in v1;
- file ownership;
- temporal overlap between an Aime pane and a commit;
- terminal transcripts or fleet-message scraping.

`delegatedBy` remains visible journal provenance but is not an agent↔agent or
agent↔task edge in v1 because its current semantics are not constrained to one
identity kind.

### R4. The projection is folded into `get(context: true)`, not a new tool

If implementation is authorized, `get(AGENT-0001, context: true)` returns the
ordinary Agent document plus a bounded Agent-specific `work` projection. It
does not masquerade as an ADR 0113 relation group.

Current main only composes `get(context: true)` for built-in entities and its
context result has a closed set of groups. Slice B therefore explicitly
widens the core `GetItem`/MCP formatting path for Agent work evidence; it does
not rely on an already-generic relation renderer.

Each work stub contains only:

- subject id, type, and title;
- observed roles;
- most recent evidence timestamp;
- source kinds (`journal`, `git`).

Evidence rows are grouped by canonical subject ID. Roles and source kinds are
sets, so one journal entry that supplies both `taskContext` and `resourceId`
for the same subject produces one stub with both roles, not two work items.

The projection contract is:

- sort by `last_evidence_at` descending, then subject ID ascending;
- return at most 20 work stubs;
- return `work_omitted` as a nonnegative integer equal to the number of
  distinct matched subjects excluded by the 20-item cap (`0` when none are
  omitted);
- return source coverage as `consulted` and `truncated` booleans for journal
  and Git separately;
- never label either source complete, because journal append may fail and
  native edits may bypass it.

Full journal entries and commit metadata remain in their existing source
surfaces rather than being copied into the Agent result. The default is names
and shape, not an activity dump.

This projection is a compiled core/read feature keyed to an Agent entity. It
does not become a new relation declaration or registry hook. ADR 0113
relations continue to mean canonical entity fields. If a second real
substrate later needs heterogeneous derived edges, that is the trigger to
design a general seam.

No evidence handle or evidence-count promise is added in v1 because journal
entries have no stable ID. No wakeup section, recall special case, search
ranking change, viewer work, dashboard, or MCP tool ships in the first slice.

### R5. Aime supplies attribution; backlog-mcp never controls Aime

Aime is the first client and owns:

- agent creation/dispatch;
- current goals, panes, state, retries, and completion;
- injecting `BACKLOG_ACTOR_TYPE=agent`,
  `BACKLOG_ACTOR_NAME=aime:<name>`, and an exact
  `BACKLOG_TASK_CONTEXT` when its worker calls backlog-mcp;
- adding explicit Git trailers at its commit boundary.

backlog-mcp owns:

- validating and storing Agent markdown;
- persisting journal facts through the existing write boundary;
- reading explicit Git trailers;
- resolving identity keys;
- returning a bounded derived projection.

backlog-mcp does not call the Aime daemon, watch panes, inspect queues,
dispatch work, request reviews, merge branches, restart agents, or update an
Agent entity when live fleet state changes. Aime may disappear tomorrow and
the stored Agent documents, operation journal, and Git evidence remain valid.

### R6. "Track record" means evidence, not a score

The first projection answers:

- which project threads have explicit evidence for this agent;
- what kind of participation is evidenced;
- when the latest evidence occurred;
- which evidence sources contributed to the claim.

It does not answer "which agent is best." There is no success rate, quality
score, leaderboard, reliability rank, model comparison, or automatic
assignment recommendation.

A completed task or merged commit is an outcome fact, not proof of individual
quality. Reviewer intervention and shared work make a scalar grade dishonest.
If a human later wants a retrospective judgment, that judgment is a separate
human-readable Artifact or Memory with cited evidence.

The first projection is home/project-scoped. A cross-repository biography is
not built merely because today's fleet spans backlog-mcp, Nisli, and Aime.
Cross-home aggregation requires a real retrieval question and an explicit
identity-ownership ruling.

### R7. Implementation is staged S then M, only after approval

This ADR delivers design only. If implementation is authorized:

#### Slice A — attribution dogfood (`S`)

1. Add `docs/substrates/agent.json`.
2. Add nine representative Agent fixtures/documents using stable Aime keys.
3. Make Aime emit stable journal attribution and the Git trailer contract.
4. Prove the definition compiles and round-trips through current ADR 0113
   storage.
5. Capture a fresh fleet run; do not backfill today's ambiguous history.

This slice changes no backlog-mcp generic storage, journal schema, viewer, or
MCP surface.

#### Slice B — bounded work projection (`M`)

1. Add a transport-free Agent identity resolver and pure evidence projector
   under `packages/server/src/core/`.
2. Supply journal entries and parsed Git trailers through injected read
   ports; core does not shell out or read ambient process state.
3. Add an Agent-specific optional work projection to core `GetItem` and the
   existing MCP `backlog_get` formatter; do not route it through the current
   built-in-only relation composer.
4. Add unit fixtures for the nine-agent corpus, ambiguity, missing sources,
   malformed trailers, and deterministic ordering.

No D1 work, cross-home aggregation, session substrate, analytics store, or
generic derived-relation framework is included.

### R8. The design is falsifiable

An implementation is acceptable only if a checked-in nine-agent fixture
proves:

1. every explicit journal/trailer correlation is recovered;
2. no correlation is created from an unstructured current-era commit such as
   `b27a700`, `b0f7445`, or `52cf4d9`;
3. duplicate `identity_key` values fail closed with a visible diagnostic;
4. renaming an Agent title does not break prior evidence;
5. removing source evidence removes the projection edge—there is no hidden
   aggregate copy;
6. absent Git or journal input produces an honest partial-source result, not
   a completeness claim;
7. result order, 20-item cap, `work_omitted`, and per-source
   consulted/truncated flags are deterministic;
8. malformed/duplicate `Backlog-Agent` invalidates that commit's contribution
   edges, while invalid `Backlog-Item` values do not erase valid siblings;
9. the MCP tool count and operation journal schema are unchanged;
10. no code path dispatches, schedules, executes, retries, supervises, or
   scores an agent.

Evidence that would change these rulings:

- a second real substrate needs a heterogeneous journal/Git-derived
  projection → design a general derived-projection seam;
- stable external identity keys prove impractical across real Aime sessions
  → revisit R2 before adding fuzzy matching;
- repeated real work requires curated agent↔task claims that neither journal
  nor Git can express → add the smallest explicit authorial relation, with
  precedence over derived evidence;
- the primary user question is demonstrably cross-repository → design
  cross-home identity ownership and aggregation separately.

## Rejected options

### Add Agent as a compiled builtin

Rejected. Current ADR 0113 can express the durable identity document. A
builtin would bypass the mechanism this feature is supposed to prove and
would require package releases for project vocabulary.

### Persist `threads_worked`, task IDs, commits, counts, or `last_seen_at`

Rejected. Every field duplicates journal or Git evidence and will drift. These
are projections, not authored Agent facts.

### Persist every Aime assignment or session as a backlog entity

Rejected. It imports orchestration event volume and lifecycle into the store
before a durable session object has earned its existence. Current goals and
panes remain Aime state.

### Scrape Aime messages, terminal output, branch names, or commit prose

Rejected. The current corpus proves those signals are suggestive, not
deterministic. The store must prefer explicit false negatives over plausible
false positives.

### Add a generic derived-relation plugin to ADR 0113

Rejected. ADR 0113 relations are typed canonical data and project definitions
cannot execute code. One Agent projection does not justify a framework.

### Add `backlog_agent_history` or an Agent dashboard

Rejected. `get(context: true)` is the established expansion language. A new
tool adds context cost; a dashboard invites scoring and orchestration controls
before the evidence projection has proven useful.

## Consequences

Positive:

- Agent identity becomes human-readable, searchable project knowledge.
- Work correlation is deterministic where evidence exists and honest where it
  does not.
- The operation journal and Git remain the sources of truth for events.
- Aime can consume the store without the store depending on Aime.
- ADR 0113 is dogfooded rather than bypassed.
- The first implementation remains small: one declaration, one attribution
  contract, one bounded read projection.

Costs:

- Today's fleet history remains incomplete because stable attribution was not
  emitted prospectively.
- External clients must carry stable identity and task context.
- Git trailer discipline becomes part of the commit boundary.
- The first projector is intentionally Agent-specific core code.

Risks:

- Identity-key reuse can misattribute history; duplicate resolution must fail
  closed.
- The journal deliberately tolerates append failure, so derived work history
  can be incomplete. The projection must expose source coverage and never
  claim exhaustiveness.
- Consumers may mistake work presence or recency for quality. Naming and UI
  must keep the surface descriptive, not evaluative.
- A specialized projection can become a precedent for ad hoc type branches.
  R8's second-substrate trigger prevents premature generalization.

## Parked questions for Goga

These do not block the design:

1. Public product language: **Agent**, **Contributor**, or another name.
   Naming is Goga-only; this ADR uses Agent because the source idea does.
2. Whether the first production query should remain project-local or become a
   cross-home agent biography. Recommendation: project-local first.
3. Whether Aime writes Git trailers automatically or makes them part of the
   worker commit protocol. Either is an external-client choice; the
   store contract is the same.
4. Whether reviewer/verdict/fast-forward attribution later deserves its own
   explicit Aime→store fact. V1 intentionally does not infer it from Git.

## References

- `docs/NORTH-STAR.md`
- `docs/adr/0094-transport-agnostic-operation-logging.md`
- `docs/adr/0106.5-intent-write-surface.md`
- `docs/adr/0113-user-defined-substrates.md`
- `packages/shared/src/substrates/substrate-definition.schema.ts`
- `packages/shared/src/runtime-entity.types.ts`
- `packages/server/src/operations/types.ts`
- `packages/server/src/core/operation-log.ts`
- [One Hundred Pull Requests](https://gkoreli.com/one-hundred-pull-requests)
