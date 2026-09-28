---
id: MEMO-0029
title: 'Release lane: changelog, server bump, fetch-first push, verify the packument'
parent_id: FLDR-0001
created_at: '2026-09-28T22:39:17.573Z'
updated_at: '2026-09-28T22:39:17.573Z'
type: memory
layer: procedural
source: claude
entity_refs:
  - TASK-0015
  - TASK-0017
tags:
  - release
  - process
supersedes: MEMO-0002
kind: current
---
The backlog-mcp release lane as of 0.76.0: (1) CHANGELOG — rename [Unreleased] to '## [X.Y.Z] — date', add the italic north-star note, open a fresh empty [Unreleased]. (2) Bump packages/server/package.json AND packages/server/src/version.ts. Bump the viewer only when its behavior changed (the CHANGELOG header says so; 0.74.1-0.76.0 kept viewer 0.66.0). (3) Commit 'chore: bump version (server X.Y.Z)'. (4) git fetch before pushing; Goga pushes to main directly. (5) Pushing the server version change to main runs auto-tag.yml: tag, GitHub release, npm publish with provenance. (6) Verify with the full packument (curl registry.npmjs.org/backlog-mcp -> dist-tags.latest and time[X.Y.Z]) or the tarball URL. The per-version URL (registry.npmjs.org/backlog-mcp/X.Y.Z) can serve a cached 404 for many minutes after a good publish (seen for 0.74.1, 0.75.0, 0.76.0). Never republish or re-bump because of it.
