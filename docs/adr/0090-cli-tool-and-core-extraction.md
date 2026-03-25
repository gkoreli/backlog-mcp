---
title: "CLI Tool and Core Function Extraction"
date: 2026-03-26
status: Accepted
---

# 0090. CLI Tool and Core Function Extraction

## Problem Statement

All business logic lives inside MCP tool registration callbacks (`src/tools/*.ts`). These functions are tightly coupled to the MCP SDK — they take `McpServer`, define zod schemas inline, and return MCP-formatted `{ content: [{ type: 'text', text: ... }] }` responses.

This means:
- No way to invoke operations from a CLI without going through MCP
- No way to reuse logic from HTTP routes without duplicating it
- Testing requires MCP server mocking
- The project ships as an MCP-only tool — users without MCP clients can't interact with their backlog

## Problem Space

- **Who's affected**: Users who want CLI access (scripting, debugging, quick edits), developers testing operations, HTTP route handlers that duplicate logic
- **Root cause**: Transport-coupled business logic. The "what to do" (create a task, search, etc.) is entangled with "how to receive the request" (MCP protocol)
- **Constraint**: Must not break existing MCP behavior. MCP tools must continue to work identically.
- **What if we're wrong**: If CLI adoption is zero, we still benefit from testable core functions and cleaner MCP wrappers

## Context

### Current Architecture

```
MCP Client → McpServer.registerTool() → inline callback (business logic + MCP formatting)
                                              ↓
                                        IBacklogService (storage)
```

Each tool file (`backlog-list.ts`, `backlog-create.ts`, etc.) exports a single `registerXxxTool(server, service)` function. Business logic is embedded in the callback:
- `backlog-create`: resolves `source_path` from filesystem, generates next entity ID
- `backlog-update`: handles `parent_id`/`epic_id` precedence, nullable field clearing
- `backlog-get`: detects resource URIs vs task IDs, batch fetches with separators
- `backlog-search`: formats results, detects hybrid search mode
- `backlog-context`: delegates to hydration service with dependency injection
- `write_resource`: applies text operations (str_replace, insert, append) to task body

### Existing CLI

Only server management: `serve`, `status`, `stop`, `version`, bridge mode. No task operations.

### Inspiration: cbx CLI

The cbx CLI (`/packages/cbx/src/commands/`) demonstrates the pattern well — each command file is a standalone function that handles args, calls APIs, and formats output. Clean separation between "what to do" and "how to present it."

## Proposed Solutions

### Option 1: Extract to `src/core/` — Standalone Tool Functions (Selected)

Create a `src/core/` directory with one file per operation. Each exports a pure function that takes typed input + `IBacklogService`, returns typed output (plain objects, not MCP content).

```
src/core/
  list.ts      → listItems(service, opts) → { tasks, counts? }
  get.ts       → getItems(service, ids) → string
  create.ts    → createItem(service, opts) → { id }
  update.ts    → updateItem(service, id, opts) → { id }
  delete.ts    → deleteItem(service, id) → { id }
  search.ts    → searchItems(service, opts) → SearchResult
  context.ts   → getContext(deps, opts) → ContextResponse
  write.ts     → writeBody(service, id, op) → { success, message? }
```

MCP tools become thin wrappers: parse zod → call core → format MCP response.
CLI commands become thin wrappers: parse Commander args → call core → format terminal output.

**Pros:**
- Clean hexagonal architecture — core in center, transports on outside
- Core functions are independently testable without MCP mocking
- Guaranteed behavioral parity between MCP and CLI
- HTTP routes can also call core functions (eliminates duplication in hono-app.ts)
- Each layer has a single responsibility

**Cons:**
- New directory and layer (8 files)
- Need to define return types for each core function
- Two layers of thin wrapper could feel like boilerplate

### Option 2: Refactor In-Place — Export Functions from `src/tools/`

Keep core logic in `src/tools/` but refactor each file to export both the standalone function AND the MCP registration.

**Pros:**
- Less file movement
- Fewer new files

**Cons:**
- `src/tools/` becomes mixed concern (core logic + MCP registration in same file)
- Harder to reason about what's "core" vs "transport"
- Import paths become confusing — CLI importing from `tools/` suggests MCP dependency

### Option 3: Enhance IBacklogService

Move all business logic into service methods. MCP and CLI both call service directly.

**Pros:**
- Simplest — no new layer

