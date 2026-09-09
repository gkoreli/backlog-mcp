---
id: TASK-0013
title: Audit and reconcile agent-facing documentation with current contracts
status: done
parent_id: EPIC-0001
evidence:
  - >-
    Corrected five invalid README examples; all 38 revised MCP examples pass
    current schema/key checks without executing mutation handlers.
  - >-
    Reconciled AGENTS recall/recovery guidance, NORTH-STAR substrate/disclosure
    implementation claims, install skill and historical API pointers; recorded
    evidence in docs/reports/agent-guidance-audit-2026-09-09.md.
  - >-
    Install skill validator, bounded/oversized/malformed budget-recipe checks
    and relative-link validation passed.
  - >-
    Managed ADR creation refused existing duplicate identities; no guard bypass.
    Follow-up TASK-0014 records reconciliation work. Prior content-field
    clarification is commit 129ec1c.
created_at: '2026-09-09T02:25:48.252Z'
updated_at: '2026-09-09T02:34:47.477Z'
type: task
---
User directive: "is there any misleading instructions in the readme or agents md or important docs like that? lets respect bookkeeping"

Audit README.md, AGENTS.md, CLAUDE.md, install SKILL.md, docs/NORTH-STAR.md and linked current architecture guidance against source and emitted tool contracts. Correct concrete misleading instructions while preserving substrate ownership and progressive disclosure. Record evidence, affected files, historical-document treatment, and validation. Include the preceding content-field clarification (129ec1c) and the observed incomplete tool rediscovery incident; distinguish observed evidence from unproven causes. No description alias, unrelated skill edits, or public tool redesign.

## Audit plan and bookkeeping

Confirmed fixes cover executable README examples, current recall/recovery guidance in AGENTS.md, client-dependent schema loading and shipped substrate/home behavior in NORTH-STAR, and host/control-state/one-wakeup verification in the install skill. Historical API examples receive dated current-contract pointers rather than rewrites.

Attempting backlog_propose_adr for this audit failed closed on existing duplicate ADR claims (0008, 0018, 0106.2 and 0106.4). No ADR was created and no identity guard was bypassed. Record the audit, file-level evidence, preceding 129ec1c schema clarification, and validation in docs/reports/agent-guidance-audit-2026-09-09.md. Historical identity cleanup is separate work.
