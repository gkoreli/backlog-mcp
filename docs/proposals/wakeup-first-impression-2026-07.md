---
title: "Wakeup First Impression — Cold Orientation Quality and Budget Discipline"
date: 2026-07-16
status: Proposed
author: "agate, synthesizing EXP-1a/EXP-1b/EXP-2; domain rulings by beryl; distillation rulings by shale"
evidence_commits:
  - "bd2463c — Nisli bolt-on trial"
  - "b39080f — Aime bolt-on trial"
  - "348a4ed — Erent cold-open A/B"
relates_to:
  - ../NORTH-STAR.md
  - nisli-zero-setup-cold-open-2026-07.md
  - validated-wakeup-byte-budget-2026-07.md
  - wakeup-budget-ledger-2026-07.md
---

# Wakeup first impression

*One cold-orientation workstream: improve what the first briefing says, and
prove the whole answer still earns its bytes.*

## The experiment

### Three independent trials found one gap

Phase Two ran two zero-setup bolt-on trials and one blinded cold-open A/B on
three repositories that were not prepared for backlog-mcp. All used the
released 0.62 line. Their corpora, graders, and failure shapes differed; their
verdict did not.

| Trial | Corpus and protocol | First-impression result | What worked underneath |
| --- | --- | --- | --- |
| Nisli EXP-1a | 59 existing docs; released CLI pointed at an untouched worktree | First wakeup took 4.33 s and scored **0/10**. Even after 2.1 min, wakeup showed only experiment-authored state, not the pre-existing repo. | Recall returned **5/5** logged frictions in 0.65 s; focused hybrid search found and hydrated the canonical issue ledger in 0.68 s. |
| Aime EXP-1b | 71 existing docs: 39 ADRs, 20 issue docs, 4 requirements plus their README | First invocation produced a briefing in 17.6 s; the cold wakeup itself took 4.42 s and scored **1.0/5**. It pointed at the vision, three requirements, and five old ADRs, but missed identity, live work, run commands, a claimed requirement, and current decisions. | Warm wakeup took 0.87 s; recall of the captured baseline was an exact hit in 0.76 s; the task/memory loop completed useful real work. |
| Erent EXP-2 | Two fresh tool-only runs and two raw-file runs on the same five questions; answers blindly graded against an independent key | Tool-only scored **8/10** twice, using 39,516/40,795 tokens and 89.9/84.4 s. Raw files scored **10/10** twice, using 22,103/23,438 tokens and 43.6/53.1 s. Raw files won at about 57% of the tokens and 55% of the time. | The tool found identity, architecture, and constraints. Its entire correctness loss was temporal grounding (Q3) and root run guidance (Q5), one point each. |

The source records are:

- `docs/proposals/nisli-zero-setup-cold-open-2026-07.md` at `bd2463c`;
- `docs/proposals/aime-bolt-on-trial-2026-07.md` at `b39080f`; and
- `docs/proposals/cold-open-ab-experiment-2026-07.md` at `348a4ed`.

The shared result is narrower than “retrieval is weak.” Search, recall, writes,
and task completion worked once an agent already knew what to ask. The failure
is **wakeup's first impression of a pre-existing corpus**: it does not provide
enough map to form the first useful retrieval intent.

### The failures localize to four first-impression seams

1. **Temporal grounding.** Aime's accepted ADRs lacked managed
   `updated_at`, so the disclosure fold tied and selected the oldest IDs. Erent
   agents called shipped work “in flight” because the most recent truth lived in
   repository history, not the surfaced document dates.
2. **Root orientation.** Nisli and Erent keep their highest-density overview,
   contributor rules, and run commands in repo-root `README.md` and `AGENTS.md`.
   They were outside the discovered corpus.
3. **Vision discovery.** The C.2 pointer assumes `NORTH-STAR.md`. Erent uses
   `NORTH_STAR.md`; the same concept with an underscore silently disappears.
4. **Empty or self-state-only wakeup.** Nisli's 59 indexed docs produced an
   empty briefing. Creating experiment entities made wakeup describe the
   experiment, not the repository. Aime looked populated but still omitted the
   files a stranger needed first.

No trial supports an LLM summary, generic issue inference, repository-specific
status guessing, or another search system.

### A fourth experiment bounds the answer

Chert's validated byte-budget run used the real wakeup fold, Cold-Open and
Amnesia fixtures, and the actual pretty-JSON MCP boundary. It measured:

| Briefing | Pretty UTF-8 bytes | Compact bytes |
| --- | ---: | ---: |
| Real backlog-mcp corpus | 772 | 564 |
| Cold-Open fixture | 2,317 | 1,580 |
| Amnesia fixture | 1,366 | 1,006 |

