---
title: "BUG-0001: Project Discovery Omits Root Orientation Docs"
date: 2026-07-16
status: Open
priority: P0
affected_version: 0.62.0
author: agate
---

# Project discovery omits root orientation docs

## Reproduction

1. Point released `backlog-mcp@0.62.0` at a clean Nisli checkout with project
   home and no setup.
2. Run `wakeup` once to build the project index.
3. Search for Nisli's purpose and for its build, test, and typecheck commands.
4. Inspect `.backlog/cache/search-index.json`.

## Actual

The index contains `docs/**` but not the root `README.md`, `AGENTS.md`, or
`package.json`. Searches for purpose and commands return ADR implementation
details instead of the canonical overview and contributor instructions.

## Expected

Zero-setup project discovery should include the small set of conventional root
orientation documents needed by the Cold-Open Test, without requiring those
files to move under `docs/`.

## Impact

The discovered ADR index can identify Nisli generically as a reactive
web-component library, but it omits the canonical root overview's ecosystem,
standards-first, and current package framing. The run commands are absent
entirely. This violates the bolt-on posture: the fuller human-readable files
already exist and should not be migrated or duplicated for the tool.
