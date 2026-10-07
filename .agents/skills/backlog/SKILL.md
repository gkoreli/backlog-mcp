---
name: backlog
description: Use backlog-mcp through MCP or CLI for project context, work, decisions, and durable memory. Use when working with a backlog home, recalling or correcting knowledge, writing threaded ADRs, or defining custom project substrates.
---

# Use backlog-mcp

Backlog is a local-first Markdown corpus; indexes and the viewer are projections.
Use the available MCP connection or CLI; preserve the project's document conventions.
This folder is portable: copy it with its references into another project's skills directory.

## Select the home and contract

- Identify the intended project root and select its home before reading or writing.
- CLI: inspect `backlog --help`; use `--home project --project-root /absolute/repo`.
- MCP: expand the selected tool's full schema; use its home fields or connection selection.
- Use `content` for the Markdown body; discovery summaries are not input contracts.
- Read [CLI and MCP](references/cli-and-mcp.md) for setup, selection, invocation, and receipts.

## Orient, retrieve, and expand

- Wake once at session start: `backlog_wakeup` or `backlog wakeup`.
- After context loss, resume from the durable work record; use a known operation when available.
- Recall once per topic when learned knowledge matters; inspect age, source, and correction lineage.
- Search to locate current documents; use list for filters and get for authoritative detail.
- Expand selected entities with get's context option, then hydrate only relevant neighbor stubs.
- Recall and search have distinct semantics even when they share candidate retrieval.
- Current user direction, accepted project decisions, and verified contracts outweigh stale memory.

## Make meaningful changes

- Discover the substrate's declared action and read its inputs before invoking it.
- Keep task progress, architectural decisions, and remembered lessons in their owning records.
- Use explicit memory correction (`supersedes` or `state_key`), preserving prior-holder lineage.
- Forget retracts knowledge; deletion permanently removes records; expired-memory GC removes history.
- Preserve Markdown; inspect committed receipts, warnings, and home/path provenance before retrying.
- Read [Memory](references/memory.md) when capturing, correcting, retracting, or consolidating knowledge.
- Read [CLI and MCP](references/cli-and-mcp.md) before managed writes: current adapters have gaps.

## Extend the project vocabulary

- Check the active catalog first: ADR is built-in; requirement and prompt ship as default declarations.
- Read [Adopting docs](references/adopting-docs.md) when bolting backlog onto an existing documentation tree.
- Declare storage identity, canonical fields, actions, lifecycle, relations, and desired disclosure.
- Read [Custom substrates](references/custom-substrates.md) to add a genuinely new type.
- Read [ADRs](references/adrs.md) for decisions; [Threads](references/threads.md) for focused amendments and scoped overrides.
- Validate discovery and action inputs before corpus-wide changes; native edits remain available.

Load only the reference relevant to the task; do not read the entire reference folder by default.
Follow the [Agent Skills format](https://agentskills.io/specification); keep detailed examples in references.
