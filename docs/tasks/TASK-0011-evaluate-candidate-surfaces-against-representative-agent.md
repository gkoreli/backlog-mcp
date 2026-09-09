---
id: TASK-0011
title: Evaluate candidate surfaces against representative agent workflows
status: open
parent_id: EPIC-0001
created_at: '2026-09-09T01:42:18.994Z'
updated_at: '2026-09-09T01:42:18.994Z'
type: task
---
## Research task

After the inventory, workflow, harness, and domain audits, compare the current baseline with at least two materially different simplification candidates. Use the same seeded scenarios and disclose model/client/version/settings when agents are involved. Include novel project substrates and the uncommon operational tail.

Exercise cold-open, recall-versus-search selection, fact correction/supersession, create/start/complete work, ADR authoring, body editing, and maintenance discovery. Include malformed inputs, ambiguous entity addresses, wrong-home selections, and unsupported actions; candidates must fail closed at trust boundaries.

Measure task success, wrong choices, calls, cumulative discovery/input/output tokens, latency, and help dependence. Use manual experiments in isolated real processes and unit tests with mocked external dependencies if prototype code warrants them; do not add integration tests to the repository. Keep prototypes separate from production behavior.

Deliverable: comparative results, reproducible scenarios, failures, and recommended candidate with tradeoffs. Completion: a lower advertised tool count alone cannot qualify a candidate as better; maintain existing domain guarantees.

## Dependencies

TASK-0007, TASK-0008, TASK-0009, TASK-0010

Parent research worklist: EPIC-0001.
