---
title: "Validated external mining: location-aware disclosure"
date: 2026-07-16
status: Proposed — EXP-4 reproduction complete
author: chert
external_candidate: Kiro steering inclusion modes
---

# Location-aware disclosure: aligned idea, wrong pressure point

## The experiment

Kiro's current contract is more precise than the garden shorthand. Official
[Steering documentation](https://kiro.dev/docs/steering/) defines
`inclusion: always | fileMatch | manual | auto`; `fileMatch` uses a separate
`fileMatchPattern` string or array. `auto` is a post-garden discovery: it uses a
required name and description for model/task matching. AGENTS.md does not gain
these modes and stays always included. Kiro IDE 1.0 also moved manually created
steering files behind slash-command invocation
([official 1.0 notes](https://kiro.dev/docs/whats-new-1-0/)).

I reproduced the deterministic part—`always`, `fileMatch`, and `manual`—over
every current `docs/**/*.md` file without changing the corpus. The inventory was
169 documents, 1,963,246 bytes, 261,524 whitespace words (490,812 tokens by the
declared bytes/4 proxy). Two in-memory policy overlays were tested:

1. **Coarse:** documents containing the relevant
   `packages/{server|viewer|shared}/**` prefix match that package.
2. **Exact:** a document matches only when it explicitly cites the working file.

NORTH-STAR was the sole `always` document; all remaining documents were
`manual`. Four real working-path scenarios covered server, viewer, a
server+shared cross-cut, and a negative control (`packages/server/src/version.ts`,
which has no exact documentation reference). Analyst qrels contained six server,
seven viewer, six cross-cutting, and one negative-control relevant documents.

```yaml
---
inclusion: fileMatch
fileMatchPattern:
  - "packages/server/**"
  - "packages/shared/src/substrates/**"
---
```

### Full-document payload result

| Scenario | Policy | Docs | Payload | Saved | Relevant retained | False includes |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Server | Always | 169 | 1,963,246 B | 0% | 6/6 | 163 |
| Server | Coarse | 32 | 731,095 B | 62.8% | 5/6 | 27 |
| Server | Exact | 2 | 91,594 B | 95.3% | 2/6 | 0 |
| Viewer | Coarse | 14 | 350,949 B | 82.1% | 4/7 | 10 |
| Viewer | Exact | 2 | 61,483 B | 96.9% | 1/7 | 1 |
| Cross-cut | Coarse | 33 | 735,168 B | 62.6% | 5/6 | 28 |
| Cross-cut | Exact | 2 | 91,594 B | 95.3% | 2/6 | 0 |
| Negative | Coarse | 32 | 731,095 B | 62.8% | 1/1 | 31 |
| Negative | Exact | 1 | 37,139 B | 98.1% | 1/1 | 0 |

Broad globs save bytes but fail the negative control: a version-file edit would
receive 31 irrelevant documents. Exact paths remove noise but lose 67–86% of
the governing documents, including historical ADRs whose prose predates current
canonical paths. The manual-only default retains just NORTH-STAR automatically;
manual invocation can restore relevance only after the agent already knows what
to ask for.

The ideal hand-curated upper bound retained all judged documents while saving
91.0–98.1% of full payload. That number is deliberately not a product result: it
prices a human maintaining perfect globs through every rename.

### The correct baseline is stubs, not bodies

backlog-mcp does not dump these bodies. A path+title stub for all 169 documents
was 17,984 bytes (~4,496 tokens, mean 106 bytes). Coarse selection reduced that
to 346–941 tokens and exact selection to 31–38 tokens, but with the relevance
losses above. Production already bounds wakeup sections, token-packs recall
stubs, and expands content only on request
([wakeup](../../packages/server/src/core/wakeup.ts),
[recall](../../packages/server/src/core/recall.ts)).

Naive content scanning for 1,000 selections cost 0.262–0.500 ms/request; exact
reference lookup cost 0.003–0.004 ms. Matching is cheap. Authoring correct
metadata and acquiring a trustworthy working-path signal are the costs. Neither
`backlog_wakeup` nor `backlog_recall` currently receives active files; Kiro's IDE
owns that signal, while this MCP server does not.

Exact reproduction inventory used `rg --files docs -g '*.md'`, `wc -c`, `wc -w`,
and a one-off Node process that extracted explicit package paths, applied the two
selectors, scored qrel retention/misses/false inclusions, and repeated selection
1,000 times. No output file or repository mutation was produced.

### Dogfood friction

Released and repo-dist project wakeup both stopped at the docs-native migration
gate. Global wakeup/recall ran but the store was empty. The experiment therefore
has no project-home journal evidence; `MEMO-0002` records the failure rather than
silently migrating the user's repo.

## Impact

The full-body headline (63–97% saved) is real but irrelevant to a stub-first
product. Against the actual surface, savings are about 3.5K proxy tokens under
coarse policies and up to about 4.5K under exact matching, and they come with
material misses. The negative control shows package-wide
globs create context noise, while exact globs hide the architectural lineage an
agent most needs.

## Excitement

Low today. Frontmatter knobs and rename maintenance are homework. This becomes
demo-worthy only when a real editor/hook supplies touched files and the briefing
surfaces one otherwise-missed governing requirement exactly when an agent edits
that area.

## Trunk or branch

**BRANCH; reject implementation now.** A location axis aligns with North-Star
Tenet 2, but it does not improve Cold-Open or Amnesia today. The core already
orients through bounded stubs plus search/get/recall, and there is no producer
for the active-file signal. Kiro's new `auto` mode overlaps semantic retrieval
and would add model judgment or duplicate search.

## Cost and falsifiability

**Cost: M, not S.** Parsing exists, but a real feature needs validated patterns,
normalized repo-relative paths, a client input, precedence with substrate
disclosure, per-home isolation, visible metadata, rename handling, and tests.

Revisit only when a real client supplies touched paths and journal/A-B evidence
shows broad retrieval noise. A 30-session pilot must retain at least 95% of
judged relevant stubs, reduce stub tokens at least 50%, average at most one false
include per session, leak across zero homes, and require no extra tool call. Kill
it if paths are absent in more than 10% of sessions, metadata drift exceeds 5%
after a rename, or normal search/get stays within 5% of its orientation quality.
