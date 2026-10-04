# Packages, deployment posture, and releases

Read this when changing package boundaries, dependencies, exports, build or bundling configuration, deployment assumptions, user-facing behavior, the changelog, versions, or publishing.
These are active contributor instructions, reached from [AGENTS.md](../../AGENTS.md).

Deployment policy is owned by [ADR 0104](../adr/0104-local-first-deployment-posture.md)
and [NORTH-STAR Invariant 4](../NORTH-STAR.md).
The posture below summarizes those decisions.

## Deployment Posture (ADR 0104)

**Local-first is the primary mode.** The Node/local deployment (filesystem
markdown storage, Orama hybrid BM25+vector search with local embeddings, RAG,
context hydration, agentic memory, live viewer over SSE) is where the product
grows. The Cloudflare Workers + D1 remote mode lost too many of these
capabilities (no local embeddings, no hybrid search/RAG parity) and is
descoped — retained, no parity owed (NORTH-STAR Invariant 4). Do not
compromise local-mode capabilities for D1 parity; new features target local
mode first and need no D1 story to ship.

## Monorepo Architecture

### Package Structure

Four workspace packages:

- `packages/shared` — npm name `@backlog-mcp/shared`; private, not published.
  Entity types and ID utilities.
- `packages/server` — npm name `backlog-mcp`; published.
  MCP server, CLI, and HTTP API.
- `packages/memory` — npm name `@backlog-mcp/memory`; private, not published.
  Hybrid search (Orama BM25 + vector), memory retrieval/ranking.
- `packages/viewer` — npm name `@backlog-mcp/viewer`; private, not published.
  Web UI; built assets copied into server.

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

### Versioning & Changelog

Every version bump updates `CHANGELOG.md` in the same change — a bump commit that
does not touch the changelog is incomplete. The flow (keep-a-changelog format):

- User-facing work lands under `## [Unreleased]` as it merges, grouped into
  `### Added` / `### Changed` / `### Fixed` / `### Removed`.
- The `chore: bump versions (server X, viewer Y)` commit renames `[Unreleased]`
  to `## [X] — YYYY-MM-DD` and opens a fresh empty `[Unreleased]`.
- *User-facing* means a tool / CLI / viewer behavior, a schema, or a storage-layout
  change an agent or human would notice. Internal refactors and test-only changes
  stay out unless they change observable behavior.

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
