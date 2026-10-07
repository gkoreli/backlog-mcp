---
id: TASK-0021
title: Make every backlog operation discover the local project by default
status: open
parent_id: FLDR-0001
references:
  - url: 'mcp://backlog/adr/0112-docs-native-project-scoped-backlog.md'
    title: Project homes and wakeup boundary discovery
  - url: 'mcp://backlog/adr/0134-engineering-rules.md'
    title: Core-owned policy and peer adapters
created_at: '2026-10-07T16:01:54.438Z'
updated_at: '2026-10-07T16:01:54.438Z'
type: task
---
Maintainer direction (2026-10-07): backlog should behave locally by default like git and npm. Capture now; implement after the ADR corpus conformance work.

Default home discovery must start at the invoking working directory and walk upward to the nearest project boundary, principally .backlog/. Existing git/package boundaries can support initial adoption, but commands should not require --home or --project-root in ordinary project work. A selected project home is distinct from an entity/container context.

Global storage must be explicitly selected (prefer ergonomic --global). Recall/search may query global knowledge deliberately, but ordinary local operations must not silently read/write the global home or inherit a surprising global default. Define behavior outside a discoverable project and for nested projects/worktrees; give clear initialization/selection guidance instead of hidden global fallback.

Apply one core home-resolution policy consistently across all CLI reads/writes and native MCP usage. Transport adapters remain thin peers under ADR0134/0136. Preserve explicit path overrides for automation and per-call isolation; do not introduce mutable process-global active-home state.

Audit git/npm local-versus-global conventions using primary documentation, current wakeup-specific discovery, generic CLI defaults, configuration precedence, connection-selected MCP homes, and provenance. Write a focused ADR and migration plan grounded in those code paths.

The maintainer no longer favors remote MCP as a product direction. Reassess/remove remote deployment/exposure as appropriate, while distinguishing remote services from the local MCP transport and read-only viewer. This task records product direction; it does not authorize unrelated deletion or disable local capabilities.

Acceptance: bare backlog commands inside nested project directories choose the nearest local home; global access requires explicit intent; home/path provenance is accurate; malformed selectors, cross-home writes and missing boundaries fail clearly. Unit tests use memfs and mocked effects; manually validate actual CLI/MCP processes in disposable homes. Update maintained guides and the portable skill once implementation exists. No implementation is claimed by this task.
