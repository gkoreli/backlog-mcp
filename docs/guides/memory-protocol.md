# Memory protocol

Read this when recalling or capturing project knowledge, working with backlog entities or tool schemas, correcting or consolidating memories, or recovering after context loss.
These are active contributor instructions, reached from [AGENTS.md](../../AGENTS.md).

Architecture and rationale live in the [ADR 0092 thread](../adr/0092-plugin-based-agentic-memory-architecture.md)
and [ADR 0114](../adr/0114-memory-context-surface-disposition.md).
This guide preserves the operational protocol.

## Memory Protocol (ADR 0092 thread)

backlog-mcp has a durable memory layer. Memories are first-class entities
(`MEMO-` ids, markdown + frontmatter) — atomic facts you can recall, decay,
supersede, and rank by usage. Use it; don't let each session start cold.

### The loop

1. **Wake up once, at session start** — run `backlog_wakeup` (CLI: `backlog
   wakeup`). One dense briefing: active tasks, current epics, top knowledge,
   recent completions, recent activity. Do not repeat it during ordinary work.
   After compaction or context loss, recover from the durable work record;
   `backlog_wakeup` with `operation` can restore a known live operation.
2. **Ask when prior knowledge matters** — use `backlog_recall query="<topic>"`
   (CLI: `backlog recall "<topic>"`) for learned knowledge and `backlog_search`
   for the current corpus. Inspect a memory's age, provenance and correction
   lineage before treating it as current. Project decisions outweigh generic
   priors; stale memories do not override current user direction or verified
   contracts. Memories are hidden from ordinary `search`/`list`; explicit
   `list type="memory"` includes them.
3. **Expand when the work becomes specific** — call `backlog_get` for full
   content. When starting work on an entity, pass `context: true` to include
   its relational neighborhood (parent, children, siblings, references,
   referenced-by, and related items) as stubs, then expand only the stubs you
   need. One retrieval language, with progressive disclosure throughout:
   orient → ask → expand.
   For a tool call, expand the selected tool's full input schema before
   constructing arguments. A discovery summary is not an argument contract;
   client-owned schema deferral is not guaranteed. Derive field guidance from
   its owning substrate; the shared Markdown body field is `content`.
4. **Remember what's durable** — when you learn a non-obvious decision, a
   gotcha, a convention, or a fact that will matter next session, write it with
   `backlog_remember`. One atomic fact per memory.
5. **Correct, don't duplicate** — when something you already remembered
   changes, use MCP `supersedes` (CLI: `--supersedes <MEMO-id>`) to keep lineage
   and expire the old one, or MCP `state_key` (CLI: `--state-key <key>`) for
   evolving single-value facts (a new holder auto-closes
   the previous). Never write a contradicting second memory.

### Recall discipline (don't clog context)

- Recall **once per task topic**, not before every tool call.
- A recall result spends context budget — worth it when it replaces
  re-deriving something expensive, wasteful for trivia.

### What to remember (and what NOT to)

Capture quality is the whole game — noise pollutes recall and erodes trust.

- **Do**: durable decisions, non-obvious gotchas, project conventions,
  preferences, facts that outlive the session. Pick the right `--layer`
  (`semantic` = what is true · `procedural` = how we do things · `episodic` =
  what happened) and `--kind` (`current` · `historical` · `plan` · `preference`
  · `timeless` — timeless is exempt from decay).
- **Don't**: obvious facts, one-off details, restated task descriptions,
  "ran tests, passed". Episodic completions auto-capture on task→done — you
  don't hand-write those.

### Lifecycle

- `backlog_forget` soft-expires (drops from recall, stays auditable in the
  viewer); MCP `expired: true` (CLI: `--expired`) hard-deletes already-expired
  memories (GC).
- Recall/read bumps a memory's `usage_count` + `last_used_at` — useful memories
  rank higher over time, stale ones decay. Self-curating; no action needed.
- When atomic memories sprawl, MCP `backlog_consolidation_candidates`
  (CLI: `backlog consolidation-candidates`) surfaces
  clusters ripe for distillation into fewer `derived` semantic/procedural
  memories (ADR 0092.7). Capture small, compress upward.
