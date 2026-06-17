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

### Option C — Loro (CRDT) as the truth/history substrate  ← **SELECTED**
`LoroDoc` = truth; `.md` = projection; edits captured as ops; agents as peers later.
- **Pro**: full history + time-travel + fork + shallow-snapshot built in; **the only option that scales single-writer→multi-writer with no rewrite** (single-writer is the degenerate case); `LoroTree` natively models the `parent_id` hierarchy; ships an **official agent skill**; compact encoding + fast load; sync stack already exists (`loro-protocol`/`loro-websocket`/`peer-lease`); E2EE option (`%ELO`).
- **Con (accepted, see Risks)**: binary truth-store; the file↔doc projection needs an op-capture bridge (hooks/watcher) that has coarse boundaries on *structural* file edits; substrate validity is an **app-layer** concern (CRDTs don't enforce write-time invariants); more *assembly* than Automerge's bundled `repo` (but the glue is ~100 lines — see below).
- **Verdict**: **Selected.** It is the only substrate consistent with the full trajectory (history now, concurrent multi-agent later) while preserving native editing and local-first.

### Why not Automerge / Yjs / json-joy (the CRDT field)
- **Yjs**: history **pruned by default** — a current-state sync engine for editors. Getting our op-log/time-travel means reinventing the history layer Yjs chose not to keep. Wrong category for a history-first store. (Would win for a live collaborative *editor*; we aren't building one.)
- **json-joy**: current-state + micro-benchmark focus; history/time-travel not its center. Wrong category. Smaller ecosystem.
- **Automerge**: genuinely fits (full git-like history; `automerge-repo` bundles storage+network). **The deciding factors went to Loro**: (1) `LoroTree` fits our hierarchy natively (Automerge = nested maps); (2) official **agent skill**; (3) compact encoding/fast load; (4) the "Automerge has batteries, Loro is DIY" advantage **evaporated** once we found Loro's sync stack exists *and* proved the storage adapter is ~100 trivial lines (see Authoritative Sources). Rich-text — the column the comparison matrices obsess over — is a **non-factor**: we edit markdown via files/hooks, not inside the CRDT.

---

## Decision

Adopt **Loro** as the durable source-of-truth and history substrate, local-first, with markdown projection and op-capture via the agent's native edit path. Execute as the 0107 thread:

- **0107.1 — Domain mapping**: entity → Loro containers. `LoroMap` for frontmatter (LWW fields), `LoroText` for the body, `LoroTree` for the `parent_id` hierarchy. Substrate Zod schema stays the **app-layer validity gate** (CRDTs don't validate at write time).
- **0107.2 — Op capture**: the `PostToolUse` **hook** is the primary, high-fidelity seam — it delivers the agent's *intended* op (`Edit` = `{file_path, old_string, new_string}`) plus `session_id`/`agent_id`/`agent_type` (turn-grouping + multi-agent attribution for free). The file-watcher is a **lossy fallback** for non-hook editors.
- **0107.3 — Storage**: `LoroStorage implements StorageAdapter` (the 0106.3 seam). `save()` persists the Loro snapshot (truth) **and** projects markdown (readable). Persistence = periodic snapshot + frequent update log + recompact (Loro's documented pattern).
- **0107.4 — Sync (future)**: agents as **peers** via `loro-protocol` + `loro-websocket` + `peer-lease`; self-host the Rust WS server (SQLite snapshotting). Merge, not conflict-copy. E2EE available via `%ELO`. **Not built until concurrent multi-agent writing is a live requirement** — but the substrate choice keeps the door open with no rewrite.

---

## Distilled Insights (the load-bearing realizations)

- **Conflict copies are a *capture* problem, not a substrate problem.** A file-watcher captures *results* (a post-hoc snapshot) and reverse-engineers ops via Myers diff → ambiguous under concurrency → conflict copy. The agent's native `Edit` **already emits the operation** (`old_string→new_string`). Capture at the **tool-call boundary** (hook), not the filesystem, and the op is clean and intentional. *(Evidence: gnick18/ResearchOS `external-edit.ts` — production file↔CRDT bridge — explicitly accepts coarse "unclean" boundaries and writes conflict copies precisely because snapshot reconstruction is lossy.)*
- **Agent-to-agent via Loro ops merges; file-watcher-on-top conflict-copies.** The clean multi-agent story is "agents are peers exchanging ops." The conflict copies only appear at the *file projection* boundary — keep that a human-convenience layer, separate from the agent-peer path.
- **The "missing automerge-repo for Loro" is a packaging illusion.** `automerge-repo-storage-nodefs` is **120 lines** of `readFile`/`writeFile`/`mkdir`/`walkdir` — zero CRDT logic; a dumb key→bytes store behind a narrow interface. The Loro equivalent is the same size (`export({mode:'snapshot'})` + append update log + `import` on load). Loro didn't formalize it because it doesn't *require* a pluggable adapter; Automerge does. Sync glue isn't missing either — it's `loro-protocol`/`loro-websocket`/`loro-adaptors`/`peer-lease`.
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

## Authoritative Sources (distilled, not just linked)

- **Loro fit guide** (`loro-dev/loro` `skills/loro/references/fit-and-architecture.md`): "When Loro Fits" includes *"Apps that benefit from complete history, time travel, or version checkpoints"* — our exact (and, for single-user, *only*) hit. "Does NOT fit by itself" includes *authorization/invariants at write time* — confirms substrate validation stays app-layer. First design question is "what merges concurrently?" — honestly *nothing today*; the fit rests on the history bullet + the multi-agent future.
- **Containers** (`skills/loro/references/containers-and-encoding.md`): `LoroMap` = LWW fields (frontmatter); `LoroText` (`updateByLine` for line-oriented reconciliation) = body; `LoroTree` = hierarchical parent-child (our `parent_id`). Export modes: `update` / `updates-in-range` / `snapshot` / `shallow-snapshot`. Persistence pattern: periodic snapshot + frequent updates + recompact.
- **Text API** (`skills/loro/references/richtext-and-editors.md`): `update(target)` rewrites to a snapshot (Myers diff); `updateByLine` for line granularity; `toString()`/`toJSON()` = plain text. Confirms the watcher/hook reconciliation primitive exists and is first-class — *as an API*, while editor bindings (keystroke-level) are the documented higher-fidelity path.
- **`update()` perf caveat** (`crates/loro/src/lib.rs`, `crates/loro-wasm/src/lib.rs`): Myers diff "could take a long time for large texts (e.g. > 50_000 characters) … use `updateByLine` instead." Non-issue for markdown bodies.
- **Loro sync stack** (`loro-dev/protocol`): transport-agnostic protocol (multi-room multiplex, 256 KiB framing, update fragmentation, `Ack`, room eviction); `loro-websocket` (WS client + `SimpleServer` + **Rust WS server with optional SQLite snapshotting**); `loro-adaptors` (`LoroAdaptor`, ephemeral, **`EloAdaptor` E2EE**); `loro-dev/peer-lease` (collision-free peer-id reuse). This **is** the "automerge-repo for Loro," unbundled.
- **Automerge storage adapter** (`automerge/automerge-repo` `packages/automerge-repo-storage-nodefs/src/index.ts`): **120 lines**, pure fs key→bytes (`load`/`save`/`remove`/`loadRange`/`removeRange`), zero CRDT logic. Proof the storage layer is trivial to replicate for Loro and that "batteries-included" is ~100 lines of batteries.
- **Production file↔CRDT bridge** (`gnick18/ResearchOS` `frontend/src/lib/loro/external-edit.ts`): classify `clean`/`unclean`; clean = per-field set + `setEntryContent`, one commit, followable diff; unclean = wholesale clear+reinsert, coarse boundary; `shouldConflictCopy` when pending in-app edits clash with external file edits — "no CRDT merge is attempted." Validates the pattern *and* the limitation: snapshot bridges conflict-copy; op-capture (hooks) is the way to avoid it.
- **Claude Code hooks** (`code.claude.com/docs/en/hooks`): `PostToolUse` matcher `Edit|Write` receives `tool_input` (mirrors tool args: `file_path`/`old_string`/`new_string` for Edit, `file_path`/`content` for Write, `edits[]` for MultiEdit) plus `session_id` and (in subagents) `agent_id`/`agent_type`. Command hooks read the JSON on stdin. This is the op-capture seam (0107.2).
- **In-repo integration point**: ADR 0106.3 `StorageAdapter` interface + `FilesystemStorage`/`D1Storage` split — `LoroStorage` slots in here with no architectural change.
