---
title: "BUG-0002: Wakeup Hides an Indexed Existing-Docs Corpus"
date: 2026-07-16
status: Fixed (0.64.0 — orientation map + freeform-status disclosure; rerun reports 0006 (10/10) and 0008 (10/10 twice)); status reconciled 2026-07-17
priority: P0
affected_version: 0.62.0
author: agate
---

# Wakeup hides an indexed existing-docs corpus

## Reproduction

From a clean Nisli checkout with 59 Markdown files under `docs/` and no
backlog-mcp state:

```sh
npx --yes backlog-mcp@0.62.0 --json \
  --home project --project-root "$PWD" wakeup
```

## Actual

The first call takes 4.33 seconds and builds a search index containing all 59
documents, including 30 discoverable ADR entities and the issue ledger. Its
briefing nevertheless returns no identity, decisions, knowledge, constraints,
tasks, completions, or activity. It scores 0/10 on the five Cold-Open questions.

Focused search can retrieve the corpus: a later query ranked
`docs/issues/README.md` first and hydrated its full ledger in 0.68 seconds. The
data is present; wakeup provides no pointer to it.

## Expected

When canonical briefing sections are empty but existing docs were indexed,
wakeup should disclose a small, budgeted set of bootstrap pointers that lets the
agent form its first retrieval intent. It must not summarize, classify, or
rewrite the existing documents.

## Impact

The exact zero-setup Cold-Open scenario fails. A user sees an empty briefing and
reasonably concludes the bolt-on found nothing, even though useful material is
already searchable.
