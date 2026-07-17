---
title: "Uplift Exploration Ledger — Verified Evidence, Landed Decisions"
date: 2026-07-17
status: Living (method: aime ADR 0023.2, adopted on Goga's directive)
author: granite (architect)
relates_to:
  - moat-map-2026-07.md
  - worktree-native-access-lattice-2026-07.md
  - ../adr/0121-retrieval-evaluation-from-first-principles.md
---

# Uplift Exploration Ledger — July 2026

Method adopted verbatim from aime ADR 0023.2 (uplift-driven exploration): start
from an **uplift question** about our own hand-rolled seams, not from a
technology; every exploration must **land** (decision, falsifiable experiment,
shelf trigger, or rejection); every transfer names the smallest mechanism, what
does NOT transfer, and its acceptance check. Goga's standing epistemic law, same
directive: **do not naively trust GitHub READMEs** — claims are marketing until
verified in code, paper, or reproduction.

## Verification annex — README claims vs code (2026-07-17 pass)

| Claim (README) | Verified reality (code-level) | Verdict |
|---|---|---|
| memU: "a 500-line memory system" | `agentic.py` alone is 16.6 KB; the system spans DB repositories, alembic migrations, embedding gateways, client pools, a Rust core | **Marketing framing.** The mechanism inside is still interesting (UQ1) |
| agentmemory: "#1 persistent memory… based on real-world benchmarks" | `benchmark/` = self-run LongMemEval + self-authored quality/load harnesses. LongMemEval measures conversational QA, not coding-agent repo work | **Self-published, category-mismatched.** Confirms M5: nobody benchmarks tokens-to-oriented on a repo |
| beads: "memory upgrade for your coding agent" | Verified via `go.mod`: Dolt + MySQL/Postgres drivers + OTel + anthropic-sdk-go in the engine | **Accurate but infra-heavy**; LLM inside the engine confirmed |
| moat-map claim (ours): "git-native memory space unclaimed; nobody at scale is worktree-aware" | **CORRECTED**: beads has `bd worktree`, shared `.beads/` across worktrees, MCP `(worktree_root, main_repo_root)` resolution | **Our claim was wrong in part** — see UQ3 for why the differentiation survives |
| Mem0 "92.5 LoCoMo", memvid "+35% SOTA", TencentDB "fully local 4-tier" | Not yet verified | **Unverified — do not cite as fact** |

## UQ1 — Does memU's retrieval contain a mechanism that uplifts our recall→get ladder?

**Decision brief.** Our seam: recall returns document-level stubs; `get` hydrates
whole documents; sub-document retrieval (chunking) is shelved behind 0116 R-8's
tail-failure trigger; stub sufficiency is unmeasured (0121 R3 adds the
instrument). Decision this could change: the design of stubs when the
stub-sufficiency instrument reports failures.

**Evidence (code, not README).** `progressive_retrieve`
(`src/memu/app/agentic.py`, `hosts/retrieval.py`, `hosts/instruction.py`):
query embedded **once**; three granularity layers (segment / file / resource)
each ranked against the same vector; all three returned in one call; the agent's
instruction file teaches it to pick the layer ("the result unfolds
progressively, in three layers"). LLM-free by design — convergent with our
Invariant 2 from an independent team.

**Transfer candidate (smallest mechanism).** Not the layers, not the store: the
idea that a stub can carry its **best-matching section** as a cheap sub-document
signal — one heading string per stub, computed at index time from existing
projections, no chunk index, no second embedding pass. What does NOT transfer:
their SQL store, API embeddings, track/category model, host adapters.

**Landing: SHELF with named trigger.** Build nothing now. Trigger: the 0121 R3
stub-sufficiency instrument reports agents hydrating wrong documents at a real
rate, OR 0116 R-8's tail-content trigger fires. Acceptance check if built: the
E2E gate's first-hydration-correct rate moves.

## UQ2 — Does agentmemory's benchmark contain a transferable evaluation mechanism?

**Decision brief.** Our seam: ADR 0121's E2E task gates + the planned outward
cold-open benchmark (moat-map bet 4). Decision this could change: benchmark
design and its credibility standard.

**Evidence.** Their `benchmark/README.md` is honest engineering internally:
nearest-rank p50/p90/p99 against a seeded daemon (1k/10k/100k memories,
concurrency 1/10/100), "p50 will lie to you" discipline. The *headline claim*
built on it is category-mismatched (conversational LongMemEval ≠ coding-agent
repo memory).

**Transfer (small, real).** (a) The load-shape matrix (N × concurrency ×
endpoint, nearest-rank p99) is worth copying the day we publish any daemon
performance number — into `scripts/` next to search-eval, same reproducibility
standard. (b) The negative lesson is bigger: our outward benchmark must not be
self-graded-only — 0121 R3's blind grading + published raw transcripts is the
credibility line agentmemory's "#1" fails to clear. What does NOT transfer:
LongMemEval as a target; conversation-memory framing.

**Landing: ADOPTED as design constraints** on the cold-open benchmark (no new
work item; recorded here and in the benchmark bet's eventual charter).

## UQ3 — What does beads actually do about worktrees, and does our lattice differentiation survive?

**Decision brief.** Our seam: the worktree-native access lattice (proposal, W1–W3).
Decision this could change: the proposal's prior-art claim and its design.

**Evidence.** beads is genuinely worktree-aware: `bd worktree` manages parallel
worktrees; `.beads/` (config + local Dolt data) is **shared across the family**;
`workspace.py` resolves `(worktree_root, main_repo_root)`; doctor/context
surfaces `is_worktree`. Mechanism: **one shared database beside the repo** —
every worktree sees the same store because the store is outside every branch.

**What this proves.** (a) The coordination pain is real enough that the nearest
competitor built commands for it — validates the lattice proposal's premise.
(b) Their mechanism *eliminates* branch-scoped truth rather than composing with
it: a shared external DB cannot express "this document differs on my branch,"
has no divergence concept, and its content never appears in a PR diff. Our
design (branch home + canonical home + divergence stubs, all through git
plumbing) is the thing their architecture structurally cannot do. The moat-map
sentence "unclaimed space" was wrong; the accurate sentence is: **worktree
plumbing exists at scale; branch-aware, review-native worktree memory does
not.**

**Landing: CORRECTION applied** to the moat map (epistemic annex) and recorded
in the lattice proposal's evidence base. The lattice design is unchanged — the
beads evidence sharpens its differentiation section rather than weakening it.
Wider ecosystem scan (forge, agent-hive, cc-pane): worktree-parallel *execution*
is now a common harness pattern; none pairs it with memory. The window is
narrower than "unclaimed" but still open.

## UQ6 — What does ghostty's craft and governance teach the spine? (Goga-directed, 2026-07-17)

**Decision brief.** Ghostty is a beloved, craft-tier, local-first OSS project.
Question: which of its recent moves transfer to our product craft, OSS posture,
or substrate pack? Decisions this could change: OSS contribution governance, the
substrate pack's contents, release discipline.

**Evidence (repo + website, code/doc-level).**
- **`AI_POLICY.md`** at repo root: mandatory AI-use disclosure, "the human in the
  loop must fully understand all code," no AI media, a public denouncement list
  for slop, maintainer exemption by earned trust. A governance artifact for the
  AI era that did not exist as a genre two years ago.
- **`.agents/commands/` + `.agents/skills/`** maintained in-repo alongside
  AGENTS.md and CLAUDE.md — the .md-standards wave at craft-tier OSS, now
  including agent *toolboxes*, not just instructions.
- **Release notes as product surface**: 1.3.0 notes are "painstakingly and
  lovingly hand-crafted by human maintainers… 16+ hours," with a March/September
  release cadence, security advisories with CVEs, and narrative highlights.
  Human authorship is explicitly stated — craft as positioning.

**Landings.**
1. **ADOPT (S, when OSS contributions become real):** a backlog-mcp AI
   contribution policy in ghostty's genre — disclosure + understanding rule —
   written for a project whose *builders are agents*: our twist is that
   provenance is machine-recorded (the journal attributes every write), so our
   policy can be *enforced by the store* rather than by trust. That inversion is
   spine-shaped.
2. **SUBSTRATE-PACK ADDITION:** POLICY as a document class (AI policy,
   contribution law, security policy) — law-shaped documents, which under the
   lattice's freshness classes disclose canonical-fresh in worktrees. Feeds the
   judgment branch: policy is exactly what a human must be asked about rarely
   and precisely.
3. **ADOPT (discipline, no code):** milestone releases (0.70+, 1.0) get
   hand-crafted narrative release notes in the ghostty genre; the per-release
   north-star italics we already write are the seed of this.

## UQ7 — What does herdr formalize that we designed by hand? (Goga-directed, 2026-07-17)

**Decision brief.** Herdr ("agent multiplexer that lives in your terminal") is
the substrate our own fleet runs on — aime consumes its panes today. Question:
which mechanisms in its recent releases (0.7.x, July 2026) transfer to the
lattice, 0119 attribution, the judgment branch, or our API craft?

**Evidence (CHANGELOG 0.7.2–0.7.4, code-adjacent detail level).**
- **`session.snapshot`** — one socket call bootstraps full client state before
  event subscription. Wakeup as a protocol pattern, independently invented.
- **`terminal session observe` vs `control`** — a formalized lane split:
  read-only NDJSON observation streams vs control sessions carrying input,
  resize, release, and **takeover authority**. Our 0117 watcher-never-mutates
  law and aime 0032's observe-only gate, expressed as API surface with named,
  revocable authority.
- **Agent metadata tokens** — sidebar rows with per-agent overrides and custom
  metadata tokens; pane/workspace metadata reported through CLI and socket API;
  per-pane agent lifecycle detection including **blocked-on-permission and
  question dialogs** (Amp/Codex/Claude/Grok/Copilot variants tracked release
  over release).
- **Worktrees rendered as a tree** in the agents-first mobile switcher — herdr
  models agents-in-worktrees as a first-class UI concept.
- **`api schema --json`** — the CLI ships its own JSON Schema; bundled agent
  SKILL.md refreshed per release (the install pattern a third time).

**Landings.**
1. **DESIGN INPUT → lattice W3:** the "main brain reads across worktrees"
   judgment call should be modeled as herdr models control: an explicit,
   revocable **lease with named authority**, never an ambient role. Recorded in
   the lattice proposal's judgment-call framing.
2. **DESIGN INPUT → 0119 Slice A:** herdr pane/workspace metadata is a live,
   machine-resolved identity source already in Goga's stack (aime consumes it);
   the agent substrate's attribution contract should name it as a supported
   origin. No new code in our product.
3. **EVIDENCE → judgment branch:** herdr's blocked-on-permission/question
   detection is the pane-level "needs a human" signal — prior art for the
   attention surface, and the natural upstream feed for a future unified
   judgment queue (herdr detects, aime routes, backlog-mcp remembers).
4. **EVIDENCE → lattice proposal:** worktrees-as-tree in a beloved shipping
   tool = further market validation that agents-in-worktrees is the real
   topology (added to the proposal's prior-art note).
5. **GARDEN:** `session.snapshot` audit of our viewer boot (snapshot-then-
   subscribe vs piecemeal); CLI self-describing schema (`api schema`) — both
   with the trigger "next viewer/API work cycle."

## Standing rules going forward

1. Every future landscape claim cites its verification level: `code-verified` /
   `paper-verified` / `readme-only (unverified)`.
2. README-only claims never enter a moat, threat, or trunk argument — they may
   only motivate a verification probe.
3. Explorations open with a decision brief (which of OUR decisions could this
   change?) and close with a landing. Surveying without landing is not
   exploration (0023.2).
