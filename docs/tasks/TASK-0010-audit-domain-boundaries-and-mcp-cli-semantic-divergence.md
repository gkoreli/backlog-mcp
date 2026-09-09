---
id: TASK-0010
title: Audit domain boundaries and MCP–CLI semantic divergence
status: open
parent_id: EPIC-0001
created_at: '2026-09-09T01:42:18.185Z'
updated_at: '2026-09-09T01:42:18.185Z'
type: task
---
## Research task

Trace the inventory from MCP, CLI, and relevant HTTP/viewer adapters into transport-free core operations, compiled intents, substrate contracts, and storage. Map bounded responsibilities for knowledge/memory, project documents/work, automation, and administration without assuming they require new packages.

Examine duplicated validation, business rules in adapters, generic CLI writes versus semantic MCP transitions, write_resource/body editing versus entity updates, memory lifecycle versus delete, and project-defined intent growth. Check whether different paths preserve the same invariants, attribution, home routing, and errors.

Deliverable: file-cited ownership/call-path map, concrete divergences, and minimal refactoring candidates ranked by user impact and risk. Completion: each suggested extraction or consolidation has a demonstrated responsibility and validation plan; domain meaning is preserved rather than collapsed into transport dispatch.

## Dependencies

TASK-0007 (inventory); these research tracks can proceed independently once the baseline is available.

Parent research worklist: EPIC-0001.
