---
title: "EXP-1 Aime bolt-on — reproducible defects"
date: 2026-07-16
status: Open
author: pyrite
type: bug-report
relates_to:
  - ../proposals/aime-bolt-on-trial-2026-07.md
---

# EXP-1 Aime bolt-on — reproducible defects

Environment: `backlog-mcp@0.62.0`, project home, Aime at commit `538ecae`, 71
cold documentation files. These are defects, not the experiment's product verdict.

## B-1 — Zero-setup read dirties Git with derived control state

**Reproduction**

```text
npx backlog-mcp@0.62.0 --project-root <aime> --home project --json wakeup ...
git status --short     -> ?? .backlog/
wc -c .backlog/cache/search-index.json -> 7134281
git check-ignore .backlog/cache/search-index.json -> no match
```

**Expected:** project-mode derived cache/state are ignored without adopter setup. On
first control-directory creation, create a tool-owned `.backlog/.gitignore` if absent.
Never overwrite an existing human-authored file.

**Regression:** begin with a clean Git repository, perform the first read, and prove no
derived control path is Git-visible. Repeat with a pre-existing `.backlog/.gitignore`
and prove its bytes are unchanged.

## B-2 — Legacy decision disclosure falls back to oldest IDs

**Reproduction:** Aime had 39 ADR files. The five surfaced accepted decisions were ADR
0001, 0004, 0006, 0007 and 0008; 26 were omitted. Current accepted execution ADR-0027
was absent. The external ADRs lack `updated_at`, so the generic disclosure comparator
ties and falls back to `id.localeCompare`, ascending.

**Expected:** lenient legacy reads use deterministic inferred chronology for disclosure
ranking. Explicit timestamps remain authoritative. The wakeup must not systematically
select the oldest documents merely because imported prose lacks managed-write metadata.

**Regression:** a real-shape fixture with timestamp-less ADR filenames/IDs must surface
the newest applicable decisions and report the exact omitted count.

## B-3 — Claimed requirement silently downgrades and cannot hydrate

**Reproduction**

- `docs/requirements/REQ-0004-being-aime-one-mind.md` is returned by search only as
  `mcp://backlog/requirements/REQ-0004-being-aime-one-mind.md`, type `resource`;
- `list --type requirement` returns only REQ-0001..0003;
- wakeup returns those three with `constraints_omitted: 0`;
- `get` on the returned resource ID returns `content: null`.

**Expected:** a document in a claimed substrate folder that cannot compile is visible
with a labeled diagnostic. Wakeup must not imply complete constraints while such a
requirement is excluded. A fallback resource returned by search must hydrate by the same
ID.

**Regression:** one malformed claimed requirement remains readable as a resource,
appears in diagnostics/briefing incompleteness, and round-trips search ID -> get content.

## B-4 — `remember` intent writes are absent from the operations journal

**Reproduction:** five successful CLI `remember` calls created project MEMO files. The
project `operations.jsonl` held only the separate task create/update rows; it had no
remember rows. `memory-usage.jsonl` recorded recall, not the writes.

**Expected:** every successful semantic write intent emits one actor-attributed operation
record. Internal entity creation must not double-count it.

**Regression:** CLI and MCP `remember` each produce exactly one intent-level journal row,
including resource ID and actor, while failed writes produce none.

## Non-blocking CLI friction (recorded, not promoted to trunk defects)

- `capture_requirement` exists as a 0.62.0 MCP intent but has no CLI verb; CLI-only
  operators must use generic `create --type requirement` or wire an MCP client.
- Both `remember` content and `--tags` are variadic. Putting `--tags` first consumed the
  intended content and failed with `missing required argument 'content'`; content-first
  ordering succeeded.
