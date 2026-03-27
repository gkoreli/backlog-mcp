---
title: "CLI Tool and Core Function Extraction"
date: 2026-03-26
status: Accepted
---

# 0090. CLI Tool and Core Function Extraction

## Problem Statement

All business logic lives inside MCP tool registration callbacks (`src/tools/*.ts`), tightly coupled to the MCP SDK. This means no CLI access, no reuse from HTTP routes, and testing requires MCP server mocking.

## Decision

Extract business logic into `src/core/` — standalone functions that take `IBacklogService` + typed params and return typed results. MCP tools and CLI commands become thin transport wrappers.

```
MCP Client → src/tools/*.ts (thin wrapper) ──┐
                                              ├──→ src/core/*.ts (business logic) → IBacklogService
CLI User   → src/cli/commands/*.ts (thin)  ──┘
```

## Design Principles

### 1. Core is pure business logic — no I/O, no transport

Core functions never touch the filesystem, network, or MCP SDK. `resolveSourcePath` (filesystem read) lives in the MCP transport layer, not core. This enables Workers/D1 compatibility (ADR-0089).

### 2. Strict type safety — zero `any`

- Core layer: zero `any` types. All params, results, and errors are fully typed.
- `IBacklogService` interface: uses `UnifiedSearchResult`, `ResourceContent`, `ListFilter` — no `any` placeholders.
- `Entity` fields accessed via typed properties, not `as any` casts. Nullable fields (`due_date`, `content_type`) use explicit typed assignments.
- `EditOperation` maps to the `Operation` discriminated union from `resources/types.ts`.
- Only legitimate `Record<string, unknown>` is YAML frontmatter — genuinely arbitrary key-value data.

### 3. Consistent error contract

| Error | When | Used by |
|-------|------|---------|
| `NotFoundError` | Required entity doesn't exist | `updateItem`, `editItem` |
| `ValidationError` | Invalid input | `getItems` (empty ids), `searchItems` (empty query) |

- Reads: not-found is normal — `getItems` returns `{ id, content: null }` per missing entity.
- Deletes: `deleteItem` returns `{ id, deleted: boolean }` so caller knows if item existed.
- Edits: `{ success: false, error }` for operation failures (expected outcomes, not exceptions).

### 4. Consistent signatures — single params object

Every core function takes `(service, params)` where params is a typed object. No mixed signatures.

### 5. Transport formats, core returns data

Core returns structured types. Transport decides presentation:
- `getItems` returns `Array<{ id, content, resource? }>` — MCP joins with separators and formats resource headers. CLI could render differently.
- `listItems` returns `{ tasks: ListItem[], counts? }` — MCP serializes to JSON. CLI could show a table.

### 6. Backward compatibility via re-export

`resolveSourcePath` moved to MCP transport but re-exported from `tools/backlog-create.ts` for existing test imports.

## Core Functions (Phase 1 — Complete)

| File | Function | Returns | Throws |
|------|----------|---------|--------|
| `core/list.ts` | `listItems` | `{ tasks: ListItem[], counts? }` | — |
| `core/get.ts` | `getItems` | `{ items: GetItem[] }` | `ValidationError` |
| `core/create.ts` | `createItem` | `{ id }` | — |
| `core/update.ts` | `updateItem` | `{ id }` | `NotFoundError` |
| `core/delete.ts` | `deleteItem` | `{ id, deleted }` | — |
| `core/search.ts` | `searchItems` | `{ results, total, query, search_mode }` | `ValidationError` |
| `core/edit.ts` | `editItem` | `{ success, message?, error? }` | `NotFoundError` |

`backlog-context` was NOT extracted — already delegates to `hydrateContext()` (191 tests).

## MCP Wrapper Pattern

