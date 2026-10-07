---
id: TASK-0014
title: Reconcile historical ADR identity claims that block managed creation
status: done
parent_id: FLDR-0001
evidence:
  - >-
    Resolved by ADR 0113.3. All 171 ADRs have unique filename-matching IDs and
    canonical managed-ready frontmatter validated by Bun1.4.2 and the
    selected-home registry.
  - >-
    Core-allocated fresh roots ADR0137/0138 reconcile unrelated duplicate
    decisions; four support records moved to adr-support. Historical provenance
    and decision bodies preserved, apart from three recorded navigation updates.
  - >-
    Built CLI successfully proposed ADR0113.3 in its existing thread and
    accepted it through declared actions; no creation guard or schema was
    weakened. Build/typecheck/1875 workspace tests pass.
created_at: '2026-09-09T02:33:59.150Z'
updated_at: '2026-10-07T16:02:53.058Z'
type: task
---
Observed during TASK-0013: backlog_propose_adr fails closed with duplicate document identities at adr/0008-task-attached-resources.md and adr/0008-task-labels-and-sprint-management.md; adr/0018-local-llm-optimization-layer.md and adr/0018-restore-flexible-static-file-serving.md; ADR 0106.2 delegation brief, audit and main decision; ADR 0106.4 delegation brief, audit and main decision.

Investigate deliberate companion-file discovery versus true identity collisions and the scope of the creation guard. Ground the remedy in substrate identity declarations and ADR 0129/0133. Preserve historical provenance and links; do not bypass creation guards or assign manual ADR IDs as a workaround. Produce a bounded reconciliation plan before renaming historical records. Evidence: docs/reports/agent-guidance-audit-2026-09-09.md. This task records follow-up; TASK-0013 only fixes documentation.
