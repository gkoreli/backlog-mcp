---
id: EPIC-0002
title: Enforce the engineering rules (ADR 0134)
status: open
parent_id: FLDR-0001
created_at: '2026-09-28T22:37:49.844Z'
updated_at: '2026-09-28T22:37:49.844Z'
type: epic
---
## Goal

Make the codebase easy to build, refactor, improve, and reason about by turning
the ADR 0134 rules into enforced checks, then paying down the known violations.

## Record

- ADR 0134: the rules (layers, domain model, boundaries, files, verification).
- ADR 0134.1: the import audit, the ratcheted architecture test, `composition/`,
  and provenance on every write. Shipped in 0.76.0.
- `KNOWN_VIOLATIONS` in `packages/server/src/__tests__/helpers/architecture-rules.ts`
  is the live count of what is left (25 at 0.76.0).
