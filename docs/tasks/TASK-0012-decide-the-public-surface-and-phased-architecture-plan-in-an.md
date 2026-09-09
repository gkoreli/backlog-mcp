---
id: TASK-0012
title: Decide the public surface and phased architecture plan in an ADR
status: open
parent_id: EPIC-0001
created_at: '2026-09-09T01:42:19.798Z'
updated_at: '2026-09-09T01:42:19.798Z'
type: task
---
## Research task

Synthesize all preceding research into a proposed ADR. Define the product’s daily workflow and public vocabulary; classify each existing tool/command as retained, merged, relocated, or removed with evidence and a clear replacement/discovery path where needed.

Specify default MCP exposure, CLI hierarchy, optional/tail capabilities, and user-defined substrate behavior. Name application/domain contracts and adapter responsibilities; establish measured context and correctness acceptance budgets. Resolve conflicts with ADR 0106.5, ADR 0114, and current instructions explicitly.

Provide a file-level implementation sequence, docs/help/instruction changes, unit coverage, real-process manual scenarios, adversarial boundary checks, and migration consequences for our own callers. Do not add compatibility aliases reflexively or choose a broad rewrite without evidence.

Deliverable: decision ADR linked to reports and this epic, plus a bounded engineering worklist. Completion: the recommended change is concrete and reviewable; research findings and outstanding uncertainties are recorded before implementation begins.

## Dependencies

TASK-0007, TASK-0008, TASK-0009, TASK-0010, TASK-0011

Parent research worklist: EPIC-0001.
