---
id: TASK-0007
title: 'Inventory MCP tools, CLI commands, and context costs'
status: done
parent_id: EPIC-0001
evidence:
  - >-
    Research report: docs/reports/0011-tool-surface-inventory.md; evidence and
    limits reviewed.
created_at: '2026-09-09T01:42:15.903Z'
updated_at: '2026-09-09T02:03:58.441Z'
type: task
---
## Research task

Capture actual tools/list manifests for the shipped default local catalog and a project with custom intents. Enumerate all CLI commands, subcommands, flags, MCP resources/prompts, and standing instructions that teach the workflow. Record registration source, domain operation, availability, discovery path, and overlapping entry points.

Measure exact serialized bytes and tokenizer-qualified tokens separately for names/descriptions, full schemas, instructions, and representative responses. Separate eager and deferred discovery costs; state what is observed versus modeled. Include selected-home catalog behavior and the constrained runtime without requiring D1 parity.

Deliverable: a reproducible inventory and baseline report under docs/reports/, with commands, revision, environment, per-capability costs, totals, and the largest contributors. Completion: every registered/default capability and nested CLI command is accounted for; no schema-byte count is presented as actual harness token use.

## Dependencies

None; first research step.

Parent research worklist: EPIC-0001.

## Research result — 2026-09-08

Completed: [evidence report](../reports/0011-tool-surface-inventory.md). Parent reviewed delegated findings against source; live manifest/CLI experiments and selected adversarial reproductions are recorded in reports 0011 and 0014. Limits and untested claims are explicit. This closes the audit task, not candidate evaluation or a public-surface decision.
