---
id: MEMO-0014
title: >-
  One document address grammar (ADR 0129.1): never synthesize
  docs/<folder>/<id>.md — resolve ids through core/document-address
parent_id: FLDR-0001
created_at: '2026-09-02T05:37:28.707Z'
updated_at: '2026-09-02T05:37:28.707Z'
type: memory
layer: procedural
source: 'aime:granite'
tags:
  - identity
  - resources
  - viewer
  - ddd
  - adr-0129.1
kind: timeless
---
Every surface names a document one way: an entity id (TASK-0092), a root-relative path (docs/adr/0001-x.md, aliased to mcp://backlog/<path>), or an mcp://backlog/ URI. `core/document-address.ts` (`parseDocumentAddress`, `resolveDocumentUri`) is the single owner; entity ids resolve via `IBacklogService.getResourceUri(id)` = storage.getFilePath + ResourceManager.toUri, so they follow the file into sub-folders, slugs, and human names. `backlog_get`, the CLI, the HTTP `/mcp/resource?address=` proxy (uri= is an alias), and the viewer split pane all go through it. The viewer's old `mcp://backlog/tasks/${id}.md` was a relic of the flat .backlog-mcp layout and broke every entity link in project homes ("Resource outside the documents surface"). Threaded ids like `ADR 0113.1` stay entities: only a slash or an alphabetic extension marks a path.
