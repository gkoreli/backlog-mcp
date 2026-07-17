---
title: "Moat Map — The Industry Through a New Lens"
date: 2026-07-17
status: Menu (strategy artifact for Goga; audits are menus)
author: granite (architect)
relates_to:
  - ../NORTH-STAR.md
  - memory-flywheel-2026-07.md
  - vision-gaps-audit-2026-07.md
  - ../references/
---

# Moat Map — July 2026

Method: live GitHub reconnaissance via `ghx` (landscape scans across agent-memory,
context-engineering, .md-standards, spec-driven, git-native memory, and retrieval
stacks; dependency-manifest reads of the closest competitors). Star counts are
2026-07-17. This is strategy, not a work order.

## The one-sentence read

Three separate industry waves — files-as-memory, committed-.md standards, and
markdown spec-driven workflows — are converging on **committed markdown as the agent
interface**, and none of the leaders has a type system, a budget discipline, a
deterministic engine, or git as its temporal substrate. We have all four. The
category we can own is not "another memory layer"; it is **the runtime for the
committed-markdown agent ecosystem**.

## The landscape, segmented

**1. Memory platforms (DB/API-first).** Mem0 (61k★, new algorithm benchmarked on
LoCoMo/LongMemEval), Hindsight (18.5k★), OpenViking (26.9k★ "context database"),
memvid (16k★ single-file), Honcho (6k★), TencentDB-Agent-Memory (9k★). Server-shaped,
benchmark-driven, LLM-or-API in the loop. They win conversation memory; none touches
the repo as the store.

