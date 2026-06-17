---
title: "0107. Loro-as-Truth — A Local-First CRDT History Substrate for backlog-mcp"
date: 2026-06-17
status: Proposed
backlog_item: EPIC-0046
thread_root: true
children: [0107.1, 0107.2, 0107.3, 0107.4]
supersedes_premise_of: [0089, "write_resource design behind 0001/0087"]
---

# 0107. Loro-as-Truth — A Local-First CRDT History Substrate

**Date**: 2026-06-17
**Status**: Proposed (thread root — design-first; no code until ratified)
**Backlog**: EPIC-0046
**Thread children**: 0107.1 (domain mapping) · 0107.2 (op capture) · 0107.3 (storage) · 0107.4 (sync)
**Continues**: the 0106 storage/vocabulary thread (`StorageAdapter` seam from 0106.3 is the integration point)

---

## Problem Statement

backlog-mcp has been **reinventing version control, badly**, across three layers — and the pain finally surfaced as "the diff viewer is useless and I don't look at it."

- **The op-log is growing into a VCS.** `operations.jsonl` records mutations; the activity panel renders them. But it has no file context (diffs show the snippet at "line 1"), no grouping (100 agent edits = 100 loose rows), no time-travel, no revert. Every attempt to fix it (snapshot bodies, full-file diffs) is *more* reinvention.
- **`write_resource` replaced the agent's native `Edit`.** Built on a remote-first premise (data lives where the agent can't reach it → must go through a server RPC). That premise drove a custom `str_replace`/`append`/`insert` API, which in turn forced custom diff rendering, grouping, history — the whole pipeline a filesystem + git already provide.
- **No coherent history/diff/time-travel** exists for entities, despite the data being the perfect shape for it.

**Root cause**: two half-built history systems (op-log + a manual end-of-day `git` habit in the data dir), neither good, both maintained. The op-log does *attribution/liveness* well and *content history* badly; git would do *content history* well but isn't wired in.

> Chain of thought that got us here (preserved so the decision is auditable):
> remote-first `write_resource` → "I'm reinventing git" → considered git-as-history → considered Loro → "am I over-building like write_resource?" → established the *real* requirement is **history + native editing + single-writer-now/multi-agent-later**, not concurrency-today → confirmed disk-sync covers single-device remote but **conflict-copies under concurrency**, which only a CRDT solves → confirmed the conflict problem is a **capture-mechanism** problem (lossy file snapshots), fixable by capturing the agent's **native `Edit` op** via hooks → confirmed Loro's "missing automerge-repo" is a **packaging illusion** (storage glue is ~100 lines; sync glue already exists). Landed on Loro.

## North Star

**Loro is the durable source of truth and history. Plain markdown is a projection the agent edits natively. Edits are captured as clean ops, not lossy snapshots. The multi-agent future merges, it does not conflict-copy.**

- One history substrate (Loro), not two half-built ones (op-log + manual git).
- The agent keeps its **native `Edit`/`Write`** — no custom write API.
- History/diffs/time-travel/revert come from the substrate **for free** — stop reinventing.
- Single-writer today is just the **degenerate case** of multi-writer tomorrow — same code scales, no rewrite.

## Goal (what "done" looks like)

- Entity truth lives in a `LoroDoc`; `.md` files are a faithful projection for native editing + human/git readability.
- The op-log demotes from "content history" to a **thin event index** (liveness/SSE/attribution) that *points at* Loro versions — it stops trying to be a VCS.
- Diffs, time-travel, and revert are served by Loro (`doc.diff`, `checkout`, fork) and rendered by the viewer (diff2html, already a dependency).
- The multi-agent path is concrete: agents are Loro **peers** that merge.
- All of it drops into the **`StorageAdapter` seam built in ADR 0106.3** — no architectural upheaval.

---

## Options Considered

### Option A — Keep enriching the op-log (snapshot bodies, full-file diffs)
Store full before/after content per edit; viewer diffs full-file.
- **Pro**: no new dependency; works local + cloud; fixes the immediate diff bug.
- **Con (fatal)**: this **is** reinventing version control — storing redundant content copies to compute diffs is exactly what git's object store / Loro's oplog already do, better. Gives visibility only; no time-travel, no revert, no multi-agent path. A third half-built history system.
- **Verdict**: Rejected. It's the mush between the two real answers (git or CRDT).

