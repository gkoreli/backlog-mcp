---
title: "The Desk — an Attention-Driven Page for the Read-Only Viewer"
date: 2026-07-17
status: Proposed (distilling PROMPT 0007; probe counts land before build)
author: granite (architect), distilling goga
relates_to:
  - ../prompts/0007-attention-driven-viewer.md
  - ../prompts/0005-judgment-uplift-tenet.md
  - absorption-thesis-2026-07.md
  - worktree-native-access-lattice-2026-07.md
---

# The Desk — a wakeup for the human

Goga's spine, distilled: the viewer is task-heavy; identities and worktrees must
surface *seamlessly, without noise*; and there should be an alternative page
designed from human attention outward — *"what should I look at, read, review
and judge right now."* The viewer stays **read-only**: judgment happens in the
human's head, actuation happens by telling an agent. The page's job is to make
the judgment easy and the telling precise.

## Design laws (all inherited, none new)

1. **Tenet 11 governs.** Bring what matters, never everything. Automating an
   item off the Desk is success, not loss — it frees attention to go a level
   higher. Every surfaced item must say *why it surfaced* (visibility), and the
   page must say what it left out (honest omission).
2. **Tenet 2 applies to humans.** The Desk is budgeted like wakeup: a bounded
   number of items (start: **7**), worst-first, stubs not bodies, one honest
   "N more" line per class. If the Desk floods, the Desk is broken.
3. **The server composes, the viewer renders.** The Desk is a server-owned
   deterministic fold (a `desk` briefing endpoint) — the same law as wakeup.
   No client-side aggregation logic, no LLM, no heuristics: every item class is
   a declared, testable rule over store state.
4. **Read-only with a handle.** Every item carries a **copy-ready agent
   instruction** — one precise sentence the human can paste to their agent
   ("Adjudicate collision MEMO-0004↔MEMO-0007: mark distinct_from with this
   rationale: …"). The viewer never mutates; it makes the *telling* frictionless.
   The verdict then flows back into the store through the agent, and the item
   leaves the Desk because the store changed — never because the UI hid it.

## The four questions the page answers, in order

**JUDGE** — decisions only a human can make, worst-first by staleness × weight:
Proposed ADRs awaiting ruling, proposals awaiting accept/redirect, open-decision
table rows, anything textually parked on the owner. (These currently live in N
scattered places — the probe is counting; the scatter number is the page's
founding argument.)

**REVIEW** — bounded verdicts on machine-surfaced candidates: collision
candidates (0120's queue — the prototype of this whole class), quarantined
documents, candidate qrels awaiting the human tier. Each shows the evidence
inline (the pair, the diagnostic, the proposed grade) so the verdict needs no
navigation.

**READ** — the curated delta, not an activity feed: decisions and law-shaped
documents (vision, prompts, requirements, policies) that changed since the
human's last look, agent-authored first. This is where worktrees and identities
surface *seamlessly*: as provenance chips on items — `by granite`,
`family @ branch, N behind` — never as their own panels. A divergence between a
worktree's law and canonical law is a READ item with a chip, not a new page.

**HEALTH** — standing violations: requirements violated/at-risk (worst-first,
0113.1's ordering reused verbatim), known-issue regressions, and — once the
flywheel runs — memory-hygiene signals (never-recalled clusters, stale
authority). Empty is the goal state and is shown proudly as empty.

## Seamlessness rules for the new concepts (the no-noise contract)

- **Identity** (0119): a chip on items (`by <agent>`), a filter, never a
  dashboard. If identity is absent, the chip is absent — optionality carries
  into the UI.
- **Worktrees/families** (lattice): a chip on affected items and at most one
  READ item when divergence matters. No worktree tree-view in V1 — herdr
  already renders the topology; we surface *consequences*, not topology.
- **The task-heavy main UI stays as-is.** The Desk is an alternative entry
  (`/desk`), not a replacement. If real use shows the Desk is where the human
  always starts, promoting it to default is a later, evidence-based call.

## Build plan

- **V1 (S/M):** the server-side `desk` fold over existing store state (JUDGE
  from document statuses + parked-phrase frontmatter, REVIEW from the collision
  queue + quarantine list + candidates dir, READ from journal/git recency of
  law-shaped substrates, HEALTH from requirement compliance) + one viewer page
  rendering it with chips, budgets, honest omission, and copy-ready
  instructions. Deterministic, fully testable, byte-budgeted like wakeup.
- **V2 (gated on real use):** "since your last look" needs a read-marker; the
  simplest honest mechanism is a local, uncommitted viewer preference (R1-clean,
  never in committed markdown). Deferred until V1 proves the page earns visits.
- **Not built:** notification/push anything; configurable layouts; any mutation
  affordance; any LLM summarization of items (first-person law applies — items
  speak in their authors' words).

## Acceptance (experiment-shaped)

The probe's scatter number is the baseline: today, seeing everything that needs
judgment requires visiting N distinct surfaces. V1 acceptance: the same
inventory visible on one page, ≤7 items above the fold, every item carrying
why-it-surfaced + a paste-ready instruction, zero mutations possible, and the
composition fold covered by tests (each class rule provable with fixtures).
Then the real test: Goga starts his day at `/desk` for a week — if he keeps
returning, it earns default-page candidacy; if he doesn't, the design is wrong
and the week's friction notes say why.

## Kill conditions

An item class that needs an LLM to compose is out (deterministic rules only).
If the fold cannot express "why surfaced" as a testable rule, the class waits.
If V1's page needs more than one new server endpoint, the design has grown a
subsystem and must shrink.