```typescript
// Happy path
async (params) => {
  const result = await listItems(service, params);
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

// Typed error handling
async (params) => {
  try {
    const result = await updateItem(service, params);
    return { content: [{ type: 'text', text: `Updated ${result.id}` }] };
  } catch (error) {
    if (error instanceof NotFoundError)
      return { content: [{ type: 'text', text: `Task ${params.id} not found` }], isError: true };
    throw error;
  }
}

// Transport-specific I/O before calling core
async ({ source_path, ...params }) => {
  let description = params.description;
  if (source_path) description = resolveSourcePath(source_path);
  const result = await createItem(service, { ...params, description });
  return { content: [{ type: 'text', text: `Created ${result.id}` }] };
}
```

## Invariant Tests (48)

| Suite | Count | Key Invariants |
|-------|-------|---------------|
| `listItems` | 6 | Normalized shape, parent_id/epic_id precedence, counts toggle, filter passthrough |
| `getItems` | 7 | Structured items, null for missing, batch order, resource URIs with metadata, ValidationError on empty |
| `createItem` | 7 | Sequential ID, type-specific prefix, parent precedence, epic_id backward compat |
| `updateItem` | 10 | NotFoundError, parent/epic precedence, null clears both, nullable fields, updated_at |
| `deleteItem` | 2 | `deleted: true` when existed, `deleted: false` when not |
| `searchItems` | 8 | ValidationError on empty, optional scores/content, hybrid mode, filter passthrough |
| `editItem` | 8 | All 3 operations, NotFoundError, `{ success: false }` for op errors, updated_at |

## CLI Architecture (Phase 2)

### Positioning

CLI is a local-only human interface. It is not a new architecture — it is another consumer of the existing core layer, identical in role to MCP tools and HTTP routes.

```
Consumers of src/core/*.ts:
  src/tools/*.ts          → MCP transport   (agents via stdio/HTTP)
  src/server/hono-app.ts  → HTTP transport  (web viewer, API clients)
  src/cli/commands/*.ts   → CLI transport   (humans via terminal)
```

- All three are thin wrappers that transform transport-specific input into core params and core results into transport-specific output.
- All three receive `IBacklogService` — they don't know or care about the implementation.
- CLI does not interact with the running HTTP server. It calls core functions directly against the same `BacklogService` singleton that the server uses. Both access the filesystem. This is safe because `TaskStorage` uses synchronous writes and markdown files are atomic at the OS level.

### Why CLI exists

MCP is for agents. The web viewer is read-only. Humans need a way to create, update, and manage backlog items from the terminal without going through an MCP client. CLI fills that gap.

### Scope boundary — local only

- CLI is a local tool. It reads/writes the local filesystem via `BacklogService`.
- Remote/cloud mode (ADR-0089, ADR-0091) is served by MCP over HTTP and the web viewer. No CLI needed there.
- This is intentional: CLI's value is zero-latency local access. Remote access has different UX requirements (auth, latency tolerance, offline) that belong in the web viewer.

### CLI Framework — Commander.js

- Commander.js: mature, zero dependencies, declarative, good TypeScript support, ~60KB.
- `skipNodeModulesBundle: true` in tsdown config means Commander is externalized — npm installs it as a runtime dependency, not bundled into the server code. MCP-only users pay zero bundle cost.
- The alternative (hand-rolled if/else) is what `cli/index.ts` does today for 5 server management commands. It won't scale to 13+ commands with flags, validation, and help text.

### Command Structure — flat, backward compatible

```
Server management (existing — preserved):
  backlog-mcp                    → bridge mode (default, no subcommand)
  backlog-mcp serve              → HTTP server foreground
  backlog-mcp status             → check server
  backlog-mcp stop               → stop server
  backlog-mcp version            → show version

Data commands (new):
  backlog-mcp list               → active items (default filter)
  backlog-mcp get <id...>        → one or more items by ID
  backlog-mcp create <title>     → create item
  backlog-mcp update <id>        → update fields
  backlog-mcp delete <id>        → delete item
  backlog-mcp search <query>     → full-text + semantic search
  backlog-mcp context <id>       → context hydration
  backlog-mcp edit <id> replace <old> <new>  → string replacement
  backlog-mcp edit <id> append <text>        → append to body
  backlog-mcp edit <id> insert <line> <text> → insert at line
```