The experiment found no pressure for a runtime allocator. An honest omission
ledger added about 280 bytes and made a 2,400-byte cap delete decisions even
though the unbounded briefing had fit. Caps below 3 KiB destroyed required
Cold-Open or Amnesia facts. The validated trunk result is the **aggregate budget
invariant**, not allocation machinery.

That result resolves the useful half of the earlier
[wakeup budget ledger](./wakeup-budget-ledger-2026-07.md): one component must own
the total, but today that owner should be an acceptance instrument. The current
Cold-Open test's compact-JSON `/4` proxy allows 1,200 estimated tokens—twice the
North Star's stated ~600-token order target—and does not measure the bytes users
receive. Adding first-impression pointers without tightening that gate would
improve quality while leaving composition drift invisible.

## The fix charter

### Slice A — one budgeted orientation map, pointers only

`wakeup` gains one bounded orientation line made of openable resource stubs:

- repo-root `README.md` when present;
- repo-root `AGENTS.md` when present;
- the project vision document; and
- existing index documents such as `docs/adr/README.md` and
  `docs/issues/README.md`, within the remaining pointer budget.

The briefing contains path, role, and short title—not file bodies. Every target
joins the resource catalog losslessly so the same ID/path hydrates with `get`.
There is no copy into `docs/`, no frontmatter synthesis, no normalization of
human prose, and no “ingestion” that creates a second source of truth.

The pointer line remains available when tool-authored tasks or memories exist;
there is no speculative “self-state” classifier. When the typed briefing has no
project grounding, the line also says that existing documents are indexed and
names the first places to open. A rich corpus must never render as an
authoritative empty project.

Vision discovery uses the same mechanism. Search only the repo/docs roots for
Markdown filenames whose case-folded stem, after removing `-` and `_`, is
`northstar`. This covers the two observed spellings without fuzzy content
classification. One match becomes the vision pointer. Multiple matches are
surfaced as candidates with a diagnostic rather than silently choosing an
authority.

### Slice B — temporal grounding stays pure and earns each fallback

The transport-free wakeup fold accepts an optional, already-computed recency map
through its dependency object. Its comparator is:

1. valid frontmatter `updated_at`;
2. injected observed recency when `updated_at` is absent; and
3. stable ID/path order as the final tie-break.

Core never shells out, reads Git, or touches the filesystem. The local Node
composition may build the map from repository history/mtime and inject plain
data; callers without that capability omit it and retain deterministic behavior.
This is the same dependency-injection law already used for identity, vision,
operations, and memory provenance.

Implementation is deliberately staged:

1. Replay the Aime timestamp-less ADR corpus and Erent disciplined docs using
   valid frontmatter `updated_at` only. Record whether ordering and Q3 already
   close.
2. If either remains stale, add the smallest local Git-backed recency adapter
   outside core and rerun both environments.
3. Keep the adapter only if it changes the measured grade/current-decision
   result. A fallback that merely sounds chronological does not ship.

The map orders disclosed evidence; it does not invent active work or turn Git
commit text into a new substrate.

### Slice C — make the budget gate match the wire

Replace the loose compact-JSON `/4 <= 1200` tripwire with assertions over the
exact pretty UTF-8 payload emitted by the MCP adapter:

- Cold-Open, Amnesia, and an all-sections pressure fixture each retain every
  scenario-required fact;
- the first-impression pointer line participates in the same total; and
- each complete payload stays at or below **3,072 pretty bytes**.

Three KiB is the evidenced ceiling: today's broadest fixture is 2,317 bytes,
and the validated prototype preserved all facts below that ceiling while
smaller caps began deleting them. The test reports exact bytes and the existing
approximate token estimate, so the ~600-token product target stays visible.

No runtime aggregate allocator ships in this slice. If a required real briefing
later crosses 3,072 bytes, first remove redundant transport metadata or lower
source stub caps. Revisit allocation only after an accepted real/all-sections
fixture proves required facts genuinely cannot coexist.

### Correctness repairs that ride the rerun

The dogfood trials also exposed three evidence-integrity defects. They accompany
the same repair batch but do not justify new wakeup concepts:

1. **Remember journaling.** Every successful CLI/MCP `remember` intent emits
   exactly one actor-attributed operation row with its resource ID; failed
   writes emit none. Internal entity creation must not double-count it.
2. **Visible requirement quarantine.** A malformed document in a claimed
   requirement folder remains quarantined as a generic, lossless resource. The
   bug is silent downgrade: wakeup must expose that constraint disclosure is
   incomplete, and the resource ID returned by search must hydrate. The file is
   not coerced into a requirement and is never rewritten.
