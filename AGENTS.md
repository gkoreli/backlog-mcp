# AGENTS.md — Guidelines for AI Agents Working in backlog-mcp

## Testing

### Philosophy

**Unit tests only. No integration tests.**

- Unit tests mock external dependencies (filesystem, network, etc.)
- Tests should be fast, deterministic, and isolated
- If tests touch real filesystem, they're not unit tests

### How It Works

All tests use **memfs** for in-memory filesystem mocking. Zero real file I/O.

1. `vitest.config.ts` loads `src/__tests__/helpers/setup.ts` globally (server package)
2. `setup.ts` mocks `node:fs` with memfs before any test runs
3. Tests call real production code (e.g., `storage.add()`)
4. Production code calls `writeFileSync`/`readFileSync` → intercepted by memfs → stored in RAM
5. Filesystem resets between test files (not between individual tests)

### Test Locations

| Package | Test location | Count |
|---------|--------------|-------|
| Server | `packages/server/src/__tests__/*.test.ts` | 537 |
| Viewer | `packages/viewer/**/*.test.ts` | 92 |

```bash
pnpm test                                # All workspace tests
pnpm --filter backlog-mcp test           # Server only
pnpm --filter @backlog-mcp/viewer test   # Viewer only
```

### Rules

**DO:**
- Write unit tests that use the mocked fs automatically
- Create test data using production APIs (`storage.add()`, etc.)
- Use `beforeAll`/`afterAll` for setup/teardown within a test file
- Mock external modules explicitly with `vi.mock()` when needed
- Use `tmpdir()` for path strings — only fs operations are mocked

**DON'T:**
- Don't write custom fs mocks — use the global memfs setup
- Don't use `beforeEach` to reset filesystem (breaks `beforeAll` patterns)
- Don't rewrite tests to fit mocks — fix the mock instead

### Correct Patterns

```typescript
// Test using production APIs — memfs handles I/O
it('should create a task', () => {
  const task = createTask({ id: 'TASK-0001', title: 'Test' });
  storage.add(task);
  const retrieved = storage.get('TASK-0001');
  expect(retrieved?.title).toBe('Test');
});

// Mock paths module when needed
beforeEach(() => {
  vi.spyOn(paths, 'backlogDataDir', 'get').mockReturnValue('/test/data');
});

// Mock specific modules for isolation
vi.mock('../storage/backlog.js', () => ({
  storage: { list: vi.fn(), get: vi.fn() },
}));
```

### Debugging Test Failures

- **ENOENT** — file wasn't created in virtual fs before reading. Check `storage.add()` was called.
- **Cannot read properties of undefined** — module loaded before mock. Move `vi.mock()` to top of file.
- **Tests pass individually but fail together** — shared state. Filesystem resets per file, not per test.

## Code Style

- **`index.ts` files are barrel exports only** — never put implementation in `index.ts`
- **No re-exporting between packages** — import from the source package directly
- **Minimal code** — only what's needed to solve the problem
- **Declarative with named functions** — not inline callbacks
- **Never use `!` non-null assertions** — use proper narrowing (ternary, `if` check, `??` fallback)
- **Composable, modular, no god files** — decompose into meaningful single-purpose modules; composition over inheritance; strongly typed throughout; JSDoc on exported functions and non-obvious decisions
- **Core-first layering (ADR 0090)** — business logic lives in `src/core/*` as standalone, transport-free functions; MCP tools, CLI commands, and HTTP routes are thin adapters that map params and call core. Any consumer can reuse core.

### File naming convention (ADR 0109)

The repo historically mixed `types.ts`, `*-types.ts`, and would-be `*.types.ts`.
Settle on **suffix-based naming where files are tightly related**, by role:

- **Satellite types** (types that serve exactly one sibling module) → co-locate as
  `<base>.types.ts`. Example: `disk-storage-adapter.ts` + `disk-storage-adapter.types.ts`.
