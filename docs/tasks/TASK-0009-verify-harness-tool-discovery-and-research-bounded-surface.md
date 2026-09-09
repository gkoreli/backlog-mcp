---
id: TASK-0009
title: Verify harness tool discovery and research bounded surface alternatives
status: done
parent_id: EPIC-0001
evidence:
  - >-
    Research report: docs/reports/0013-tool-surface-harnesses.md; evidence and
    limits reviewed.
created_at: '2026-09-09T01:42:17.386Z'
updated_at: '2026-09-09T02:04:01.043Z'
type: task
---
## Research task

Use current primary documentation and, where accessible, real supported-client observations to verify when MCP tool names, descriptions, schemas, resource metadata, and discovery results enter model context. Record client/version/configuration and eager versus deferred behavior. Investigate catalog refresh and custom project intent discovery; do not assume tool-search support is universal.

Compare relevant approaches: a small fixed domain surface, explicit optional capability sets, progressive capability discovery with typed execution, and CLI/help hierarchy. Analyze selection ambiguity, round trips, schema validation, discoverability, caching, and total workflow context. Trace claims back to primary sources; record where practical validation is unavailable.

Deliverable: sourced findings that test ADR 0106.5’s deferred-loading premise and identify supported mechanisms and tradeoffs. Completion: recommendations distinguish protocol support, client-specific behavior, and unverified assumptions.

## Dependencies

TASK-0007 (inventory); these research tracks can proceed independently once the baseline is available.

Parent research worklist: EPIC-0001.

## Research result — 2026-09-08

Completed: [evidence report](../reports/0013-tool-surface-harnesses.md). Parent reviewed delegated findings against source; live manifest/CLI experiments and selected adversarial reproductions are recorded in reports 0011 and 0014. Limits and untested claims are explicit. This closes the audit task, not candidate evaluation or a public-surface decision.
