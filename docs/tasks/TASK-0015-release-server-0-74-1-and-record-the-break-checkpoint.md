---
id: TASK-0015
title: Release server 0.74.1 and record the break checkpoint
status: done
parent_id: EPIC-0001
evidence:
  - >-
    Released server 0.74.1 from commit 07013d8783888d1c7b6b4655c81dbc3c6c031fa4;
    viewer remains 0.66.0.
  - >-
    Local pnpm build and pnpm test passed: 1,652 tests passed, 2 skipped. CI
    build/tests/tag/GitHub release/npm provenance publish all passed in
    https://github.com/gkoreli/backlog-mcp/actions/runs/34304923248.
  - >-
    Verified GitHub release
    https://github.com/gkoreli/backlog-mcp/releases/tag/v0.74.1 and public npm
    version 0.74.1; dist-tags.latest is 0.74.1. Initial cached registry reads
    lagged the successful publish, then converged.
  - >-
    Saved break checkpoint under EPIC-0001 and audit report; TASK-0011/0012
    research and TASK-0014 ADR identity reconciliation remain open for
    resumption.
created_at: '2026-09-09T02:50:58.985Z'
updated_at: '2026-09-09T02:58:37.838Z'
type: task
---
User requested a break checkpoint, final important-document corrections, changelog update, version bump, push, and a new release. Release server 0.74.1 through the existing Auto Tag and Publish workflow; viewer remains 0.66.0. Verify build/tests, CI, GitHub release and npm publication. Record completed guidance audit, pending TASK-0011/0012 surface work and TASK-0014 ADR identity reconciliation. Stop after the verified release and durable handoff; do not continue the research or identity repair during the user's break.

## Release execution

Version-bump commit: 07013d8783888d1c7b6b4655c81dbc3c6c031fa4. Local pnpm build and all workspace tests passed: 1,652 passing, 2 skipped.

Auto Tag and Publish run https://github.com/gkoreli/backlog-mcp/actions/runs/34304923248 completed successfully. GitHub release https://github.com/gkoreli/backlog-mcp/releases/tag/v0.74.1 was created at 2026-09-09T02:53:58Z. CI's npm step returned + backlog-mcp@0.74.1 at 02:54:06Z with signed provenance (transparency log index 2764737852).

Initial public npm reads returned 404 for 0.74.1 and latest=0.74.0. At 02:56:39Z the registry metadata response was a cache HIT with age 151 and max-age=300. Subsequent reads confirmed version 0.74.1 and latest=0.74.1; verification is complete. Do not repeat publication or bump again merely because a cached read lags the successful publish receipt.
