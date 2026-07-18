---
title: "The Knowledge-Base Absorption — What Cerebras Validates, What We Take, What We Refuse"
date: 2026-07-18
status: Proposed (assessment + two chartered takeaways + one positioning seed)
author: granite (architect)
relates_to:
  - ../references/REF-0015-cerebras-enterprise-knowledge-base.md
  - ../prompts/0010-knowledge-base-absorption-and-fleet-return.md
  - 0004-absorption-thesis.md (prompt)
  - ../adr/0121-retrieval-evaluation-from-first-principles.md
  - ../adr/0119-agent-substrate-and-derived-correlation.md
---

# The Knowledge-Base Absorption

Goga's question (PROMPT 0010): what can we take away and absorb from the
Cerebras KB post — or have we already absorbed it? Does "backlog is your
knowledge base" hold? Verdict up front: **most of their architecture is our
architecture, independently converged — which is the strongest external
validation the trunk has received.** Two techniques are genuinely worth
taking (one has a live trigger). Three things we refuse. One positioning
seed worth your taste ruling. Epistemic level throughout: blog-claimed
unless marked otherwise.

## Already absorbed — convergent evolution (7 of 10 elements)

| Their element | Our shipped form |
|---|---|
| "Meeting data where it lives"; single-source-of-truth "rarely works" | The docs-native bolt-on thesis verbatim — except we go further: they *copy* into Postgres, we *read in place* |
| One uniform table; every source lands in the same row shape | Substrates-as-data: one registry, one storage claim shape, every type a declaration |
| Custom sources as plugin scripts (arbitrary Python, by PR) | Substrate declarations as **pure JSON, never executable code** — stricter than theirs, deliberately |
| Hybrid full-text + embedding + IDF, "no single scorer trusted" | Orama BM25 (IDF inherent) + vector, fused — shipped since 0081/0116 lineage |
| RRF, k=60, weight/(60+rank) | The literal formula our cross-home fusion uses (0112 Phase D) |
| Age decay ("Slack answers expire") | Memory kinds (current/historical), valid-until, recency sort |
| LLM-free MCP primitives; "Claude Code becomes the orchestration engine" | Our exact MCP posture: intent verbs, narrow structured IO, zero server-side LLM, the agent orchestrates |
| Incremental re-index of changed chunks, sync state co-located | Watcher + ordered mutation chain (0116-1A), INDEX_VERSION, single-flight init |
| Context re-expansion around winners | `get context=true` neighborhood hydration (0114) — theirs is automatic post-rank, ours is agent-pulled (progressive disclosure; ours is the tenet-correct direction) |

An enterprise system answering 15k questions/day (blog-claimed) arrived at
our tenets from the opposite direction — they built the infrastructure we
refuse to require. That is the moat map's thesis observed in the wild.

## Take — two techniques

**T1 — Contextual chunk embedding (their "bursting" prefix), with a LIVE
trigger.** They embed sub-thread chunks *with the thread topic prepended*
(Anthropic contextual retrieval, paper-verified lineage) because "the answer
lives in one tangent message whose vocabulary never makes it into the
summary." Our structural suite's 25 surviving failures are exactly this
failure class: long-document tails invisible to embedding windows. Absorbing
the pattern for us means: each embedded chunk carries its document's
title + heading path as a prefix. This is a ranking-affecting change —
**frozen under 0121 R5** — so it enters as the chartered experiment for the
moment R8 human qrels exist, with the suite's tail-reachability classes as
its before/after gate. It is the first frozen-lane candidate with named
external validation, a paper lineage, and a live in-repo trigger.

**T2 — Normalized-projection embedding.** Their single biggest claimed win:
embed the LLM-normalized {question, summary, resolution, systems} document,
not the raw transcript; keep raw text full-text-searchable. PROMPT 0006
outlaws manufacturing summaries — but notice: **our documents already carry
the normalized projection, authored first-person at write time.** Frontmatter
title/tags/status/layer IS their {question, systems} — written by the doer,
not distilled after the fact. The absorbable move is index-side only: weight
the embedded representation toward the authored frontmatter projection
(title + tags + key fields + body head) rather than raw-body-dominant.
Selection of authored structure, never generation. Also frozen (R5) — second
in the queue behind T1, same gate.

## Refuse — three things, with reasons

1. **Ingestion-copy connectors (Slack/Jira/etc.).** Their world requires
   extraction into a central store; ours reads repos in place. Enterprise
   connector infrastructure is the opposite pole of zero-setup bolt-on and
   the single-user posture. If external knowledge deserves the store, it
   enters as a curated REFERENCE doc (already shipped) — deliberate, cited,
   reviewable. Not trunk, not garden: refused.
2. **Code embeddings (CocoIndex).** Code search belongs to the harness
   (grep/Cursor territory); our substrate is docs, memory, and judgment.
   CocoIndex stays not-code-verified and not-pursued. The one transferable
   idea (language-aware coarse→fine chunk fallback) is recorded inside T1's
   experiment charter as heading-aware chunk boundaries for LONG DOCS —
   markdown headings, not code syntax.
3. **Server-side planner/synthesis LLMs.** Their web UI runs
   planner→executor→synthesis inside the service. Tenet: our engine stays
   deterministic and LLM-free; the agent IS the planner. Their own MCP
   section concedes this design for agent clients — we simply have no other
   client class to serve.

## The positioning seed — "backlog is your knowledge base"

Their KB anatomy is three things: a platform for collecting data, a platform
for querying it, and an auth/audit layer. Read our product through that
frame: **git collects, the memory verbs query, and git IS the auth/audit
layer** (history, blame, review, permissions) — plus one thing they don't
have: the store is versioned WITH the code it describes. For a
codebase-centric team, the honest sentence is: *"You already have the
knowledge base. It's your repo. backlog-mcp makes it answer questions."*
Their `who_knows` tool validates a lane we already designed and shipped the
substrate for — 0119's derived expertise correlation ("who touched what,
attributed in the journal") is `who_knows` without stored aggregates.

This does NOT replace "your backlog is your agent's memory" — memory remains
the north star sentence. Knowledge-base is a *market-facing frame* for the
same trunk, and their scale numbers (blog-claimed) are demand evidence. It
feeds the open NAME/positioning thread rather than deciding it. **Ruling
requested (taste, yours):** adopt "the repo-native knowledge base" as a
positioning register alongside the memory sentence, or keep a single
sentence.

## One warning they hand us for free

"Search everything everywhere rapidly stopped being useful" — at enterprise
scale, they were forced from global search to default-scoped projects. That
is the E1 fusion-at-scale risk observed in production: fused-all reads (our
placement default, R-A) may need scoped defaults as corpora grow. No design
change now — but E1's kill-evidence shape is now concrete, and our homes +
filters are already the fallback seams. Tier-1 telemetry accumulates the
data that will decide it.

## Chartered actions

- T1 + T2 filed as the frozen-lane experiment queue (unblocks on R8).
- E1 kill-evidence note appended here; no build.
- Positioning ruling to Goga (above).
- Everything else: absorbed already or refused — no further work.