**2. Files/markdown-native memory — our bet, arriving without the discipline.**
memU (14k★): "memory stored as files… agents write Markdown," 500 lines, Rust core —
but SQL database + API embeddings behind the files, no schemas, no budgets, personal
memory only. rohitg00/agentmemory (25k★): "#1 persistent memory for coding agents,"
universal MCP client reach — mindshare threat, conversation-lane substance.
hypermnesic (8★): philosophically identical to us ("Markdown files are truth, the
index is disposable, writes are reviewable commits") — tiny, but proof the thesis is
being independently rediscovered.

**3. Agent-native backlog — the nearest claim to our sentence.** beads (25k★, Steve
Yegge): "distributed graph issue tracker for AI agents… a memory upgrade for your
coding agent." Its manifest is the tell: **Dolt** (git-like versioned SQL) + MySQL/
Postgres drivers + OpenTelemetry + **anthropic-sdk-go inside the product**. They
rebuilt git semantics *outside* the repo — a second source of truth, invisible to
PRs and code review, with an LLM dependency in the engine. Choosing Dolt over git is
an admission that git-native is hard. We are already git-native.

**4. The .md-standards wave — schema-less and runtime-less.** AGENTS.md (23k★ open
format), Google Labs DESIGN.md (26k★; a 102k★ awesome-list of DESIGN.md files), dox
(hierarchical self-documenting AGENTS.md), SKILL.md (memU's distribution trick).
Every one is a *convention* — no validation, no disclosure rules, no budgets, no
engine. This is exactly what ADR 0113 substrates are: declared document types with
bounded schemas, projections, and disclosure law.

**5. Spec-driven workflow kits.** agent-os (5k★), conductor (3.6k★), GSD (7.7k★),
"pure Markdown" workflow plugins for every CLI. Process without a store: they
generate the documents; nothing engines them afterward.

**6. Git-native memory — the unclaimed space.** 24 repos total, all small: brain0
(451★ — passive decision graph linking every commit to the prompts behind it; the
closest thing to ADR 0119's derived correlation), git-context-controller (COMMIT/
BRANCH/MERGE over agent memory, arXiv:2508.00031), hypermnesic. Nobody at scale has
claimed "the repo's own history is the memory engine's temporal database." We
shipped the first piece today (git-backed recency).

## The moats — defensible positions aligned with the trunk

**M1 — Git-native temporality and provenance (structural moat).** DB-first
competitors cannot retrofit this; their data does not live in the repo's history.
Ours does, and today's recency adapter proved the seam works. The extension path is
deterministic and infra-free: blame-backed provenance on every stub, `recall
--as-of <ref>` time-travel (the Dolt-killer demo: beads needs a database engine for
what `git checkout` gives us), and memory diffs that are ordinary PR diffs.

**M2 — Substrates as the type system for the .md wave (standard-capture moat).**
AGENTS.md, DESIGN.md, SKILL.md, spec-kit formats are schema-less conventions begging
for a runtime. A packaged **public-substrate pack** — substrate declarations *for
the public standards* — makes backlog-mcp the engine that validates, indexes,
budgets, and discloses the files teams already commit. We ingested AGENTS.md as an
orientation pointer today; claiming it as a substrate is one JSON declaration. This
is a distribution wedge, not just a feature: every repo that adopts a .md standard
becomes a repo our bolt-on immediately understands.

**M3 — Deterministic, CI-gateable memory (posture moat).** Every large competitor
has an LLM or API call inside the engine (beads ships an Anthropic SDK; memU needs
API embeddings; Mem0/Hindsight are LLM-pipelines). Our server is a pure function of
the repo. Consequence nobody else can copy cheaply: **memory behavior runs in CI**.
Cold-Open and Amnesia as executable gates are product features disguised as tests —
"memory you can test" is a sentence none of them can say.

**M4 — Review-native memory (workflow moat).** Because the store is committed
markdown, memory changes are PR diffs a human can review, and adjudication
(collisions, quarantines, `distinct_from`) is durable and legible. Beads' Dolt data
and every DB competitor are opaque to GitHub. This composes with GAP 4 (the human
adjudication surface) into something no one has: memory with a review culture.

**M5 — Byte-budget discipline (economics moat).** The industry benchmarks accuracy
(LoCoMo, LongMemEval); nobody benchmarks *tokens-to-oriented*. Our wire-exact 3 KiB
briefing and the 0121 E2E instrument (correctness + tokens + wall-clock) measure the
thing buyers actually pay for. Publishing that benchmark — cold-open orientation on
unseen repos, tool vs raw-files vs competitors — is a standard-setting play; the
existing benchmarks cannot express it because they have no repo.

## Tech-stack calls (aligned with trunk; adopt / probe / park / reject)

| Tech | Call | Why |
|---|---|---|
| **model2vec / static embeddings** (MinishLab, 2.2k★; 50× smaller, up to 500× faster, no runtime model download) | **Probe now** | Our first-wakeup cost is model download+init (17.6 s in the aime trial). A static model could make cold-open instant and shrink the dist. Enters via 0116's own law: as a measured challenger against the frozen tripwire + E2E gates. |
| **SKILL.md agent-driven install** (memU's distribution) | **Adopt the pattern** | "Tell your agent: read this SKILL.md and install" — one message, zero human steps. We are MCP-native already; shipping an install SKILL.md is hours of work and widens the funnel to every CLI harness. |
| **Dolt** (beads' base) | **Reject; study federation** | Second source of truth violates docs-native law. But beads' FEDERATION-SETUP is worth reading when multi-home sync pressure arrives. |
| **Loro + loro-extended** (5.9k★, 1.0 shipped, multi-agent toolkit emerging) | **Keep parked, pulse healthy** | Garden triggers unchanged (concurrent multi-agent writing). loro-extended's schema layer is the piece to watch. |
| **zvec / LodeDB / embedded vector DBs** (zvec 15k★) | **Park under 0116 R-2** | Engine swap needs a reproduced product-corpus ceiling; none exists — search is our healthiest lane. |
| **brain0's commit↔prompt linkage** | **Garden, feeds 0119** | Passive provenance of *why* a commit exists aligns with the agent-substrate derived-correlation design; revisit at 0119 build time. |
| **OpenTelemetry in the engine** (beads) | **Reject** | Our observability is the journal + usage overlay, R1-clean; OTel is server-product thinking. |

## Feature bets that compound the moats

1. **Public-substrate pack** (M2) — declarations for AGENTS.md, DESIGN.md, SKILL.md,
   spec formats. S per substrate; zero product code by construction (0113's whole
   point, proven three times).
2. **Time-travel recall** (M1) — `recall --as-of`, blame-backed stub provenance.
   S/M; pure git plumbing behind the existing DI seam.
3. **Memory-in-PR** (M4) — a CI comment: what this PR changes in the backlog's
   memory (new decisions, superseded knowledge, collision candidates). S; reuses
   existing folds.
4. **The cold-open benchmark, published** (M5) — our E2E harness run against unseen
   public repos, tool vs raw-files vs memU/agentmemory, tokens and correctness
   reported. The evaluation reset (0121) built this instrument; pointing it outward
   makes it marketing that cannot be faked.
5. **The flywheel** (proposed separately) — none of the above matters if the store
   stays empty; intake remains the trunk of trunks.

## Threats, honestly

- **agentmemory (25k★)** owns the "#1 memory for coding agents" mindshare with
  benchmark claims; if it goes repo-native before we're visible, the category
  sentence gets harder to claim. Our counter is M3+M5: determinism and measured
  token economics they cannot retrofit quickly.
- **beads + Yegge's reach** legitimizes "backlog as agent memory" — good for the
  category, dangerous for naming it first. Our counter is M1+M4: we are *in* the
  repo they federate *beside*.
- **memU's install UX** is genuinely better than ours today. Close that gap cheaply
  (SKILL.md) before it becomes their moat.
- **The .md wave could standardize without us** — if AGENTS.md/DESIGN.md grow
  official validators, M2's window narrows. The public-substrate pack is the
  cheapest land-grab in this document.

## Follow-ups

Reference substrate: add REF documents for beads, memU, agentmemory, model2vec,
brain0, AGENTS.md/DESIGN.md standards (citations gathered this session). Candidate
next experiments: model2vec challenger run; SKILL.md install trial on a cold agent;
cold-open benchmark dry run against one public repo.
