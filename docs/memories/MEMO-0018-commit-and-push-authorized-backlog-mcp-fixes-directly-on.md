---
id: MEMO-0018
title: Commit and push authorized backlog-mcp fixes directly on main
parent_id: FLDR-0001
created_at: '2026-09-09T00:57:35.860Z'
updated_at: '2026-09-09T00:57:35.860Z'
type: memory
layer: procedural
source: 'aime:granite'
tags:
  - git
  - workflow
kind: preference
---
Goga explicitly confirmed on 2026-09-08 that backlog-mcp is our own repository and project: commit authorized fixes on the mainline and push the commits directly. Do not default to a feature branch or PR handoff for this project. Fetch origin first and preserve concurrent mainline work before a normal, non-force push.
