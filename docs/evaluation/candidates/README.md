# Implicit qrel candidates — mined, never gold

Files here are produced by `scripts/implicit-qrels.mjs`, the read-only miner
chartered by `docs/proposals/implicit-qrels-from-journal-2026-07.md`. Each
`implicit-qrels-<date>.jsonl` holds a header record followed by
`candidate_query` and `candidate_qrel` records mined from real journal bytes.

**Candidates are not evidence.** Every record requires independent human
review per `docs/evaluation/JUDGING.md` before it may enter any judged query
or qrel set. The miner enforces this fail-closed: it emits `proposed_grade`
(a mining prior), never `grade`, and no emitted `assessor` contains
`reviewed:`, so `scripts/search-eval.mjs` rejects these lines as-is.
Synthetic memories may never manufacture evidence; these candidates are
admissible for review precisely because they are mined from real usage, and
for no other reason.

## Rerun

```bash
pnpm qrels:implicit -- \
  --home /absolute/path/to/project/.backlog \
  --home ~/.backlog \
  --output docs/evaluation/candidates/implicit-qrels-<date>.jsonl
```

R1 compliance: the miner reads `state/operations.jsonl` and
`state/memory-usage.jsonl` per home and writes only its `--output` file
(which must not live inside a mined home). Output is deterministic over
input bytes and arguments; no clock is read.

## What the journals can and cannot link today (finding, 2026-07-17)

Mined from the real project home, the global home, and the one live fleet
worktree journal on 2026-07-17: **zero query→hydration chains exist**, and
most of that zero is structural, not behavioral.

1. **The operations journal records mutations only.** `Mutation` is
   `create | update | delete | resource-edit`
   (`packages/server/src/operations/types.ts`); reads never append
   (`packages/server/src/core/usage-instrument.ts` coverage). The proposal's
   query→stubs→hydration sequences do not exist in `operations.jsonl` by
   construction.
2. **`backlog_search` demand is recorded nowhere.** No journal holds a search
   query or its returned stub ids. Search-surface implicit qrels are
   unminable until a demand event exists.
3. **Hydration is visible only for memories.** `recordExpand` appends only
   for `MEMO-` ids (`packages/server/src/memory/usage-tracker.ts`), so a
   `backlog_get` of a returned task/ADR/resource leaves no trace.
4. **Recall misses append nothing.** `recordRecall` returns early on zero
   ids, so fruitless-recall→`remember` miss markers are unminable.
5. **No session or actor id on usage events.** The only linkage available is
   most-recent-recall time-window adjacency — a heuristic that can mislink
   an expand to another concurrent session's recall. False positives are
   possible; that is one reason review is mandatory.

**Smallest journal amendment** (in order of unlock): (a) append a
`{"ts","type":"search","query","ids"}` usage event on `backlog_search` and
extend `expand` events to all hydrated ids — this alone makes the proposal's
core search→hydration chain minable; (b) add one shared `session` field
(per MCP connection / CLI invocation) to `recall`/`search`/`expand` events —
this retires the time-window heuristic; (c) append recall events with
`"ids": []` on misses — this unlocks miss markers. All three touch only the
usage overlay, which is already the read-demand surface; the operations
journal stays a write journal.
