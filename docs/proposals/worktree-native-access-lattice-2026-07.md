---
title: "Worktree-Native Memory and the Access Lattice"
date: 2026-07-17
status: Proposed (distilling Goga's 2026-07-17 vision drop; rulings requested)
author: granite (architect), distilling goga
relates_to:
  - ../NORTH-STAR.md
  - ../adr/0112-docs-native-project-scoped-backlog.md
  - ../adr/0119-agent-substrate-and-derived-correlation.md
  - vision-gaps-audit-2026-07.md
  - moat-map-2026-07.md
  - memory-flywheel-2026-07.md
---

# Worktree-Native Memory and the Access Lattice

Goga's spine, distilled from the source message: *agent identity and agent memory as
optional, modular, configurable — never forced. Bolt on top of the existing world —
worktrees especially: agents delegated into worktrees have decoupled access to the
source of truth; if the main brain updates instructions, vision, tenets, or intake
documents, worktree agents should be able to reach the fresh truth when needed and
stay scoped otherwise. Layered memory: worktree, workspace, global — plus the user's
own memory that agents don't need to know. Sometimes isolation, sometimes not. All of
it should feel native — as if it already existed and we just bolted on. Even someone
who never used backlog-mcp, arriving with accumulated memories, skill files, context
files, should find the ergonomics make so much sense they never look back.*

This proposal names the ideas, grounds them in measured reality, sketches the
architecture, and states the trunk verdicts and the judgment calls that are Goga's.

## The experiment (measured today, on our own fleet)

Our repo currently has **40+ live worktrees** — the fleet's delegation pattern.
Running the released wakeup inside one (`backlog-mcp-wt-0116`, branch sealed at
`dd51e4a`, now **73 commits behind main**):

- The tool **fails outright**: `DocsNativeMigrationRequiredError` — the branch
  predates the control-dir migration, so a worktree agent gets no briefing at all.
- Had it run, it would have briefed from the branch's frozen `docs/`: no ADR 0120,
  no ADR 0121, none of today's vision artifacts — a world 73 commits stale,
  presented with full authority.
- Meanwhile home resolution treats every worktree as an unrelated project (the
  `.git`-marker walk in `core/backlog-home.ts`), so nothing connects the worktree to
  its family. The connection primitive exists and is proven: `git rev-parse
  --git-common-dir` resolves any worktree to its main checkout — we shipped exactly
  this yesterday in aime's project-scoped questions.

This is the strongest kind of evidence: the product's own development process hits
the gap daily. Every mid-operation directive we broadcast to the fleet by message
(rebase-first, review keys, protocol changes) is a workaround for worktree agents
not being able to *read the current law from the store*.

## The ideas, named

### Idea A — The repo family and the canonical home

A **family** is a repo plus all its worktrees, identified by the git common dir.
Within a family there are two kinds of truth:

- the **branch home** — the worktree's own `docs/` at its checked-out state; the
  agent's working scope, exactly today's behavior;
- the **canonical home** — the committed tree of the default branch, read through
  git plumbing (`git show main:docs/…`), never through another checkout's working
  directory.

The canonical home needs no server, no sync, no second store: git *is* the
infrastructure (moat-map M1). Reads are deterministic (a commit hash pins them),
respect the north star's own law (committed markdown is authoritative — a sibling's
uncommitted working tree is nobody's truth), and cost zero new dependencies.

Mechanics, riding seams that already exist:

1. **Family awareness in resolution.** `backlog-home` learns the common-dir probe:
   a worktree home knows its family root and branch. Pure addition; non-git and
   single-checkout repos see no change.
2. **Canonical as a third home class** in the cross-home read coordinator (0112
   Phase D built exactly this composition for global+project: bounded fan-out,
   RRF fusion, provenance labels, honest degradation). A worktree agent's recall
   may fan out to canonical the way project fans out to global today; every stub is
   provenance-tagged `canonical@<sha>`.
3. **Freshness classes per substrate.** The law-shaped documents — vision, agent
   instructions, requirements, prompts — are the ones whose staleness hurts
   (Goga's exact scenario). Substrate declarations gain an optional freshness
   default: law-shaped substrates disclose canonical-fresh in a worktree; work
   items stay branch-scoped. Which substrates default to which class is a taste
   ruling (below).
4. **Divergence disclosure.** When the branch copy of a disclosed document differs
   from canonical, the stub says so: `⚠ diverged from canonical (theirs 2 days
   newer)`. "Your instructions changed while you worked" as a briefing fact, not a
   broadcast message. This single line replaces most of our fleet's re-priming
   traffic.
5. **Migration-shape tolerance.** The failure measured above (old control layout on
   an old branch) becomes a canonical-home fallback instead of a hard error: the
   worktree tool can still orient from the family's canonical truth.

### Idea B — The access lattice (memory scopes, all optional)

Scopes, from innermost out: **agent** (0119 identity; private notes an agent keeps)
→ **worktree/branch** (work-scoped state that dies or merges with the branch) →
**project** (the repo's committed `docs/`) → **global** (`~/.backlog`) → **user-
private** (the human's own memory, invisible to agents by default).

The law that makes this Goga-shaped rather than enterprise-shaped:

- **Nothing is mandatory.** Identity is optional (0119 already rules this); agent
  memory is optional; the lattice degrades gracefully to today's two-home model
  when nothing is configured. Configuration is declaration (`.backlog/config.json`
  + substrate metadata), not code.
- **Isolation is a default, sharing is a grant.** A worktree agent reads canonical
  law but not sibling worktrees. An agent's private memory is invisible to other
  agents unless granted. The user-private tier is invisible to all agents, ever,
  unless explicitly opened — this is the GAP 5 ruling given a mechanism.
- **Attribution ≠ surveillance.** Identity attribution (who wrote this memory,
  which agent completed this task) is provenance for trust decisions, not a
  management layer. It stays journal-derived (0119's design) with optional
  explicit claims.

### Idea C — Bolt-on-native is the adoption law

The tenet, sharpened by Goga's message: *if we can bolt on top of something, life
is great — and arriving users' existing artifacts must just work.* Concretely: the
accumulated CLAUDE.md, AGENTS.md, skill files, memory files, cursor rules a user
already has are read losslessly (Invariant 8), claimed by public-standard substrate
declarations (moat-map M2's substrate pack), and disclosed through the same
briefing — before the user writes a single backlog-mcp-shaped file. Worktree
nativeness is the same tenet applied to git: we did not invent a coordination
layer; git worktrees already are one, and we make the store understand them.

## Trunk or branch

- **Idea A: TRUNK.** It is the bolting tenet applied to the tool's own heaviest
  users (agent teams in worktrees — our fleet, Goga's daily practice), it reuses
  the 0112 cross-home architecture rather than adding one, and it deepens moat M1
  (git-native) and M4 (review-native) simultaneously. The measured failure above is
  a real, daily, unserved need.
- **Idea B: TRUNK-adjacent architecture law.** The lattice is the frame that makes
  A, 0119, and GAP 5 one coherent design instead of three features. Build only
  what A and the flywheel need first (canonical + existing two homes); agent-
  private and user-private tiers await their taste rulings.
- **Idea C: already TRUNK** (it *is* a tenet); this proposal adds the sharpened
  reading — "arriving artifacts just work" — as the adoption acceptance test.

## Technologies required

Nothing new. Git plumbing (`rev-parse --git-common-dir`, `worktree list`,
`show <ref>:<path>`, `merge-base`) behind the existing DI seam that git-recency
already uses; the 0112 home-read coordinator; 0113 substrate metadata for freshness
classes; 0119's substrate for identity when authorized. Zero new dependencies, zero
infrastructure — which is itself the moat argument: beads needed Dolt, MySQL
drivers, and OTel to approximate what `git show` gives us.

## Judgment calls (Goga's)

1. **Freshness defaults**: which substrate classes disclose canonical-fresh in a
   worktree? (My proposal: vision, prompts, requirements, agent-instruction
   substrates fresh; ADRs fresh-with-divergence-flag; tasks/memories branch-scoped.)
2. **User-private memory doctrine** (GAP 5): does `~/.backlog` split into an
   agent-visible tier and a private tier? What's the default?
3. **Sibling visibility**: may an orchestrator-privileged agent read across
   worktree homes (the "main brain" case), and is that a grant or a role?
4. **Naming**: "canonical home" / "family" / "branch home" — words that will be in
   the product forever.

## Staged plan with kill conditions

- **W1 (S): family awareness + canonical read path** behind DI; `wakeup` in a
  worktree names its family, branch, and divergence count. Kill: if canonical reads
  via git plumbing prove unreliable across git versions/platforms, stop before any
  disclosure work.
- **W2 (S/M): canonical fan-out + freshness classes + divergence stubs.**
  Acceptance is experiment-shaped: rerun today's wt-0116 probe — a worktree agent
  must cold-open successfully, see current law, and see its divergence. Kill: if
  the briefing byte budget cannot absorb divergence marks within 3,072 bytes,
  redesign disclosure before shipping.
- **W3 (M, gated on 0119 authorization + taste rulings): lattice tiers** (agent-
  private, user-private) as configuration.
- Dogfood covenant extension: the fleet's own worktree delegation becomes the
  standing testbed; every fleet re-prime that W2 makes unnecessary is a counted
  win (baseline: today's protocol-broadcast traffic).
