---
id: TASK-0014
title: Reconcile historical ADR identity claims that block managed creation
status: open
parent_id: FLDR-0001
created_at: '2026-09-09T02:33:59.150Z'
updated_at: '2026-09-09T02:33:59.150Z'
type: task
---
Observed during TASK-0013: backlog_propose_adr fails closed with duplicate document identities at adr/0008-task-attached-resources.md and adr/0008-task-labels-and-sprint-management.md; adr/0018-local-llm-optimization-layer.md and adr/0018-restore-flexible-static-file-serving.md; ADR 0106.2 delegation brief, audit and main decision; ADR 0106.4 delegation brief, audit and main decision.

Investigate deliberate companion-file discovery versus true identity collisions and the scope of the creation guard. Ground the remedy in substrate identity declarations and ADR 0129/0133. Preserve historical provenance and links; do not bypass creation guards or assign manual ADR IDs as a workaround. Produce a bounded reconciliation plan before renaming historical records. Evidence: docs/reports/agent-guidance-audit-2026-09-09.md. This task records follow-up; TASK-0013 only fixes documentation.
