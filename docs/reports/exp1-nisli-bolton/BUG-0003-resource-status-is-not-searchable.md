---
title: "BUG-0003: Generic Resource Status Is Not Searchable"
date: 2026-07-16
status: Open
priority: P1
affected_version: 0.62.0
author: agate
---

# Generic resource status is not searchable or filterable

## Reproduction

1. Search the Nisli project for `current open issues next work`.
2. Hydrate a returned issue resource with `get` and observe its frontmatter
   `status: resolved`.
3. Repeat the search with `--status open`, then `--status resolved`.

## Actual

The natural search returns resolved issue documents as candidates. Search stubs
omit their frontmatter status, while both explicit status filters return zero
generic resources. `get` proves the status exists in the same document.

## Expected

Losslessly parsed generic-resource frontmatter fields used by common retrieval
intents—at minimum `status`—should be carried into the search document and obey
the same filter semantics as canonical entities. Unknown fields remain
untouched and no source file is rewritten.

## Impact

An agent asking for current work can be steered toward completed work. In Nisli,
the result included resolved issues while the canonical ledger correctly showed
six open records.
