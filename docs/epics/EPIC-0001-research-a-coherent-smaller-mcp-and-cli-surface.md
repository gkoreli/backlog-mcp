---
id: EPIC-0001
title: 'Research a coherent, smaller MCP and CLI surface'
status: open
parent_id: FLDR-0001
created_at: '2026-09-09T01:42:15.041Z'
updated_at: '2026-09-09T01:42:15.041Z'
type: epic
---
## Problem and research objective

Goga reports that overlapping MCP tools and CLI commands have obscured how to use backlog-mcp and increased agent harness context overhead. Determine the smallest coherent public surface that delivers the product's core value: durable context and memory grounded in human-readable project documents.

This is a research worklist. Completion means an evidence-backed architecture decision and an ordered engineering plan; implementation is a subsequent phase. Do not assume tool count alone measures usability, that all harnesses defer schemas, or that renaming/grouping commands solves semantic overlap.

## Initial evidence (2026-09-08)

- `packages/server/src/tools/register-tools.ts` registers 11 static MCP tools. The declared-intent manifest test in `packages/server/src/__tests__/register-substrate-intents.test.ts` expects 16 more: a baseline of 27. Actual selected-home catalogs and constrained runtimes can differ; capture live manifests before treating this as a universal count.
- That test freezes 10,444 serialized input-schema bytes for the 16 intent tools only. This excludes static schemas, descriptions, protocol metadata, outputs, and harness overhead; it is not a token measurement.
- The rebuilt CLI's `--help` displays 19 command entries, including version/help, with additional edit/migrate subcommands. It describes the product as a “Task management MCP server,” whereas NORTH-STAR centers context and memory.
- ADR 0106.5 intentionally removed generic MCP create/update while retaining generic CLI writes. Its rationale depends partly on deferred tool loading. That is a hypothesis to verify across supported clients, not a protocol-wide guarantee.
- ADR 0114 already folded a redundant context tool into get. Preserve its useful relational capability and evaluate the resulting retrieval workflow rather than restarting from tool names alone.

## Research sequence

1. Inventory and measure the complete exposed surface.
2. Map user journeys, overlapping meanings, and demonstrated usage.
3. Verify harness discovery behavior and study relevant primary-source alternatives.
4. Trace domain ownership and adapter divergence.
5. Compare candidate surfaces through representative scenarios.
6. Decide through an ADR with migration and regression gates.

Tracks 2–4 use the inventory and may progress independently. Candidate evaluation requires their findings; the decision follows evaluation. Each child task specifies its deliverable and completion criteria.

## Tracked work

1. [TASK-0007 — Inventory and context baseline](../tasks/TASK-0007-inventory-mcp-tools-cli-commands-and-context-costs.md)
2. [TASK-0008 — User journeys and conflicting meanings](../tasks/TASK-0008-map-core-user-journeys-and-conflicting-capability-meanings.md)
3. [TASK-0009 — Harness discovery and primary-source research](../tasks/TASK-0009-verify-harness-tool-discovery-and-research-bounded-surface.md)
4. [TASK-0010 — Domain boundaries and adapter divergence](../tasks/TASK-0010-audit-domain-boundaries-and-mcp-cli-semantic-divergence.md)
5. [TASK-0011 — Candidate workflow evaluation](../tasks/TASK-0011-evaluate-candidate-surfaces-against-representative-agent.md)
6. [TASK-0012 — Decision ADR and engineering plan](../tasks/TASK-0012-decide-the-public-surface-and-phased-architecture-plan-in-an.md)

## Decision criteria

Evaluate cold-open orientation, continuity after context loss, knowledge retrieval and correction, work tracking, and document authoring. Include uncommon maintenance and project-defined substrates. Measure correct action selection, calls to completion, input/discovery/output tokens, unnecessary context, latency, discoverability, and failure behavior. Distinguish observations from estimates and untested hypotheses; publish unsuccessful scenarios too.

Respect local-first operation, human-visible markdown as authority, no LLM in the server write path, and explicit project/home boundaries. Preserve domain invariants and transport-free application operations. A smaller manifest must not merely move the same ambiguity into a giant untyped dispatcher, large help payload, or mandatory standing prompt.

## Completion gate

An ADR must choose retained/merged/relocated/removed capabilities; define one understandable daily workflow; state which tools/commands appear by default and how the tail is discovered; account for custom substrates; set measured context budgets; and provide a file-level engineering sequence with unit and real-process manual validation. Explicitly supersede any conflicting rulings. No feature removal is decided by this worklist alone.

## Existing decisions to examine

- [NORTH-STAR](../NORTH-STAR.md): cold-open, amnesia recovery, context and memory value.
- [ADR 0090](../adr/0090-cli-tool-and-core-extraction.md): core-first architecture.
- [ADR 0106.5](../adr/0106.5-intent-write-surface.md): semantic intents, deferred loading premise, CLI escape hatch.
- [ADR 0114](../adr/0114-memory-context-surface-disposition.md): one retrieval language and context-tool fold.