**Cons:**
- Service becomes bloated with presentation concerns (formatting search results, batch get with separators)
- Violates SRP — storage abstraction handles business logic
- Some operations don't map cleanly (write_resource applies text ops, not storage)
- Hardest to test individual operations in isolation

## Decision

**Selected**: Option 1 — Extract to `src/core/`

**Rationale**: The core extraction creates a clean boundary between "what the system does" (core functions) and "how you talk to it" (MCP, CLI, HTTP). This is the textbook hexagonal/ports-and-adapters pattern. The "boilerplate" concern is minimal — each MCP wrapper is ~5 lines (parse → call → format), and each CLI command is ~10-15 lines (parse args → instantiate service → call → print).

**For this decision to be correct, the following must be true:**
- Core functions can be instantiated with just `IBacklogService` (and deps for context) — no MCP SDK dependency
- Return types are simple enough that both MCP (JSON) and CLI (text) can format them trivially
- The extraction doesn't change any observable behavior for existing MCP clients

**Trade-offs accepted:**
- 8 new files in `src/core/` — acceptable for the separation benefit
- Commander.js as new dependency (~50KB) — acceptable for CLI UX (auto-help, subcommands, validation)

## CLI Design

### Command Mapping

| MCP Tool | CLI Command | Notes |
|----------|-------------|-------|
| `backlog_list` | `backlog list` | Default: active items |
| `backlog_get` | `backlog get <id...>` | Positional args for IDs |
| `backlog_create` | `backlog create <title>` | Title as positional arg |
| `backlog_update` | `backlog update <id>` | ID as positional, fields as flags |
| `backlog_delete` | `backlog delete <id>` | Confirmation prompt (unless --force) |
| `backlog_search` | `backlog search <query>` | Query as positional |
| `backlog_context` | `backlog context <id>` | ID as positional |
| `write_resource` | `backlog edit <id>` | More natural CLI name |

### Output Format

- Human-readable by default (tables, formatted text)
- `--json` flag for machine-readable output
- Errors to stderr, data to stdout

### Service Instantiation

CLI commands need a `BacklogService` instance. Two approaches:
1. **Direct**: Import `BacklogService.getInstance()` — works because it reads from the same `BACKLOG_DATA_DIR`
2. **Via HTTP**: Call the running server's API — adds network dependency

Decision: Direct instantiation. The CLI operates on the same filesystem. No server needs to be running for CLI to work. This is the same pattern as `git` — it reads `.git/` directly, doesn't need a daemon.

### bin Entry

The existing `backlog-mcp` bin entry handles MCP bridge mode. The CLI subcommands integrate into the same entry point — Commander routes to the right handler based on the first argument.

```
backlog-mcp                    → bridge mode (existing, default)
backlog-mcp serve              → HTTP server (existing)
backlog-mcp list               → CLI: list items (new)
backlog-mcp create "Title"     → CLI: create item (new)
backlog-mcp search "query"     → CLI: search (new)
...
```

## Consequences

**Positive:**
- Every MCP operation is available from CLI
- Core functions are independently testable
- HTTP routes can reuse core functions (future cleanup)
- Clean architecture with clear layer boundaries

**Negative:**
- More files to maintain (8 core + 8 CLI commands)
- Commander.js dependency added
- Slightly more indirection for MCP tool calls (wrapper → core → service)

**Risks:**
- CLI service instantiation could conflict with running server's file locks → mitigated: TaskStorage uses simple fs read/write, no locks
- Commander.js could conflict with existing arg parsing in `cli/index.ts` → mitigated: Commander only activates for known subcommands, falls through to existing logic otherwise

## Implementation Notes

### Phase 1: Core Extraction
1. Create `src/core/` with typed functions extracted from `src/tools/`
2. Refactor `src/tools/` to be thin MCP wrappers calling core functions
3. Verify all existing tests pass (behavior unchanged)

### Phase 2: CLI Commands
1. Add `commander` dependency
2. Create `src/cli/commands/` with one file per command
3. Wire Commander program in `src/cli/index.ts`
4. Each command: parse args → `BacklogService.getInstance()` → call core → format output

### Bundling
- `commander` goes in `dependencies` (needed at runtime)
- Core functions are already bundled (same package)
- No changes to tsdown config needed — `src/core/` and `src/cli/commands/` are already covered by the `src/**/*.ts` entry pattern
