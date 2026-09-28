---
id: TASK-0017
title: 'ADR 0134.1: ratchet, composition, and provenance on every write (0.76.0)'
status: done
parent_id: EPIC-0002
evidence:
  - >-
    Commits 4c5bc00 (ADR), 3ce5a1e (1a), 3166e1c (1b), 0c129ec (2), e1ecca6 (3),
    c6f0fe9 (validation).
  - >-
    Known violations 48 -> 25; server suite 1476 -> 1485 passing; root pnpm
    build green.
  - >-
    Released in server 0.76.0: auto-tag run published + backlog-mcp@0.76.0 with
    signed provenance; npm dist-tags.latest = 0.76.0.
created_at: '2026-09-28T22:38:08.129Z'
updated_at: '2026-09-28T22:38:24.025Z'
type: task
---
Engineering for ADR 0134.1: the import audit, a shrink-only architecture test,
misfiled domain modules moved into core, the shared runtime moved to
`composition/`, dead `resolveSourcePath` deleted, and provenance on every CLI
and MCP write. The validation record is in ADR 0134.1 §Validation.