- **Module-wide types** (shared across a whole folder) → keep the folder's
  `types.ts` (already the dominant pattern in `core/`, `context/`, `resources/`,
  `operations/`). Do not split these into per-file satellites.
- **Shared contracts/interfaces** (an interface implemented by several modules and
  consumed widely) → name by the *contract*, not an implementation:
  `<name>.contract.ts`. Example: `IBacklogService` lives in
  `backlog-service.contract.ts` (implemented by local + D1 services, imported by
  ~40 files) — naming it after one implementation would misrepresent ownership.
- **Tightly-coupled siblings in general** share a base name and differ only by
  suffix (`.types.ts`, `.contract.ts`, `.test.ts`) so they sort adjacently and the
  relationship is obvious.

Apply to new and touched files; do not do a sweeping repo-wide rename (churn +
merge-conflict risk) — let legacy `types.ts` files migrate opportunistically.

## Viewer Architecture

### Design System: Tsa (ცა)

The viewer is styled with **Tsa** ("sky" in Georgian) — our design system paired with Nisli.

- All colors are CSS custom properties (`--t-*` prefix), defined in `packages/viewer/theme/`
- Theme switching via `data-theme="dark"|"light"` on `<html>`, persisted to localStorage
- Brand gradient (`#00d4ff → #7b2dff → #ff2d7b`) and entity type gradients are theme-invariant
- Never add hardcoded color values — always use `var(--t-*)` tokens

```
packages/viewer/theme/
├── index.css      # Barrel import
├── tokens.css     # Invariants (fonts, radius, brand gradients)
├── dark.css       # Dark values (default)
└── light.css      # Light values
```

### Markdown & Syntax Highlighting

All markdown concerns live in `packages/viewer/markdown/`:

```
packages/viewer/markdown/
├── index.ts         # Barrel: { marked, highlight, initHighlighter }
├── renderer.ts      # marked + shiki config + custom plugins
├── shiki.css        # Dual-theme CSS variable switching
├── github-dark.css  # GitHub markdown prose (dark, scoped)
└── github-light.css # GitHub markdown prose (light, scoped)
```

**Key decisions (ADR 0111):**
- **Shiki** for syntax highlighting (not highlight.js) — TextMate grammars, VS Code-quality, dual-theme via CSS variables
- **`marked-shiki`** as the bridge — makes `marked.parse()` async
- **Async is a side effect** — consumers use `effect()` + `signal`, never `computed()`, for markdown rendering
- **One render, both themes** — shiki outputs `--shiki-light`/`--shiki-dark` per token; CSS picks the active one

## The Development Loop (maintainer decision, 2026-06-10)

backlog-mcp evolves through a deliberate loop, recorded in the ADR thread:

1. **Research with evidence** — survey the field (delegate to a researcher
   when useful); steal/adapt/reject ideas against our constraints
   (local-first, no LLM in the server write path, human-visible markdown,
   one source of truth). Findings land as an ADR with primary-source links
   (pattern: ADR 0092.5).
2. **Ground in our code** — audit what actually exists before planning
   (pattern: ADR 0092.2 §audit). ADRs cite files, not intentions.
3. **Plan as an ADR** — design + numbered rulings + file-level engineering
   plan, cross-referenced to the thread (patterns: 0092.3, 0092.1).
4. **Engineer in phases** — core-first, modular, committed in logical chunks.
5. **Validate manually** — run the real loop in real processes, not just the
   test suite; it catches what unit tests structurally miss (pattern:
   ADR 0092.6 found the composer.forget race).
6. **Record** — engineering-record ADR with distilled insights, validation
   findings, and next phases (patterns: 0092.4, 0092.6). Then loop.

## Memory Protocol (ADR 0092 thread)

backlog-mcp has a durable memory layer. Memories are first-class entities
(`MEMO-` ids, markdown + frontmatter) — atomic facts you can recall, decay,
supersede, and rank by usage. Use it; don't let each session start cold.

### The loop

