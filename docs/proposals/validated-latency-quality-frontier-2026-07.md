---
title: "Validated external mining: latency-quality frontiers"
date: 2026-07-16
status: Proposed — EXP-4 reproduction complete
author: chert
external_candidate: LongMemEval-V2
---

# Latency-quality frontiers: steal the Pareto check, not LAFS

## The experiment

The post-garden GitHub scan found
[LongMemEval-V2](https://github.com/xiaowu0162/LongMemEval-V2), created
2026-05-11 and therefore available but missed when the garden froze. Its new
leaderboard scores memory systems as an accuracy/latency frontier rather than
as accuracy alone. The authoritative implementation is the repository's
[`leaderboard/compute_lafs.py`](https://github.com/xiaowu0162/LongMemEval-V2/blob/main/leaderboard/compute_lafs.py): keep non-dominated operating points, then integrate the best accuracy available under each latency budget uniformly over log time from 1 to 200 seconds. The submission contract uses overall accuracy and average memory-query seconds
([leaderboard README](https://github.com/xiaowu0162/LongMemEval-V2/blob/main/leaderboard/README.md)).

I ran that exact upstream implementation in memory against backlog-mcp's sealed
[`search-baseline-v1.json`](./../evaluation/reports/search-baseline-v1.json).
The two real operating points were nDCG@10 × 100 as the quality coordinate and
warm-query latency as the time coordinate. This is a structural sensitivity
test, not a leaderboard-compatible LongMemEval accuracy run; it asks whether
the formula changes our choice, not whether our search score is comparable to
their QA score:

| Mode | nDCG@10 | p50 | p95 |
| --- | ---: | ---: | ---: |
| BM25 | 84.2505 | 30.812 ms | 50.498 ms |
| Hybrid | 86.3263 | 35.222 ms | 52.969 ms |

Exact reproduction command (the upstream scorer is fetched and executed without
modification; run from the repository root):

```bash
python3 - <<'PY'
import json, urllib.request
d = json.load(open('docs/evaluation/reports/search-baseline-v1.json'))
ns = {'__name__': 'not_main'}
src = urllib.request.urlopen(
    'https://raw.githubusercontent.com/xiaowu0162/LongMemEval-V2/main/leaderboard/compute_lafs.py'
).read()
exec(src, ns)
Point, lafs = ns['Point'], ns['lafs']
for latency, bounds in [('p50', (1, 200)), ('p50', (.01, 1)),
                        ('p50', (.02, .2)), ('p95', (.02, .2))]:
    points = [Point(mode, run['overall']['ndcgAt10'] * 100,
                    run['warm_query_latency_ms'][latency] / 1000)
              for mode, run in d['modes'].items()]
    base = lafs(points[:1], *bounds)
    combined = lafs(points, *bounds)
    print(latency, bounds, base, combined, combined - base)
PY
```

Results:

| Scoring window | Latency statistic | BM25 LAFS | BM25+hybrid LAFS | Hybrid gain |
| --- | --- | ---: | ---: | ---: |
| Upstream 1–200 s | p50 | 84.2505 | 86.3263 | +2.0759 |
| Local proxy 10 ms–1 s | p50 | 63.6630 | 65.1713 | +1.5083 |
| Local proxy 20–200 ms | p50 | 68.4375 | 70.0032 | +1.5657 |
| Local proxy 20–200 ms | p95 | 50.3612 | 51.5590 | +1.1978 |

Both modes are Pareto-useful: BM25 is faster; hybrid is better. But the
upstream bounds start at one second, while both local modes finish in roughly
0.03–0.05 seconds. Under the official formula latency therefore disappears
completely and LAFS becomes the existing quality comparison. Rescaling the
bounds makes latency visible, but the bounds are now a local policy choice and
the answer still does not change: hybrid wins quality, BM25 remains the faster
operating point.

The new-entrant scan queried GitHub for local-first agent memory, filesystem
memory, LongMemEval, and AGENTS.md memory, then checked repository metadata via
`gh api repos/<owner>/<repo>`. Snapshot on 2026-07-16:

| Repository | Created | Last push | Stars | EXP-4 disposition |
| --- | --- | --- | ---: | --- |
| [LongMemEval-V2](https://github.com/xiaowu0162/LongMemEval-V2) | 2026-05-11 | 2026-06-20 | 88 | Reproduced here |
| [LightMem](https://github.com/zjunlp/LightMem) | 2025-06-11 | 2026-07-16 | 969 | Garden only |
| [LycheeMemory](https://github.com/LycheeMem/LycheeMem) | 2026-03-23 | 2026-07-07 | 1,159 | Garden only |
| [agentmemory](https://github.com/jayzeng/agentmemory) | 2026-02-21 | 2026-06-20 | 11 | Garden only |

Only LongMemEval-V2 graduates through EXP-4. The others remain candidates: this
run did not reproduce their write or retrieval mechanics, so stars and claims
give them no proposal authority.

### Dogfood friction

The required released-tool wakeup failed against this repository with
`DocsNativeMigrationRequiredError`; repo dist failed identically. Global wakeup
worked but returned an empty store, and recall returned zero hits. The failure
was preserved as `MEMO-0002` in the released global store rather than bypassed
with an unapproved migration. External-mining work therefore generated no
project-home usage trace — an important limitation for every EXP-4 result.

## Impact

Adopting the full LAFS formula now adds a tunable time window without changing a
single decision on the only sealed real baseline. The useful steal is smaller:
when Phase 2 produces several ranking or model operating points, print the
non-dominated quality/latency frontier beside the existing metrics. That makes a
dominated candidate visibly dead without inventing a scalar weight. Until there
are at least three operating points, the current nDCG plus p50/p95 table already
says everything the frontier says.

## Excitement

The frontier is honest engineering hygiene, not a demo. It becomes exciting only
when it lets a tiny local model beat a larger one on the useful frontier. Today
it is a two-point chart whose conclusion is already obvious.

## Trunk or branch

**BRANCH.** Latency discipline supports ADR 0116's local-first retrieval work,
but it is not itself the north-star memory experience. Keep the Pareto concept
engine-agnostic and conditional; do not import LongMemEval-V2's 1–200-second
scalar into a 30-millisecond local search path.

## Cost and falsifiability

**Cost: S, conditional.** One pure Pareto fold plus report serialization, only
when the evaluation program has three or more genuine operating points. No
configuration knob and no ranking change.

Kill even that small addition if the first multi-candidate Phase 2 run shows the
frontier never excludes a candidate or changes an engineering discussion. Reopen
LAFS-like integration only if measured local operating points span at least one
order of magnitude and a predeclared latency budget repeatedly conflicts with
quality-only selection.
