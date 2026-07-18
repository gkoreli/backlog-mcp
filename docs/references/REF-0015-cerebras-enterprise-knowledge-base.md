---
title: "REF-0015 — Cerebras: How We Built Our Enterprise Knowledge Base"
date: 2026-07-18
status: Captured
author: granite
source_url: https://www.cerebras.ai/blog/how-we-built-our-knowledge-base
verification: blog-claimed (their numbers and accuracy claims unverified; cited papers paper-verified; CocoIndex not code-verified)
relates_to:
  - ../proposals/knowledge-base-absorption-2026-07.md
  - ../prompts/0010-knowledge-base-absorption-and-fleet-return.md
---

# REF-0015 — Cerebras Enterprise Knowledge Base (2026)

Internal KB serving **15,000 questions/day** (blog-claimed), "used by humans,
automations and agents," launched ~3 months before the post.

## Architecture (as described)

- **Anti-single-platform thesis**: "the dream of a single source of truth
  rarely works in practice" — extract from where data lives (Slack, GitHub,
  Jira, docs) rather than migrating anything.
- **One Postgres table** holds embeddings + raw summaries + metadata from all
  sources; every source lands in the same row shape; anything in the table is
  immediately queryable. Custom sources = plugin Python scripts submitted by
  PR that emit rows in the shared schema.
- **Hybrid retrieval, no scorer trusted alone**: Postgres GIN full-text (exact
  tokens: error strings, flags), embeddings (paraphrase), IDF (rare-token
  signal vs "sounds good, thanks!"), age decay (Slack answers expire). Fused
  with **RRF, k=60, weight/(60+rank)** — consensus beats a single strong vote.
  Then a small 0-10 reranker keeps top ten; then **context re-expansion**
  (neighboring sections pulled back around winners).
- **Distillation**: Slack threads are NOT embedded raw. An LLM extracts
  {question, summary, resolution, systems, code_refs}; the normalized document
  is embedded (3,072 dims); raw text stays full-text-searchable. "Accuracy
  increased significantly when the thread was normalized into a consistent
  format."
- **Bursting**: consecutive same-author message runs embedded individually
  **with the thread topic prepended as context** (Anthropic contextual
  retrieval), gated by IDF ≥ 4.0, ≥ 200 chars, or reactions — low-signal
  bursts never reach the store.
- **Code**: CocoIndex (OSS) for language-aware recursive chunking
  (class → method → block), incremental re-embed of changed chunks only, sync
  state co-located in the same Postgres. Adopted after Cursor's semantic-search
  findings despite "grep is all you need" doubts.
- **Serving**: planner LLM picks tools → executor fans out in parallel →
  synthesis LLM with citations. **MCP exposes the retrieval primitives
  directly** (search, search_slack, search_code, who_knows) — "intentionally
  simple and as LLM-free as possible"; "Claude Code, or any MCP-compatible
  agent, becomes the orchestration engine."
- **Projects**: "search everything everywhere rapidly stopped being useful."
  A project = named bundle of shared (not duplicated) sources; a default
  project on the user profile scopes queries automatically.
- **who_knows**: people with demonstrated expertise on a topic, as a tool.

## Citations they build on

HNSW (Malkov/Yashunin) · Anthropic Contextual Retrieval (2024) · RRF
(Cormack et al., SIGIR 2009) · Search-o1 (2025) · Anthropic Code Execution
with MCP (2025) · Lost in the Middle (2023) · Cursor semantic-search (2025).
