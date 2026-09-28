---
id: MEMO-0030
title: >-
  Work laptop installs backlog through mise's npm backend; its trust prompt
  needs Goga
parent_id: FLDR-0001
created_at: '2026-09-28T22:39:18.888Z'
updated_at: '2026-09-28T22:39:18.888Z'
type: memory
layer: procedural
source: claude
entity_refs:
  - MEMO-0009
tags:
  - release
  - environment
kind: current
---
On Goga's work laptop (/Users/gkoreli), the backlog CLI comes from mise's npm backend, pinned in ~/.config/mise/config.toml as "npm:backlog-mcp". mise installs through aube, which asks for trust confirmation on a newly published version. A non-interactive agent shell cannot answer it: the install fails with 'user aborted mise add backlog-mcp', and MISE_YES=1 does not bypass it. After a release, update the pin and ask Goga to run 'mise install npm:backlog-mcp@X.Y.Z' himself. (MEMO-0009 describes the personal Mac, which uses a pnpm global link instead.)
