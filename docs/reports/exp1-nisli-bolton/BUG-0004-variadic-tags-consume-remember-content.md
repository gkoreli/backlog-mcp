---
title: "BUG-0004: Variadic Tags Consume Remember Content"
date: 2026-07-16
status: Fixed (0.64.0 — CLI tags are comma-separated and no longer swallow remember content; CHANGELOG 0.64.0 Fixed, rerun cycle reports 0006–0008); status reconciled 2026-07-17
priority: P1
affected_version: 0.62.0
author: agate
---

# Variadic tags consume trailing remember content

## Reproduction

Run `remember` with its positional content after a variadic tags option, a shape
consistent with the displayed `remember [options] <content...>` usage:

```sh
npx --yes backlog-mcp@0.62.0 --json \
  --home project --project-root "$PWD" \
  remember --title "EXP-1 friction" \
  --tags exp-1 bolton friction \
  "The first wakeup indexed docs but returned an empty briefing."
```

## Actual

Commander consumes the trailing content as another tag and fails with
`missing required argument 'content'`. Placing content immediately after
`remember` succeeds.

## Expected

The documented option/positional ordering should work, or `--tags` should have
an unambiguous non-variadic representation and help should show the required
ordering.

## Impact

The first attempt to log experiment friction failed. No data was lost, but the
failure lands on the product's lowest-ceremony write verb and is hard to infer
from the error.
