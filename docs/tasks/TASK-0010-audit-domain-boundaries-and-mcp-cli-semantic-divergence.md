---
id: TASK-0010
title: Audit domain boundaries and MCP–CLI semantic divergence
status: done
parent_id: EPIC-0001
evidence:
  - >-
    Research report: docs/reports/0014-tool-surface-architecture.md; evidence
    and limits reviewed.
created_at: '2026-09-09T01:42:18.185Z'
updated_at: '2026-09-09T02:04:02.106Z'
type: task
---
## Research task

Trace the inventory from MCP, CLI, and relevant HTTP/viewer adapters into transport-free core operations, compiled intents, substrate contracts, and storage. Map bounded responsibilities for knowledge/memory, project documents/work, automation, and administration without assuming they require new packages.

Examine duplicated validation, business rules in adapters, generic CLI writes versus semantic MCP transitions, write_resource/body editing versus entity updates, memory lifecycle versus delete, and project-defined intent growth. Check whether different paths preserve the same invariants, attribution, home routing, and errors.

Deliverable: file-cited ownership/call-path map, concrete divergences, and minimal refactoring candidates ranked by user impact and risk. Completion: each suggested extraction or consolidation has a demonstrated responsibility and validation plan; domain meaning is preserved rather than collapsed into transport dispatch.

## Dependencies

TASK-0007 (inventory); these research tracks can proceed independently once the baseline is available.

Parent research worklist: EPIC-0001.

## Research result — 2026-09-08

Completed: [evidence report](../reports/0014-tool-surface-architecture.md). Parent reviewed delegated findings against source; live manifest/CLI experiments and selected adversarial reproductions are recorded in reports 0011 and 0014. Limits and untested claims are explicit. This closes the audit task, not candidate evaluation or a public-surface decision.
