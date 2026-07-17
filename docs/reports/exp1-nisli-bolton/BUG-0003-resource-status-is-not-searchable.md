---
title: "BUG-0003: Generic Resource Status Is Not Searchable"
date: 2026-07-16
status: Open
note: fix in flight — retrieval defect batch (report 0009 §HEALTH); still a known issue in CHANGELOG 0.64.0
priority: P1
affected_version: 0.62.0
author: agate
---

# Generic resource status is not searchable or filterable

## Reproduction

Run the exact query from the trial, then repeat it with each status filter:

```sh
npx --yes backlog-mcp@0.62.0 --json \
  --home project --project-root "$PWD" \
  search "current open issues next work lifecycle router SSG" --limit 10

npx --yes backlog-mcp@0.62.0 --json \
  --home project --project-root "$PWD" \
  search "current open issues next work lifecycle router SSG" \
  --status open --limit 10

npx --yes backlog-mcp@0.62.0 --json \
  --home project --project-root "$PWD" \
  search "current open issues next work lifecycle router SSG" \
  --status resolved --limit 10
```

Hydrate a returned issue resource with `get` and observe its frontmatter
`status: resolved`.

## Actual

The unfiltered search returns resolved issues 0019, 0017, and 0016 as
candidates. Search stubs omit their frontmatter status, while both explicit
status filters return zero generic resources. `get` proves the status exists in
the same document.

## Expected

Losslessly parsed generic-resource frontmatter fields used by common retrieval
intents—at minimum `status`—should be carried into the search document and obey
the same filter semantics as canonical entities. Unknown fields remain
untouched and no source file is rewritten.

## Impact

An agent asking for current work can be steered toward completed work. In Nisli,
the result included resolved issues while the canonical ledger correctly showed
six open records.
