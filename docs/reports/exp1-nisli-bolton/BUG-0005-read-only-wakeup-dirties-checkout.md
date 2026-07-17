---
title: "BUG-0005: Read-Only Wakeup Dirties the Checkout"
date: 2026-07-16
status: Fixed (0.64.0 — tool-owned ignores cover all derived control state; reruns 0006/0007/0008 all verified git porcelain identical before/after); status reconciled 2026-07-17
priority: P1
affected_version: 0.62.0
author: agate
---

# Read-only wakeup dirties the checkout with a large cache

## Reproduction

1. Confirm a clean Nisli worktree with no `.backlog/` directory.
2. Run the first project-home `wakeup` against released 0.62.0.
3. Run `git status --short` and measure the generated index.

## Actual

The read creates an untracked `.backlog/` directory. Its first
`cache/search-index.json` was 4,801,653 bytes for 59 Markdown files. Subsequent
tool use adds project-local operation and memory-usage journals under the same
unignored directory.

## Expected

A read-only bolt-on command may build local acceleration state, but that state
must not appear as untracked project content. The cache/state location or ignore
boundary should preserve a clean checkout without asking the user to modify the
repo before the first command.

## Impact

The zero-setup demo immediately looks invasive and creates a multi-megabyte
cleanup decision. This does not corrupt source, but it weakens trust in the
local-first, files-belong-to-the-project story by mixing disposable runtime
state with candidate committed artifacts.
