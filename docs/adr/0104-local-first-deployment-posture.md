---
title: "0104. Local-First Deployment Posture — D1/Workers Deprioritized"
date: 2026-06-10
status: Accepted
folder: FLDR-0001
---

# 0104. Local-First Deployment Posture — D1/Workers Deprioritized

**Status**: Accepted (product decision by the maintainer, 2026-06-10)
**Relates to**: ADR 0089 (Workers+D1 migration), ADR 0091 (runtime-clean worker
bundle), ADR 0013.7 (hosting decision framework — its "Workers+D1 vs Fly" open
tension is now resolved in favor of neither: local is primary)

## Decision

**The local Node deployment is the primary, growing mode of backlog-mcp. The
Cloudflare Workers + D1 remote mode is maintained as a constrained satellite,
not evolved as an equal.**

## Context and rationale

The D1/Workers migration (ADR 0089) bought edge deployment at the cost of the
capabilities that make backlog-mcp an *agentic context storage engine* rather
than a CRUD task store:

- **Hybrid search / RAG**: local mode runs Orama BM25 + vector with local
  embeddings (transformers.js), rank fusion, temporal decay, title pinning
  (ADRs 0042, 0079–0083). The Worker build cannot run local embeddings and
  lost hybrid search and the RAG-adjacent capabilities built on it.
- **Agentic memory** (ADR 0092 family): capture, durable MEMO- entities,
  recall, wakeup knowledge — all ride the local search pipeline and the
  filesystem substrate. Memory is Node-only and that is now fine by design.
- **Context hydration** (ADR 0074–0078) and the live viewer (SSE) are
  similarly local-first.

Maintaining feature parity drained effort into the weakest environment and
pressured designs toward the lowest common denominator. The product identity
(ADR 0097: markdown-backed, human-visible, local-first storage engine; ADR
0092.5: "the memory system you can read") is fundamentally local.

## Consequences

- New features target local mode first and **need no D1 story to ship**
  (precedent: memory composer is omitted from the Worker build).
- D1/Workers stays deployable for remote access use-cases but receives
  fixes, not feature investment. No new ADR work should expand D1 scope.
- Do not compromise local-mode capability or architecture for D1 parity.
- If remote access matters later, prefer approaches that preserve the local
  engine (e.g. hosting the Node server) over re-implementing on D1.

## Engineering principles (restated as binding)

Captured alongside this decision (see AGENTS.md §Code Style):
composable, declarative, modular code with JSDoc; no god files — decompose
into single-purpose modules; composition over inheritance; strongly typed;
core-first layering per ADR 0090 (business logic in `src/core/*`, transports
are thin adapters — CLI, MCP, HTTP, or any future consumer reuse the same
core).