3. **Derived-state hygiene (P1).** The first read must not leave `.backlog/`
   Git-visible. Nisli measured a 4,801,653-byte cache; Aime measured 7,134,281
   bytes, and the third trial reproduced the same class. A tool-owned ignore
   boundary may be created only when absent and must never overwrite a human
   file.

## Impact

This workstream has three predeclared user-visible deltas:

- Nisli's first wakeup moves from **0/10 to at least 8/10** without migration;
- Aime's first briefing moves from **1.0/5 to at least 4/5**, selects current
  decisions, and never implies complete constraints while a claimed document is
  quarantined; and
- Erent's two tool-only answers move from **8/10 to 10/10**, closing Q3 and Q5
  without exceeding the same eight-call limit.

The quality gain must remain budgeted: the exact pretty payload stays under
3,072 bytes with all required facts present. This turns “one command, under a
minute, ~600 dense tokens” from prose into one reproducible quality-and-cost
gate.

The expected product effect is not more retrieval. It is eliminating the manual
filesystem pass currently required before retrieval becomes useful. If the
reruns still need that pass, the zero-setup Cold-Open claim shrinks.

## Excitement

Yes. The centerpiece demo is now objective: cold-open Nisli, Aime, or Erent;
run one command; receive an honest map to purpose, rules, current decisions,
vision, and live work; hydrate only what matters; score the same answer 8/10 or
10/10 in under a minute; and show that the whole wire payload is still under
3 KiB. It makes the product feel inevitable because the unchanged repository
proves the claim, not because the briefing grew clever.

## Trunk or branch

**TRUNK.** Three independent orientation trials falsified the North Star's first
scenario in the same place. A fourth validated experiment proved the budget
invariant needed to fix that place without weakening Tenet 2. The workstream
directly serves:

- the Cold-Open Test's one-command, under-one-minute promise;
- Tenet 2, progressive disclosure (map first, bodies on demand);
- Tenet 6, docs-native zero-migration adoption;
- Tenet 8, every context byte earns its place; and
- Invariant 8, human-authored files are read losslessly and never rewritten.

Remember journaling, visible quarantine, and control-state hygiene are repair
companions. They preserve the evidence and trust required to judge the trunk
work; they are not reasons to broaden cold orientation into a new subsystem.

## Cost & falsifiability

**Cost: M** for the complete charter: three bounded orientation/budget slices,
three small correctness repairs, and scripted reruns of the existing trials.
Each implementation slice remains S or S/M. Stop if any slice grows into an LLM
summary, heuristic issue classifier, configuration language, runtime allocator,
or cross-environment parity project.

### One acceptance harness

1. **Nisli EXP-1a:** clean bolt-on; first-wakeup grade >=8/10; useful in under
   60 seconds; root/index pointers hydrate; no source rewrite.
2. **Aime EXP-1b:** same corpus; grade >=4/5; newest applicable decisions beat
   oldest-ID fallback; malformed REQ remains readable and visibly quarantined;
   first read leaves Git clean.
3. **Erent EXP-2:** repeat N=2 per arm, blind grading, same five questions and
   <=8 tool calls. Both tool runs must score 10/10; Q3 and Q5 must each move
   from 1/2 to 2/2. `NORTH_STAR.md` must surface as the vision pointer.
4. **Budget E2E:** Cold-Open, Amnesia, and all-sections fixtures retain every
   required fact and emit <=3,072 pretty UTF-8 bytes at the real MCP boundary.
5. **Evidence integrity:** CLI and MCP remember writes journal exactly once;
   failed writes do not; resource search IDs hydrate; quarantine and omission
   counts cannot imply completeness.

### What kills or shrinks the work

- If frontmatter chronology passes both temporal environments, Git recency is
  unnecessary and does not ship.
- If an injected recency map does not move Erent Q3 to 2/2 and surface Aime's
  current decisions, remove it rather than adding semantic Git interpretation.
- If root/vision/index pointers do not move Nisli to >=8/10, Aime to >=4/5, and
  Erent Q5 to 2/2, do not inline their bodies; narrow the zero-setup claim or run
  the next measured experiment.
- If the three repositories require repo-specific classifiers, the universal
  bolt-on claim is false at that boundary.
- If the required facts plus pointers exceed 3,072 pretty bytes, reduce
  redundant output before proposing allocation. If facts still cannot fit, the
  evidence may reopen the allocator decision.
- N=2 per Erent arm is small. A flipped result at N=5 voids the exact advantage;
  the localized first-impression defects remain independently reproduced.
