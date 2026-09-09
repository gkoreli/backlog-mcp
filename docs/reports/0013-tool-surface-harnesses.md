---
title: "0013 — Tool surface: harness discovery findings"
date: 2026-09-08
status: Research complete — documentation/code audit; live client trials pending
backlog_item: TASK-0009
---

# Harness discovery findings

Deferred schemas are a client optimization, not a portable MCP guarantee. ADR 0106.5’s semantic-contract rationale remains defensible, but expansion cannot rely on every harness hiding schemas. Parent report 0011 measures the emitted payload; no worker captured a client’s actual model request.

## Protocol and client evidence

MCP `tools/list` returns names, descriptions and input schemas. The protocol leaves model presentation to clients. Current tooling supports pagination, deterministic ordering and change notifications; it does not define automatic model-context deferral. A server can return a different authorized catalog, but should not “unlock” tools as a side effect of another request. These are current specification findings; the installed SDK’s negotiated protocol may be older. [MCP Tools specification](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)

Resources expose separately fetched content, generally under application control; prompts are user-invoked templates. Moving actions into them changes how work is initiated and does not guarantee autonomous discovery. [MCP Resources](https://modelcontextprotocol.io/specification/2026-07-28/server/resources), [MCP Prompts](https://modelcontextprotocol.io/specification/draft/server/prompts)

**Claude Code:** current documentation says supported default configurations load names and server instructions, then discover definitions on demand. `ENABLE_TOOL_SEARCH=false` loads definitions eagerly; `auto` uses a 10% context threshold. Server `alwaysLoad` and individual-tool `anthropic/alwaysLoad` can override deferral. Configuration/model/provider exclusions apply. Instructions and descriptions are truncated at 2 KB. The client supports catalog-change notifications and reconnect, plus resource/prompt UI. Installed version was 2.1.260; relevant shell switches were unset. No Claude session was launched, so default eligibility is not an observed loading result. [Claude Code MCP documentation](https://code.claude.com/docs/en/mcp)

**Codex:** installed version was 0.153.4. Local CLI help exposes MCP management, and feature output contains removed tool-search flags; those internal flags do not establish active context behavior. Official documentation supports local stdio/HTTP MCP, server instructions, and enabled/disabled tool lists. It advises a self-contained opening to server instructions. The reviewed documentation does not establish local-server schema deferral, resource/prompt presentation, or list-change refresh semantics. Those remain empirical questions. [Official Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)

**OpenAI Responses API:** explicit tool search with `defer_loading` is an application-side mechanism. Models supporting it can search a deferred namespace/server and receive selected definitions later. The host must enable this feature; it is not a field an ordinary backlog-mcp tool schema can impose on arbitrary clients. Do not infer Codex local MCP behavior from this API feature. [OpenAI Tool Search guide](https://developers.openai.com/api/docs/guides/tools-tool-search)

## What backlog-mcp actually provides

- `packages/server/src/server/hono-app.ts:392` constructs McpServer with name/version and no server-wide instructions. A deferred client therefore gets no product-level discovery guidance through that field. `tools/register-substrate-intents.ts:120` supplies per-tool descriptions, a different protocol field.
- `tools/backlog-wakeup.ts` sets `anthropic/alwaysLoad:true`; `tools/backlog-write-resource.ts` explicitly sets false. The baseline therefore includes wakeup’s schema on supporting Claude clients even when other tools defer. Names-only cost is an incomplete model of this server’s Claude baseline.
- Every HTTP request constructs a new server before connecting a stateless transport. The installed SDK advertises listChanged when tools/resources register, but only sends registration notifications if already connected. No later backlog source sends a list-change notification. A fresh tools/list can see a new compiled catalog; a running client is not proactively told to refresh. Client behavior after definition changes needs a real trial.
- `resources/manager.ts:352` supplies `mcp://backlog/{+path}` without a list callback. Live capture confirms zero enumerated resources and one template. No prompts are registered. A resource picker is not currently a reliable action catalog.

These findings agree with ADR 0106’s explicit caveat that semantic clarity must stand independently of client-specific deferral. ADR 0106.5 narrowed expansion to explicit intents, but it did not establish a total catalog budget.

## Candidate tradeoffs

| Approach | Useful property | Cost or failure mode to test |
|---|---|---|
| Small typed daily surface | Predictable eager cost; exact schemas at invocation | Missing authoring/maintenance actions need a discoverable tail |
| Explicit capability profiles | Keeps ordinary typed tools and existing execution | Setup/reconnect burden; omitted capabilities can appear unsupported |
| Native client tool search | Reuses the client’s typed discovery mechanism | Client-dependent baseline, search calls and schema-load costs |
| Discover plus intent executor | Bounded static catalog; reuses compiled intents server-side | Extra schema transfer, generic input bag, stale discovery, retries |
| Resource/prompt recipes | Good for documents and explicitly requested workflows | Client/UI-dependent; not a portable replacement for autonomous tools |
| CLI hierarchy | Pull-based help and coherent operator navigation | Shell/help/error output still consumes context during use |

Commander already supports nested command groups and scoped help; no dependency or new CLI framework is needed. [Commander documentation](https://github.com/tj/commander.js/)

A discovery executor is especially easy to overrate: the manifest becomes small because the exact schema moves into a prior response. Unless host-side guidance, runtime validation, revision/home binding and error recovery remain sound, a smaller number has hidden work rather than removed it. This is an inference from the existing contracts, not a measured agent result.

## Recommended evaluation constraints

Use an eager client as the portability gate and treat native deferral as a second measurement. Count initial instructions, visible names/schemas, discovery tools/results, selected schemas, normal calls/results, help, retries and compaction recovery. Report unique injected tokens separately from per-turn/cumulative or billed-token accounting. Prompt caching can change price/latency without reducing context occupancy.

Keep typed domain contracts unless candidate trials justify changing them. Add a concise server-level discovery explanation to any prototype retaining a searchable tail, and include its tokens in the budget. Do not treat optional sets as adequate until users can find omitted capabilities and catalog selection is stable for the home.

Minimum live matrix: current Codex; eligible Claude default; Claude eager; threshold mode; standard/custom project catalogs; custom intents changed during a session; reconnect and interrupted-notification cases. Record model, client, configuration, observed calls, wrong selections, retries, input/output tokens and latency. Provider paths without deferral require separate evidence if claimed supported.

## Provenance and limits

Read-only worker: gpt-5.6-sol, medium reasoning. Parent independently checked MCP/Claude primary pages, runtime registration, live manifests, and installed source paths. Worker inspected local CLI versions/help, filtered feature flags, SDK registration logic and primary documentation. It did not start an agent trial, mutate files, or run tests. Raw worker report/logs remain in the session’s external worker-state directory; this is the parent-reviewed durable synthesis. There is no measured claim here about improved task success or actual Codex schema injection.
