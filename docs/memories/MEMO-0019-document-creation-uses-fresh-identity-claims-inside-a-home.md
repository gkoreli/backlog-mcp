---
id: MEMO-0019
title: Document creation uses fresh identity claims inside a home-local lock
parent_id: FLDR-0001
created_at: '2026-09-09T01:33:23.457Z'
updated_at: '2026-09-09T01:33:23.457Z'
type: memory
layer: procedural
source: 'aime:granite'
entity_refs:
  - ADR 0133
tags:
  - write-boundary
  - identity
  - gotcha
supersedes: MEMO-0012
kind: timeless
---
A memoized read model is not authoritative for writes. ADR 0133 reproduces stale-process duplicate IDs across different slugs, digit-width aliases, and malformed occupied files. All local generated creates now use the repository create operation, holding a home-local filesystem lock across a fresh claim scan, allocation, and insertion; explicit-ID writes use the same boundary. Reads remain cached. Do not restore allocateId followed by add as the local creation path or rely on watcher freshness for exclusion. This replaces the earlier snapshot-only guard described by MEMO-0012; it protects cooperating writers in one home, not separate Git worktrees or old binaries.