- Flat structure — no nesting (`backlog-mcp list`, not `backlog-mcp task list`). Fewer keystrokes, simpler mental model, mirrors MCP tool names.
- Default action (no subcommand) remains bridge mode. Commander's `program.action()` handles this — when no subcommand matches, the default runs. Zero breaking change.

### Command Mapping

| MCP Tool | CLI Command | Positional | Key Flags | Transport-specific |
|----------|-------------|------------|-----------|-------------------|
| `backlog_list` | `list` | — | `--status`, `--type`, `--epic`, `--parent`, `--query`, `--counts`, `--limit` | — |
| `backlog_get` | `get <id...>` | variadic IDs | — | — |
| `backlog_create` | `create <title>` | title | `--description`, `--source`, `--type`, `--epic`, `--parent` | `--source` resolves file (same as MCP's `source_path`) |
| `backlog_update` | `update <id>` | ID | `--title`, `--status`, `--epic`, `--parent`, `--evidence`, `--blocked-reason`, `--due-date` | `--evidence` repeatable (`--evidence "A" --evidence "B"` → array) |
| `backlog_delete` | `delete <id>` | ID | `--force` | `--force` required (no interactive prompt in Phase 2) |
| `backlog_search` | `search <query>` | query | `--types`, `--status`, `--sort`, `--limit`, `--content`, `--scores` | — |
| `backlog_context` | `context <id>` | ID or `--query` | `--depth`, `--max-tokens`, `--no-related`, `--no-activity` | Wires `hydrateContext` directly (not extracted to core) |
| `write_resource` | `edit <id> <op>` | ID + operation subcommand | `replace <old> <new>`, `append <text>`, `insert <line> <text>` | Subcommand-per-operation pattern (see `edit` design section) |

### CLI Wrapper Pattern

Mirrors the MCP wrapper pattern exactly. Each command is a thin adapter: parse args → call core → format output.

```typescript
// CLI wrapper — same shape as MCP wrapper
async (id, options) => {
  const result = await getItems(service, { ids: [id] });
  output(options.json ? result : formatGet(result));
}

// Transport-specific I/O (same as MCP's source_path handling)
async (title, options) => {
  let description = options.description;
  if (options.source) description = resolveSourcePath(options.source);
  const result = await createItem(service, { title, description, ...mapFlags(options) });
  output(options.json ? result : `Created ${result.id}`);
}

// Error handling — maps core errors to exit codes
async (id, options) => {
  try {
    const result = await updateItem(service, { id, ...mapFlags(options) });
    output(options.json ? result : `Updated ${result.id}`);
  } catch (error) {
    if (error instanceof NotFoundError) exit(1, error.message);
    if (error instanceof ValidationError) exit(1, error.message);
    throw error;  // unexpected → exit 2
  }
}
```

### Output Strategy

- Human-readable by default — formatted text, tables where appropriate.
- `--json` global flag — structured JSON, same shape as core function return types. Enables piping: `backlog-mcp list --json | jq '.tasks[] | .id'`.
- The formatter is per-command (domain knowledge lives in the command), the output decision is global (the `--json` flag).

### Error Handling and Exit Codes

| Exit Code | Meaning | Source |
|-----------|---------|--------|
| 0 | Success | Normal completion |
| 1 | User error | `NotFoundError`, `ValidationError`, bad args |
| 2 | Unexpected error | Unhandled exception, bug |

- Core errors (`NotFoundError`, `ValidationError`) map to exit 1 with a human-readable message.
- Commander handles invalid flags/args automatically (exits with help text).
- Unexpected errors print a stack trace and exit 2.

### Runner — cross-cutting concerns

A single `run()` function handles service resolution, error mapping, and output formatting. Commands don't repeat this boilerplate.

```typescript
async function run<R>(
  handler: (service: IBacklogService) => Promise<R>,
  format: (result: R) => string,
  json: boolean,
): Promise<void> {
  const service = BacklogService.getInstance();
  const result = await handler(service);
  console.log(json ? JSON.stringify(result, null, 2) : format(result));
}
```

- Service resolution: `BacklogService.getInstance()` — same singleton, same filesystem.
- Error handling: wraps `handler` in try/catch, maps known errors to exit codes.
- Output: delegates to `format` or `JSON.stringify` based on `--json`.

### File Structure

```
src/cli/
├── index.ts              # Entry point — Commander program, server mgmt commands, default action
├── runner.ts             # run() — service resolution, error handling, output
├── commands/
│   ├── list.ts           # list command + formatter
│   ├── get.ts            # get command + formatter
│   ├── create.ts         # create command + formatter
│   ├── update.ts         # update command + formatter
│   ├── delete.ts         # delete command + formatter
│   ├── search.ts         # search command + formatter
│   ├── context.ts        # context command + formatter
│   └── edit.ts           # edit command + formatter
├── bridge.ts             # existing — stdio bridge to HTTP server
├── server-manager.ts     # existing — spawn/stop/version check
└── supervisor.ts         # existing — restart with exponential backoff
```

- Each command file exports a function that registers a Commander subcommand.
- Formatters live in the same file as the command — they're small (a few lines each) and tightly coupled to the command's return type.
- `bridge.ts`, `server-manager.ts`, `supervisor.ts` are unchanged.

### Lazy Initialization

- `BacklogService` constructor creates `TaskStorage` + `OramaSearchService`, but search indexing is lazy (`ensureSearchReady()` called on first search).
- Commands that don't search (`list` without `--query`, `get`, `create`, `update`, `delete`) never trigger index building.
- `search` and `context` trigger indexing on first call — acceptable latency for CLI (one-shot process, not a long-running server).

### `context` Command — not extracted to core

`hydrateContext` already has clean dependency injection via `HydrationServiceDeps`. The CLI command wires it the same way the MCP tool does:

```typescript
hydrateContext(request, {
  getTask: (id) => service.getSync(id),
  listTasks: (filter) => service.listSync(filter),
  listResources: () => resourceManager.list(),
  searchUnified: (q, opts) => service.searchUnified(q, opts),
  // readOperations omitted — CLI doesn't have operation logger
});
```

- `readOperations` is optional in `HydrationServiceDeps`. CLI skips it — no operation logger in a one-shot CLI process. Activity timeline and session memory will be absent, which is fine for human use.

### `edit` Command — subcommand-per-operation pattern

**Problem**: `edit` has multiple operations (`replace`, `append`, `insert`) with different argument shapes. Flags don't work — `--replace` needs 2 args, `--append` needs 1, `--insert` needs 2, and they're mutually exclusive.

**Design rule**: if two flags would be mutually exclusive and have different argument shapes, they should be subcommands. Flags answer "how?" — subcommands answer "what?".

**Precedent**: `git remote add/remove`, `docker volume create/inspect`, `kubectl config set-context/use-context`.

**Structure**:
```
backlog-mcp edit <id> replace <old> <new>    → str_replace operation
backlog-mcp edit <id> append <text>          → append operation
backlog-mcp edit <id> insert <line> <text>   → insert operation
```

**Why this works**:
- Commander enforces correct arg count per subcommand automatically
- `--help` shows each operation separately with its own args
- No mutual exclusion logic needed — can't invoke two subcommands at once
- Adding a new operation = adding a new subcommand, zero changes to existing code
- Each subcommand maps 1:1 to a core `EditOperation.type`

**Phase 3 additions** (future):
- `backlog-mcp edit <id>` with no subcommand → opens `$EDITOR`
- `backlog-mcp edit <id> --stdin` → reads JSON operation from stdin for programmatic use

### Phase 3 — Future

- `backlog-mcp edit <id>` opens `$EDITOR` (spawn editor, wait for exit, save changes). Phase 2 is programmatic only.
- Interactive confirmation for `delete` (Phase 2 requires `--force`).
- `backlog-mcp upload <file>` for cloud mode (ADR-0091 future work — local companion pattern).

## Regression Verification

- Before extraction: 456 passing, 24 failing (pre-existing)
- After Phase 1 complete: 513 passing, 24 failing (same pre-existing)
- Typecheck: zero new errors (3 pre-existing in hono-app.ts OAuth code)
- Zero `any` in core/ and service-types.ts