### Option B — Git as the history substrate (git-as-library, or `jj`)
Programmatically commit the data dir per agent-turn; `git log`/`git show` = op-log + diffs.
- **Pro**: stops reinventing (you *use* git); perfect contextual diffs free; plain files; native edits; sync via push. Smallest immediate build.
- **Con (fatal for the stated trajectory)**: line-based, **conflict-copies under concurrency**. Cannot reach the multi-agent-concurrent-write destination without being ripped out. Filesystem-coupled. Collides with the user's *manual* end-of-day git habit if the product also commits.
- **Verdict**: Rejected **because of the multi-agent destination**. Would be the right call *if* single-writer were the permanent steady state. It is not (the project already runs multiple agents; delegation is routine).

### Option C — Loro (CRDT) as the truth/history substrate, via `@loro-extended`  ← **SELECTED**
`LoroDoc` = truth; `.md` = projection; edits captured as ops; agents as peers later. Substrate framework = **`@loro-extended`** (not raw `loro-crdt`).
- **Pro**: full history + time-travel + fork + shallow-snapshot built in; **the only option that scales single-writer→multi-writer with no rewrite** (single-writer is the degenerate case); `LoroTree` natively models the `parent_id` hierarchy; ships an **official agent skill**; compact encoding + fast load. **`@loro-extended` supplies the repo/sync/storage/schema layer off-the-shelf** (`repo`, `change`, websocket/webrtc/sse/http-polling, indexeddb/leveldb/postgres) — *and the operator already runs it in another project* (validated, lowest-risk).
- **Con (accepted, see Risks)**: binary truth-store; the file↔doc projection needs an op-capture bridge (hooks/watcher) that has coarse boundaries on *structural* file edits; substrate validity is an **app-layer** concern (CRDTs don't enforce write-time invariants); the doc↔markdown-file projection is **net-new** (no packaged library in either ecosystem) — but it's an *adapter to write against `@loro-extended`'s `StorageAdapter`*, not a system to invent.
- **Verdict**: **Selected.** Only substrate consistent with the full trajectory (history now, concurrent multi-agent later) while preserving native editing and local-first — and `@loro-extended` makes it the lowest-risk build because the operator already uses it.

### Why not Automerge / Yjs / json-joy (the CRDT field)
- **Yjs**: history **pruned by default** — a current-state sync engine for editors. Getting our op-log/time-travel means reinventing the history layer Yjs chose not to keep. Wrong category for a history-first store. (Would win for a live collaborative *editor*; we aren't building one.)
- **json-joy**: current-state + micro-benchmark focus; history/time-travel not its center. Wrong category. Smaller ecosystem.
- **Automerge**: genuinely fits (full git-like history; `automerge-repo` bundles storage+network; **`pushwork` is a real bidirectional dir↔CRDT sync tool from Ink & Switch** — the closest packaged doc↔file bridge in any ecosystem). **The deciding factors went to Loro**: (1) `LoroTree` fits our hierarchy natively (Automerge = nested maps); (2) official **agent skill**; (3) compact encoding/fast load; (4) **`@loro-extended` matches `automerge-repo`'s batteries** (repo+sync+storage+schema) — the "Automerge has batteries, Loro is DIY" advantage is gone; (5) **the operator already runs `@loro-extended`** — decisive risk reduction. `pushwork` is dir-of-arbitrary-files, not entity-aware markdown, so the projection layer is net-new either way → not a differentiator. Rich-text — the column comparison matrices obsess over — is a **non-factor**: we edit markdown via files/hooks, not inside the CRDT.

---

## Decision

Adopt **Loro via `@loro-extended`** as the durable source-of-truth and history substrate, local-first, with markdown projection and op-capture via the agent's native edit path. Execute as the 0107 thread:

- **0107.1 — Domain mapping**: entity → Loro containers, modeled with **`@loro-extended/change`** typed schemas. `LoroMap` for frontmatter (LWW fields), `LoroText` for the body, `LoroTree` for the `parent_id` hierarchy. Substrate Zod schema stays the **app-layer validity gate** (CRDTs don't validate at write time; `change` schemas complement, not replace, Zod).
- **0107.2 — Op capture**: the `PostToolUse` **hook** is the primary, high-fidelity seam — it delivers the agent's *intended* op (`Edit` = `{file_path, old_string, new_string}`) plus `session_id`/`agent_id`/`agent_type` (turn-grouping + multi-agent attribution for free). The file-watcher is a **lossy fallback** for non-hook editors.
- **0107.3 — Storage + projection (the net-new piece)**: a `MarkdownStorageAdapter` against **`@loro-extended`'s `StorageAdapter`** (`key: string[] → bytes`, same shape as the 0106.3 seam). It persists the CRDT (blob) AND projects readable `.md`; the **Loro→file** half subscribes via `DocHandle` to re-materialize on remote changes (with loop-breaking). No packaged library exists for this in either ecosystem (Automerge `pushwork` / Loro `ResearchOS`/`HoloScript` are the references) — it is the one component we build.
- **0107.4 — Sync (future)**: agents as **peers** via **`@loro-extended`'s websocket/webrtc/sse adapters** (richer than Loro's own `loro-protocol`). Merge, not conflict-copy. **Not built until concurrent multi-agent writing is a live requirement** — but the substrate choice keeps the door open with no rewrite, and `@loro-extended` already implements the synchronizer.

---

## Distilled Insights (the load-bearing realizations)

- **Conflict copies are a *capture* problem, not a substrate problem.** A file-watcher captures *results* (a post-hoc snapshot) and reverse-engineers ops via Myers diff → ambiguous under concurrency → conflict copy. The agent's native `Edit` **already emits the operation** (`old_string→new_string`). Capture at the **tool-call boundary** (hook), not the filesystem, and the op is clean and intentional. *(Evidence: gnick18/ResearchOS `external-edit.ts` — production file↔CRDT bridge — explicitly accepts coarse "unclean" boundaries and writes conflict copies precisely because snapshot reconstruction is lossy.)*
- **Agent-to-agent via Loro ops merges; file-watcher-on-top conflict-copies.** The clean multi-agent story is "agents are peers exchanging ops." The conflict copies only appear at the *file projection* boundary — keep that a human-convenience layer, separate from the agent-peer path.
- **The "automerge-repo for Loro" EXISTS — it's `@loro-extended` (SchoolAI).** Initial take was "missing / a packaging illusion"; that was wrong. `@loro-extended` is a mature multi-package toolkit explicitly "for building local-first applications and **multi-agent systems** with Loro": `@loro-extended/repo` (the automerge-repo analog — `Repo`, `DocHandle`, an abstract `StorageAdapter`, a synchronizer, permissions, middleware), `@loro-extended/change` (schemas, typed docs, typed `LoroTree` refs, diff-overlay, json-patch), storage adapters (indexeddb, **leveldb**, **postgres**, in-memory), and a *richer* network-adapter set than Loro's own (`websocket`, `webrtc`, `sse`, `http-polling`). **The operator already runs `@loro-extended` in another project** — lowest-risk substrate choice, validated by hands-on use, not speculation. (Loro's own `loro-protocol`/`loro-websocket`/`peer-lease` remain a lower-level alternative, but `@loro-extended` subsumes them.)
- **`@loro-extended`'s `StorageAdapter` is the SAME shape as ours (and Automerge's): `key: string[] → bytes`, `load`/`save`/`remove`/`loadRange`/`removeRange`.** Three independent designs (ADR 0106.3 `StorageAdapter`, automerge-repo nodefs, `@loro-extended/repo`) converged on `key→bytes`. Strong signal we're on a trodden path; `@loro-extended` slots into the 0106.3 seam rather than fighting it.
- **The ONE genuinely missing piece — for BOTH ecosystems — is a packaged doc↔markdown-file projection.** Every existing storage adapter (automerge nodefs, `@loro-extended` indexeddb/leveldb/postgres) stores **CRDT blobs**, not editable `.md`. doc↔file (entity-aware markdown, native `Edit`) is unpackaged: Automerge has `pushwork` (Ink & Switch — bidirectional *directory* sync, command-driven, not entity-aware markdown); Loro has **only bespoke app code** (`gnick18/ResearchOS` `external-edit.ts`, `brianonbased-dev/HoloScript` `crdt-sync.ts`), **no library**. So the markdown-projection bridge is net-new work regardless of substrate — but `@loro-extended`'s `StorageAdapter` + `change` schema + `DocHandle.subscribe` make it a *adapter to write*, not a system to invent.
- **Single-writer is the degenerate case of multi-writer.** A CRDT handles one peer fine today; the *same* code handles N peers later. Adopting *after* a concurrency bug is the painful order; adopting now (while single-writer) validates the plumbing cheaply.
- **Rich-text support is a non-factor for us.** We don't edit inside the CRDT; we edit markdown files. Loro's native rich text / Yjs's ProseMirror bindings are irrelevant to the decision — `LoroText` is used as plain text + history.
- **`write_resource` and "adopt Loro now" are NOT the same over-build.** `write_resource` paid for a remoteness that disk-sync subsumed cheaply. Multi-agent concurrent merge has **no cheaper alternative** — every non-CRDT option conflict-copies. Different category; the prior caution does not transfer.
- **`update()` has a Myers-diff cost caveat** (slow > ~50k chars → use `updateByLine`). Irrelevant for markdown task bodies, but it confirms snapshot-reconciliation is a convenience with edges, not a free firehose — another reason to prefer hook-captured ops over watcher snapshots.

## Risks & Tradeoffs (honest accounting)

- **Binary truth-store.** Truth is a `LoroDoc` blob, not the `.md`. Mitigation: markdown projection in `save()` keeps files readable/grep-able/git-committable; the manual EOD git habit becomes optional, not broken.
- **There is NO native two-way file↔Loro sync — a bidirectional bridge is intrinsic and unavoidable.** Loro holds an in-memory doc serialized to binary; a `.md` file is plain text; the two have no inherent connection. *Something* must translate both directions, always:
  - **File → Loro** (agent edits): the hook (high-fidelity, gives the op + actor/session) or the watcher (lossy fallback). **The hook does not remove the bridge — it IS the bridge**, just better-positioned than the watcher.
  - **Loro → File** (the *harder, unavoidable* half): when a remote peer's edit syncs in, the file is stale and must be re-projected. Hooks **cannot** do this (they fire only on the agent's own tool calls, not background doc changes). Requires a **daemon subscribed to `doc.subscribe()`** that materializes markdown — and that write re-triggers the watcher/looks like a new edit, so **loop-breaking** (content-hash / self-write suppression) is mandatory. The MCP server process is the natural daemon host.
  - This bidirectional bridge is the **single most complex, most bug-prone component** of Loro adoption, and it is *intrinsic* to "binary CRDT truth + plain-file editing," not incidental. Contrast: **git needs no bridge** — it operates on the files directly; the files ARE the truth. The bridge is the price Loro charges for concurrent merge; it is justified **only** by the multi-agent future. *(Evidence: ResearchOS `external-edit.ts` is exactly this bridge, and they deferred the live `fs.watch` path to "Phase 4" because it is hard — their shipped version is detection-at-open-time only.)*
- **Op-fidelity of `Edit` at the hook.** `Edit`'s `old_string/new_string` is a splice *intent*, but the tool may rewrite the whole file on disk. Open question (0107.2): splice into `LoroText` by matching `old_string`, with `LoroText.update(newContent)` as the fallback. Even worst case the hook beats the watcher (fires synchronously with intent, carries actor/session).
- **Validity outside the merge.** CRDTs don't enforce write-time invariants; the substrate Zod parse must run app-side on projection/ingest (0107.1/0107.3). This is a real seam, not free.
- **Structural file edits → coarse boundary.** External whole-file restructuring (reorder/add/remove via a non-hook editor) can't be reverse-engineered into clean ops; accept a snapshot boundary (ResearchOS "unclean" path). Keep *structural* changes MCP-tool-driven; let *body prose* be native.
- **Assembly cost vs Automerge.** ~100 lines of storage glue + composing the sync packages. Accepted — proven small, and fits the existing `StorageAdapter` seam.
- **Hook coupling.** `PostToolUse` is Claude-Code-specific; other harnesses won't fire it. Mitigation: file-watcher fallback as the universal (lossy) capture path.

## Consequences

- **Positive**: one history substrate; native editing preserved; real diffs/time-travel/revert; the op-log shrinks to an event index; a no-rewrite path to concurrent multi-agent; `LoroTree` fits the domain; fits the 0106.3 seam.
- **Negative**: binary truth; an op-capture bridge to build and harden (loop-breaking, fidelity); validity enforcement moves app-side; new dependency surface.
- **Supersedes the premise of**: ADR 0089 (Cloudflare Workers + D1 as a *write* backend — demotes to sync target / read-replica or out of scope under local-first) and the remote-first premise behind `write_resource` (0001/0087). These are premise reversals to ratify in the thread, not yet executed.

## Open Questions (resolved in children)

1. `Edit` → `LoroText` op fidelity: positional splice vs `update()` fallback? And the harder reverse — the `Loro → file` re-projection daemon (`doc.subscribe()`) + loop-breaking strategy. *(0107.2)*
2. One `LoroDoc` for the whole backlog vs one per entity vs per-folder? Tree-in-one-doc vs doc-per-entity affects sync granularity + load. *(0107.1, 0107.3)*
3. Op-log: keep as a separate JSONL event index, or derive liveness from Loro's `subscribe()` deltas and retire JSONL entirely? *(0107.3)*
4. D1/Workers: demote to read-replica, or remove? *(0107.4)*

## In-Repo Precedent — pitlane (`ggs-assistant`), the operator's production Loro usage

The strongest evidence in this ADR: the operator already ships Loro in
`ggs-assistant/.../packages/pitlane` (`@loro-extended/change@6.0.0-beta.0` +
`loro-crdt@1.12.1`). Its `agentSession` module is a near-exact analog of what
0107 proposes, and its decisions are battle-tested patterns to **reuse, not
re-derive**:

- **One `LoroDoc` per session, created from a typed schema.** `createTypedDoc(AgentSessionSchema)` (`agentSession/repo.ts`). Schema is the **Loro Shape DSL** (`Shape.list(...)`, `Infer`) in `public/agentSession/schema.ts` — "knows ONLY about `@loro-extended/change`. No transport, no React, no Zod." → directly informs 0107.1: model each entity (or the whole tree) with `change`'s `Shape`; keep the substrate's Zod as the *app-layer* validity gate, separate from the CRDT schema.
- **Persistence = binary snapshot per doc, debounced.** `saveSnapshot` does `loro(doc).export({ mode: 'snapshot' })` → `Bun.write(<id>.loro)`; `loadSnapshot` → `doc.import(bytes)`; `scanAll` hydrates on startup; **500ms debounced** save on every commit boundary. Documented rationale: snapshot already preserves the full DAG + per-update origin tags (time-travel for free); one file per doc is rsync/tarball-friendly; O(doc bytes) not O(ops); swap to `mode:'update' since:<frontiers>` journal only at multi-MB scale. → **resolves much of 0107.3**: snapshot-per-entity (or per-doc) + debounced save is the proven persistence pattern; the `<id>.loro` blob is the truth.
- **`subscribe` drives persistence + liveness.** repo attaches a `subscribe` listener that schedules the debounced save AND emits to an SSE bus on every op-batch; `detach()` unsubscribes. → confirms 0107.2/0107.3: `DocHandle`/doc `subscribe` is the single seam for "persist + notify + (in our case) re-project markdown."
- **Remote updates already wired.** `applyRemoteUpdate(sessionId, update)` → `loro(doc).import(update)`; `broadcast` ships local updates out. → the multi-agent path (0107.4) is *already a solved shape* in pitlane (import/broadcast), not theoretical.
- **Atomic entries, serialize-at-boundary.** Each list entry stores `JSON.stringify(AgentEvent)` because `LoroList.push` takes scalars; parse at the selector boundary. "The agent is the only writer for agent events; humans append their own." `mergeable: true` so concurrent peers converge on container IDs without coordinated bootstrap. → informs how to store frontmatter/structured fields; and the "single writer per container" note is exactly our single-writer-now posture.
- **Binary-on-disk tradeoff acknowledged + mitigated.** pitlane notes `cat thr_*.loro` is unhelpful, mitigated by `exportForTraining` (re-materialize to JSONL). → our equivalent mitigation is the **markdown projection** (0107.3): the readable artifact alongside the blob. pitlane did NOT need plain-file native editing (no agent `Edit` on the session doc) — so the **doc↔markdown bridge (0107.2/0107.3) is the one piece pitlane does NOT already solve for us**, confirming it as the net-new work.

**Net**: pitlane de-risks the substrate, schema, persistence, subscribe, and
sync-import patterns (reuse them). The only genuinely new component for
backlog-mcp is the **doc↔markdown projection + native-edit op-capture** — which
pitlane never needed because its docs are app-internal, not file-edited.

## Authoritative Sources (distilled, not just linked)

- **Loro fit guide** (`loro-dev/loro` `skills/loro/references/fit-and-architecture.md`): "When Loro Fits" includes *"Apps that benefit from complete history, time travel, or version checkpoints"* — our exact (and, for single-user, *only*) hit. "Does NOT fit by itself" includes *authorization/invariants at write time* — confirms substrate validation stays app-layer. First design question is "what merges concurrently?" — honestly *nothing today*; the fit rests on the history bullet + the multi-agent future.
- **Containers** (`skills/loro/references/containers-and-encoding.md`): `LoroMap` = LWW fields (frontmatter); `LoroText` (`updateByLine` for line-oriented reconciliation) = body; `LoroTree` = hierarchical parent-child (our `parent_id`). Export modes: `update` / `updates-in-range` / `snapshot` / `shallow-snapshot`. Persistence pattern: periodic snapshot + frequent updates + recompact.
- **Text API** (`skills/loro/references/richtext-and-editors.md`): `update(target)` rewrites to a snapshot (Myers diff); `updateByLine` for line granularity; `toString()`/`toJSON()` = plain text. Confirms the watcher/hook reconciliation primitive exists and is first-class — *as an API*, while editor bindings (keystroke-level) are the documented higher-fidelity path.
- **`update()` perf caveat** (`crates/loro/src/lib.rs`, `crates/loro-wasm/src/lib.rs`): Myers diff "could take a long time for large texts (e.g. > 50_000 characters) … use `updateByLine` instead." Non-issue for markdown bodies.
- **`SchoolAI/loro-extended`** — the **selected substrate framework**; "toolkit for local-first applications and **multi-agent systems** with Loro." Packages: `repo` (automerge-repo analog: `Repo`, `DocHandle`, abstract `StorageAdapter`, synchronizer, permissions, middleware, rate-limiter), `change` (schemas, typed docs, typed `LoroTree`/`movable-list`/`text` refs, diff-overlay, json-patch, fork-at), `hooks-core`/`react`/`hono` (reactivity), `lens` (filtered views), `wire-format` (LEB128 framing/fragmentation). Adapters: network `websocket`/`websocket-compat`/`webrtc`/`sse`/`http-polling`; storage `indexeddb`/`leveldb`/`postgres`/`in-memory`. Its `StorageAdapter` = `key: string[] → bytes` (`load`/`save`/`remove`/`loadRange`/`removeRange`) — identical to ADR 0106.3 and automerge-repo nodefs. **Operator runs it in production in another project** (`ggs-assistant`/pitlane — see In-Repo Precedent).
- **`automerge/automerge-repo` `pushwork`** (Ink & Switch): "Bidirectional directory synchronization using Automerge CRDTs." Command-driven (`init`/`clone`/`sync`/`save`/`status`/`diff`/`heads`) — **git-shaped, not `fs.watch`-shaped**: snapshots the dir, diffs vs last-synced tree (`byteEq`), pushes to CRDT, materializes back (`writeFileAtomic`). Proves the doc↔file bridge is buildable and that reconcile-on-command sidesteps the live-watcher feedback loop — but it syncs arbitrary files, not entity-aware markdown, so it's a *pattern reference*, not a drop-in.
- **doc↔file bridge prior art (bespoke, no library)**: `gnick18/ResearchOS` `frontend/src/lib/loro/external-edit.ts` (classify clean/unclean, conflict-copy on clash, deferred live `fs.watch` to "Phase 4"); `brianonbased-dev/HoloScript` `packages/mcp-server/src/holomesh/crdt-sync.ts` (Loro in an **MCP server** + `fs` snapshot persistence + `subscribe` — closest topology to ours, but snapshot-persist not markdown-project). Confirms: **doc↔markdown projection is unpackaged in the Loro ecosystem — net-new for us.**
- **Loro doc↔doc sync tutorial** (`loro-dev/loro-docs` `pages/docs/tutorial/sync.mdx`): two-message convergence (`export({mode:'update'})` ↔ `import`), version-vector first-sync (`export({from})`), realtime via `subscribeLocalUpdates(update => send(update))`, `import()` returns `{success, pending}` causal-dependency ranges. This is the **doc↔doc** (peer↔peer) engine — *not* doc↔file; the two boundaries are distinct (peer-sync is solved/packaged; file-projection is the net-new bridge).
- **Loro sync stack** (`loro-dev/protocol`): transport-agnostic protocol (multi-room multiplex, 256 KiB framing, update fragmentation, `Ack`, room eviction); `loro-websocket` (WS client + `SimpleServer` + **Rust WS server with optional SQLite snapshotting**); `loro-adaptors` (`LoroAdaptor`, ephemeral, **`EloAdaptor` E2EE**); `loro-dev/peer-lease` (collision-free peer-id reuse). This **is** the "automerge-repo for Loro," unbundled.
- **Automerge storage adapter** (`automerge/automerge-repo` `packages/automerge-repo-storage-nodefs/src/index.ts`): **120 lines**, pure fs key→bytes (`load`/`save`/`remove`/`loadRange`/`removeRange`), zero CRDT logic. Proof the storage layer is trivial to replicate for Loro and that "batteries-included" is ~100 lines of batteries.
- **Production file↔CRDT bridge** (`gnick18/ResearchOS` `frontend/src/lib/loro/external-edit.ts`): classify `clean`/`unclean`; clean = per-field set + `setEntryContent`, one commit, followable diff; unclean = wholesale clear+reinsert, coarse boundary; `shouldConflictCopy` when pending in-app edits clash with external file edits — "no CRDT merge is attempted." Validates the pattern *and* the limitation: snapshot bridges conflict-copy; op-capture (hooks) is the way to avoid it.
- **Claude Code hooks** (`code.claude.com/docs/en/hooks`): `PostToolUse` matcher `Edit|Write` receives `tool_input` (mirrors tool args: `file_path`/`old_string`/`new_string` for Edit, `file_path`/`content` for Write, `edits[]` for MultiEdit) plus `session_id` and (in subagents) `agent_id`/`agent_type`. Command hooks read the JSON on stdin. This is the op-capture seam (0107.2).
- **pitlane (operator's production Loro app)**: `ggs-assistant/src/GgsAssistant/packages/pitlane` — `@loro-extended/change@6.0.0-beta.0` + `loro-crdt@1.12.1`. Key files: `src/agentSession/repo.ts` (per-session typed doc registry, `createTypedDoc`, `subscribe`→persist+SSE, `applyRemoteUpdate`/`broadcast`), `src/agentSession/persistence.ts` (snapshot-per-doc, debounced 500ms, `export({mode:'snapshot'})`/`import`, `scanAll` hydrate), `public/agentSession/schema.ts` (Loro Shape DSL, `mergeable:true`, serialize-at-boundary). See "In-Repo Precedent" above for the distilled patterns to reuse.
- **In-repo integration point**: ADR 0106.3 `StorageAdapter` interface + `FilesystemStorage`/`D1Storage` split — the new `MarkdownStorageAdapter` (CRDT blob + markdown projection) slots in here with no architectural change.