1. **Wake up once, at session start** — run `backlog_wakeup` (CLI: `backlog
   wakeup`). One dense briefing: active tasks, current epics, top knowledge,
   recent completions, recent activity. Do not re-run it mid-session.
2. **Recall before starting a task** — `backlog_recall "<topic>"` once for the
   work at hand. Treat hits as ground truth about THIS project's conventions
   and decisions; they override your priors. Recall is the read surface —
   memories are hidden from plain `search`/`list` by design.
3. **Remember what's durable** — when you learn a non-obvious decision, a
   gotcha, a convention, or a fact that will matter next session, write it with
   `backlog_remember`. One atomic fact per memory.
4. **Correct, don't duplicate** — when something you already remembered
   changes, `--supersedes <MEMO-id>` (keeps lineage, expires the old one) or use
   `--state-key <key>` for evolving single-value facts (a new holder auto-closes
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
  viewer); `--expired` hard-deletes already-expired memories (GC).
- Recall/read bumps a memory's `usage_count` + `last_used_at` — useful memories
  rank higher over time, stale ones decay. Self-curating; no action needed.
- When atomic memories sprawl, `backlog_consolidation-candidates` surfaces
  clusters ripe for distillation into fewer `derived` semantic/procedural
  memories (ADR 0092.7). Capture small, compress upward.

## Deployment Posture (ADR 0104)

**Local-first is the primary mode.** The Node/local deployment (filesystem
markdown storage, Orama hybrid BM25+vector search with local embeddings, RAG,
context hydration, agentic memory, live viewer over SSE) is where the product
grows. The Cloudflare Workers + D1 remote mode lost too many of these
capabilities (no local embeddings, no hybrid search/RAG parity) and is
maintained as a constrained satellite, not evolved as an equal. Do not
compromise local-mode capabilities for D1 parity; new features target local
mode first and need no D1 story to ship.

## Monorepo Architecture

### Package Structure

Three workspace packages:

| Package | npm name | Published | Purpose |
|---------|----------|-----------|---------|
| `packages/shared` | `@backlog-mcp/shared` | No (private) | Entity types, ID utilities |
| `packages/server` | `backlog-mcp` | Yes | MCP server, CLI, HTTP API |
| `packages/viewer` | `@backlog-mcp/viewer` | No (private) | Web UI, built assets copied into server |

`@nisli/core` is now maintained externally at <https://github.com/gkoreli/nisli>
and consumed as a normal npm dependency by `packages/viewer`.

### Internal Package Pattern (Compiled Package)

Shared exports source in dev, dist at publish time:

```json
{
  "exports": { ".": "./src/index.ts" },
  "publishConfig": {
    "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } }
  }
}
```

- Dev: TypeScript resolves imports directly from source — no build step needed
- Build: tsdown inlines shared code into server's bundle via `noExternal: ['@backlog-mcp/shared']`

### Why `devDependencies` for `@backlog-mcp/shared`

Shared is in server's `devDependencies`, not `dependencies`:

- **If `dependencies`**: `npm install backlog-mcp` tries to fetch `@backlog-mcp/shared` from registry → fails (private)
- **If `devDependencies`**: consumers never try to install it → no problem
- tsdown bundles it regardless of placement since it's imported

### Publishing

The server package is published via CI:

**Server** (`backlog-mcp`):
```yaml
cd packages/server
cp ../../README.md README.md    # Root README for npm
pnpm pack                       # workspace:* → real versions
npm publish backlog-mcp-*.tgz --provenance --access public
```

`pnpm pack` resolves `workspace:*` to real version numbers. `npm publish` is used (not `pnpm publish`) for OIDC trusted publishing support.

### tsdown Bundling Config

```
skipNodeModulesBundle: true          # Externalize all node_modules
noExternal: ['@backlog-mcp/shared']  # Override: inline shared
```

Both are needed. Without `noExternal`, `skipNodeModulesBundle` would externalize shared via the pnpm workspace symlink.
