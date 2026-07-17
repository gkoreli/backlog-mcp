---
title: "The Usage Instrument: Measure the Evidence We Actually Have"
date: 2026-07-16
status: Proposed
author: basalt
relates_to:
  - ../evaluation/reports/usage-instrument-phase-one-v1.json
  - implicit-qrels-from-journal-2026-07.md
  - ../NORTH-STAR.md
---

# The Usage Instrument: Measure the Evidence We Actually Have

## The experiment

I built `pnpm --silent usage:report`, a read-only fold over an explicit operations
journal and memory-usage overlay. It emits aggregate JSON to stdout and has no
output-file option. It does not initialize a runtime, create a control folder,
rewrite a source, expose query text, or emit operation parameters/results.

The report labels each metric `exact`, `heuristic`, or `unavailable`. This is
load-bearing: an absent journal is not reported as a quiet session, and a recall
hit count is not misrepresented as a hit rate.

### Run 1 — tonight's Phase One session

At `2026-07-17T04:55Z`, I ran the instrument against the canonical project
paths under the backlog-mcp checkout. Both
`.backlog/state/operations.jsonl` and
`.backlog/state/memory-usage.jsonl` were absent. The durable report is
[`usage-instrument-phase-one-v1.json`](../evaluation/reports/usage-instrument-phase-one-v1.json).

The result is **no observable Phase One corpus**, not zero Phase One activity.
The fleet did substantial work, but it did not persist that activity through
these two project telemetry files. This falsifies the claim that tonight's
project home already contains hundreds of minable retrievals.

### Run 2 — live positive control

I then ran the same command against the first EXP-1 bolt-on worktree in nisli.
That live sample contained:

| Observation | Count |
|---|---:|
| successful managed writes | 3 |
| `backlog create` | 2 |
| `backlog update` | 1 |
| observed hit recalls | 1 |
| memory ids returned | 2 |
| memory expands | 0 |
| citations | 0 |
| candidate recall→hydration chains | 0 |

The sample proves the instrument distinguishes a present, valid journal from a
missing one and counts the current CLI intent labels without a hard-coded tool
manifest.

### What the source contracts can and cannot prove

| Requested signal | Evidence available today | Report status |
|---|---|---|
| calls by write intent | successful operations JSONL entries | exact when the file exists |
| all tool-call counts | read tools do not enter the operations journal | unavailable |
| observed recall hits | non-empty recall events in the usage overlay | exact when the file exists |
| recall misses / hit rate | zero-result recall returns before logging | unavailable |
| recall→hydration | a later `expand` matches an id from the latest `recall` | heuristic; no session/actor id |
| wakeup section usage | neither wakeup calls nor consumed sections are logged | unavailable |

The candidate-chain fold is intentionally narrow: an expand belongs to the
latest preceding recall segment only when its `MEMO-` id appeared in that
recall. It remains labeled heuristic because concurrent sessions can interleave
in one overlay and direct gets are indistinguishable from recall-driven gets.

### Dogfood friction

The released `backlog-mcp@0.62.0` binary ran, but both `wakeup` and `recall`
against this already docs-native repository stopped with
`DocsNativeMigrationRequiredError`. The checkout still has the old
`.backlog-mcp/config.json` marker and no `.backlog` control directory, so the
released discovery guard asks for a migration. I did not run the migration:
this experiment's R1 contract is zero store writes. The repo-dist CLI reached
the same guard. Consequently, the required dogfood reads could not themselves
produce usage evidence; that is an adoption-friction result, not missing data
to conceal.

## Impact

Every Phase Two experiment now has one small command that answers what its
local telemetry actually supports. The immediate impact is corrective:

- the first requested corpus is absent, so experiments must not use it as a
  denominator or implicit-qrel source;
- observed hit recalls can be counted, but a hit rate cannot be computed until
  misses are observable;
- operations can supply write-intent attribution, but not retrieval sequences;
- an inferred recall→expand pair may become a qrel candidate, never a judgment;
- "section usage" cannot mean client consumption when the server has no
  acknowledgement signal.

This prevents false confidence in the evaluation program more cheaply than a
new telemetry framework. The JSON schema is aggregate-only and immediately
usable by EXP-1/2/4 reports.

## Excitement

The report is not a flashy demo. The exciting part is that the product can now
refuse evidence theater in its own experiments: missing, exact, and inferred
are visibly different. That makes every future claim about memory usefulness
more trustworthy.

## Trunk or branch

**TRUNK instrument.** It does not improve cold-open by itself, but it is the
smallest measurement surface on the critical path to proving Tenet 4's promise
that reading memory is cheaper than re-deriving it. It also embodies Tenet 9:
mine the signals real use already creates, report the pressure gaps, and add no
new collection mechanism until an experiment needs one.

## Cost & falsifiability

**Cost: S.** One pure core fold, one stdout-only script, unit tests, and this
first report.

The instrument should be killed or replaced if two conditions hold after the
other Phase Two experiments run: no experiment consumes its report, and the
canonical usage files remain absent or too sparse to answer a decision. The
recall→hydration heuristic should be killed if independently inspected chains
are mostly unrelated direct gets.

Three follow-on hypotheses are recorded, not built here:

1. Logging zero-result recalls would make hit-vs-miss measurable.
2. A correlation/session id would turn recall→expand adjacency from a
   cross-session heuristic into attributable evidence.
3. Wakeup can report sections *served*, but section *consumption* needs a client
   acknowledgement; those are different metrics and must not be conflated.
