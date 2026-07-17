---
title: "Aime bolt-on trial — fast indexing, insufficient cold orientation"
date: 2026-07-16
status: Proposed
author: pyrite
experiment: EXP-1 Owner B
corpus: "~/Documents/goga/aime/docs"
tool: "backlog-mcp@0.62.0"
---

# Aime bolt-on trial — fast indexing, insufficient cold orientation

## Verdict

The adoption mechanism is real: an unprepared, 71-file Aime documentation tree
produced a wakeup in seconds, accepted memories and a task without moving existing
documents, recalled the recorded lesson, and auto-captured task completion.

The stronger adoption claim is not yet earned. The first briefing scored **1.0/5**
for stranger orientation. It pointed at the canon but did not explain the product,
showed no active work despite four Investigating issue files, omitted REQ-0004 while
claiming zero constraints omitted, and selected the oldest accepted ADRs when legacy
documents had no `updated_at`.

**Proposal:** keep the bolt-on thesis on the trunk, but treat the current Cold-Open
claim as failing on a real corpus. Close the separately filed defects, rerun this exact
trial and Nisli's sibling trial, and require a measured pass before expanding the
architecture. Do not invent a generic issue heuristic from one repository.

## 1. The experiment

### Hypothesis and protocol

Hypothesis: released `backlog-mcp@0.62.0`, pointed at Aime with no migration,
configuration or document rewrite, can orient a stranger in under a minute and then
serve as working memory for one real task.

The trial followed EXP-1 literally:

1. froze the cold `docs/` inventory;
2. ran the released CLI with `--project-root <aime> --home project`;
3. captured the first wakeup before creating any memory or task;
4. recorded the result with `remember`, recalled it, created and completed one real
   documentation task, and inspected the journal/usage overlay;
5. independently graded the raw wakeup against the five Phase Two stranger questions.

### Cold corpus

| Artifact | Count |
|---|---:|
| Files under `docs/` | 71 |
| ADRs | 39 |
| Numbered issue documents | 20 |
| Files under `docs/requirements/` | 5 (README + 4 requirements) |
| Other canon/schema/proposal/prompt files | 7 |

The corpus was not curated for backlog-mcp. That is the point of the trial.

### Time and briefing output

| Measurement | Result |
|---|---:|
| First CLI invocation to generated briefing | **17.6 s (0.29 min)** |
| Cold wakeup command | **4.42 s** |
| Warm reproduction | **0.87 s** |
| Cold recall before any memory | **4.4 s, 0 hits** |
| Warm recall of the recorded baseline | **0.76 s, exact hit** |

The first wakeup returned:

- vision: `NORTH-STAR.md` and its title;
- constraints: REQ-0001, REQ-0002 and REQ-0003;
- decisions: accepted ADR 0001, 0004, 0006, 0007 and 0008;
- no active tasks, epics, knowledge, completions, activity or identity;
- `sections_omitted.decisions = 26` and `constraints_omitted = 0`.

This was partially useful in 0.29 minutes: it found the canonical vision and preserved
the requirements' non-ratified `intake` status. It did **not** achieve stranger
orientation in any measured time; the briefing required manual corpus exploration to
answer four of the five questions.

### Independent orientation grade

A read-only subagent received only the exact first-briefing semantics, then inspected
the cold corpus for what evidence had been available. It did not run backlog-mcp or
modify the repository.

| Stranger question | Score | Evidence-based reason |
|---|---:|---|
| What is this? | 0/1 | A path/title is not Aime's companion, local-first or “me uploaded” meaning. |
| Key decisions? | 0.5/1 | Five real foundations surfaced, but 26 were omitted and current ADR-0027 was absent. |
| Active or blocked work? | 0/1 | Empty arrays contradicted ISSUE-0015..0018, all Investigating; 0017/0018 are P0. |
| Constraints? | 0.5/1 | Three intake requirements surfaced honestly, but REQ-0004 silently disappeared. |
| How do I run it? | 0/1 | No install, run, test, typecheck or compile guidance appeared. |
| **Total** | **1.0/5** | Mechanically successful; not stranger-sufficient. |

### Real task: the tool as working memory

The trial then used the released tool to manage a small, real correction:

- `recall "fleetList daemon socket herdr architecture"` correctly missed on the cold
  memory store;
- `create --type task` produced TASK-0001 with a definition of done;
- source inspection proved `fleetList()` now reads the daemon's `fleet.list` snapshot
  (`~/Documents/goga/aime/src/fleet.ts`) and has regression tests for no direct-herdr
  fallback;
