---
id: EPIC-0001
title: 'Research a coherent, smaller MCP and CLI surface'
status: in_progress
parent_id: FLDR-0001
created_at: '2026-09-09T01:42:15.041Z'
updated_at: '2026-09-09T02:33:59.218Z'
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

## Research progress — 2026-09-08

TASK-0007 through TASK-0010 are complete. Parent captured real HTTP/MCP manifests, CLI help, token counts and selected boundary behavior; three independent read-only workers audited workflows, harness discovery, and domain ownership. A fourth worker reviewed the candidate designs. Reports were independently checked, and stale telemetry assumptions corrected before acceptance.

- [Measured inventory](../reports/0011-tool-surface-inventory.md): default 27 tools, 8,034 o200k_base payload tokens; 25 named CLI paths including groups/help, 19 operational leaves.
- [Workflow ambiguity](../reports/0012-tool-surface-workflows.md): preserve learned-knowledge versus current-document retrieval; observed usage is not a representative adoption sample.
- [Harness discovery](../reports/0013-tool-surface-harnesses.md): deferral is client-specific; local Codex loading remains unmeasured; backlog has no server-wide discovery instructions or proactive catalog refresh.
- [Domain audit](../reports/0014-tool-surface-architecture.md): memory lifecycle differs from generic managed writes; selected parser/receipt/policy discrepancies manually reproduced.
- [Candidate comparison](../reports/0015-tool-surface-candidates.md) and [independent review](../reports/0016-tool-surface-candidate-review.md): prototype the typed daily set first, keep discovery/execution as challenger.

TASK-0011 is in progress: static arithmetic, design review and the client pilot below are complete; broader client and recovery validation remains open. TASK-0012 remains open for the evidence-backed final ADR. The research prototypes do not change the production tool surface.

### Client pilot checkpoint

[Six controlled Codex runs](../reports/0017-tool-surface-client-trials.md) now exercise the full catalog and both candidates on independent homes. The typed daily set loses authoring coverage without its optional tail; discovery/execution retains coverage with extra calls and schema-related retries. Seven malformed/stale/wrong-home probes rejected without journal mutations. This advances TASK-0011 but does not close its broader client/recovery gate or decide the default API.

### Operational documentation audit — 2026-09-09

TASK-0013 reconciles README, AGENTS, install guidance and current architecture descriptions against compiled contracts. The [audit record](../reports/agent-guidance-audit-2026-09-09.md) documents five invalid README examples, selected-schema discovery after compaction, the shared content-field clarification in 129ec1c, and the ADR-creation bookkeeping blocker. These are corrections to the existing surface, not a decision among the candidate APIs.

### Break checkpoint — 2026-09-09 UTC

The owner requested a break after the documentation cleanup and server release.
TASK-0013 is complete. TASK-0015 tracks release 0.74.1 and publication evidence.
Research is paused at this checkpoint; TASK-0011 remains in progress and
TASK-0012 remains open, rather than being marked complete on pilot evidence.

On resumption, read report 0017 and TASK-0011 for the remaining optional-tail,
broader-client and compaction/schema-refresh trials. No smaller production
surface has been selected. TASK-0014 separately tracks the duplicate ADR claims
blocking managed ADR creation; preserve historical identities until its remedy
is grounded. Check the installed and running server versions before assuming
a source fix is active in the daemon, then hydrate only the chosen task.