- the stale Aime North Star sentence was corrected in one line;
- `update TASK-0001 --status done --evidence ...` persisted three evidence entries;
- completion automatically created MEMO-0002 referring back to TASK-0001;
- a later recall returned the baseline, cache-friction memory, CLI-friction memory and
  completion memory in 0.81 s.

This loop was genuinely useful. Once the right fact had been captured, recall replaced
re-derivation and task completion left a compact durable trace.

### Friction and breakage

1. The first read created an unignored, **7,134,281-byte**
   `.backlog/cache/search-index.json`; `git status` immediately showed `?? .backlog/`.
2. Legacy ADRs without `updated_at` tied on the disclosure sort, so ID-ascending order
   selected old decisions and omitted current ones.
3. REQ-0004 was downgraded to a generic resource without a surfaced diagnostic.
   `list --type requirement` returned only 0001..0003, wakeup still said
   `constraints_omitted: 0`, and `get` on the returned resource ID returned `content:null`.
4. CLI-only dogfood could not follow the program's `capture_requirement` instruction:
   0.62.0 exposes the intent in MCP but only generic `create --type requirement` in CLI.
5. Placing variadic `--tags` before `remember`'s variadic content swallowed the content
   and failed as `missing required argument 'content'`; placing content first worked.
6. Five successful explicit `remember` calls did not appear in `operations.jsonl`. The journal
   contained only task create/update; the usage overlay contained recall. The usage
   instrument therefore cannot reconstruct the whole dogfood session yet.

The reproducible defects are filed separately in
`docs/reports/0002-exp1-aime-bolt-on-bugs.md`.

## 2. Impact

Today, a new agent gets a fast index and a useful canon pointer, then still spends a
manual exploration pass finding what Aime is, what is live, and which decisions are
current. On this corpus the raw briefing answered only 1 of 5 orientation points.

Closing the measured defects would improve the exact North Star scenario rather than
add a peripheral feature:

- clean Git status preserves the claimed zero-adoption cost;
- honest downgrade diagnostics prevent missing requirements from looking complete;
- stable inferred chronology makes old, human-authored ADR folders useful without
  rewriting them;
- complete intent journaling makes Phase Two's usage evidence trustworthy.

The unresolved active-work result is the boundary test. Aime's `ISSUE-*` documents are
well-structured but are not a declared substrate. One corpus is not enough evidence to
add an Issue substrate or a heuristic status mapper. The rerun should determine whether
the existing generic-resource signal is sufficient or whether the adoption claim must
say that structured active-work orientation requires a recognized/project-declared
substrate.

## 3. Excitement

This is a demo worth finishing: point one released command at a repo that never adopted
the tool, get its canon in 18 seconds, correct a real stale statement, and have the lesson
come back from memory under a second. That feels like the product. Showing an empty work
queue beside two live P0 issue files does not. The exciting outcome is not a broader
framework; it is making this exact demo honest end to end.

## 4. Trunk or branch

**TRUNK.** The experiment directly exercises the Cold-Open Test and the docs-native,
zero-migration adoption tenet. It also tests the invariants that artifacts remain human
readable, project-scoped and unmodified, while hidden state stays derived.

The verdict is about the adoption/cold-open capability, not every observed convenience.
CLI intent parity and flexible option ordering are useful branch-level ergonomics. Clean
control state, honest claimed-document diagnostics, relevant disclosure ordering and a
passing real-corpus orientation gate are trunk correctness.

## 5. Cost and falsifiability

**Cost: M** for the measured repair-and-rerun slice:

- S: create a tool-owned `.backlog/.gitignore` on first control-directory creation when
  absent; never overwrite a human-owned file;
- S/M: surface claimed-document downgrade diagnostics and make returned resource IDs
  hydratable;
- S: use the already-required inferred legacy chronology when disclosure inputs lack
  `updated_at`, with an uncurated-corpus fixture;
- S: journal successful `remember` intent writes exactly once;
- S: rerun Aime and Nisli with the same five-question grader.

Do not add generic issue inference in this slice. Record the active-work miss and wait for
the second real corpus before choosing substrate, declaration or claim-narrowing.

This proposal is falsified if either rerun still scores below **4/5**, takes more than one
minute to a useful first wakeup on a warm npm cache, dirties Git after the tool-owned
ignore fix, or silently omits a claimed requirement. If the two corpora require unrelated
heuristics to expose active work, narrow the zero-setup claim instead of building a
universal document guesser.
