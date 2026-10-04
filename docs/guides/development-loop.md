# Development loop

Read this when researching, designing, planning, implementing, or validating a feature or architectural change, especially an untrusted-input or per-home/tenant boundary.
These are active contributor instructions, reached from [AGENTS.md](../../AGENTS.md).

## The Development Loop (maintainer decision, 2026-06-10)

backlog-mcp evolves through a deliberate loop, recorded in the ADR thread:

1. **Research with evidence** — survey the field (delegate to a researcher
   when useful); steal/adapt/reject ideas against our constraints
   (local-first, no LLM in the server write path, human-visible markdown,
   one source of truth). Findings land as an ADR with primary-source links
   (pattern: [ADR 0092.5](../adr/0092.5-agentic-memory-landscape-2026.md)).
2. **Ground in our code** — audit what actually exists before planning
   (pattern: [ADR 0092.2 §audit](../adr/0092.2-phase-3-implicit-episodic-capture.md)). ADRs cite files, not intentions.
3. **Plan as an ADR** — design + numbered rulings + file-level engineering
   plan, cross-referenced to the thread (patterns: [0092.3](../adr/0092.3-memory-experience-and-substrate.md), [0092.1](../adr/0092.1-agentic-memory-engineering-plan.md)).
4. **Engineer in phases** — core-first, modular, committed in logical chunks.
5. **Validate manually** — run the real loop in real processes, not just the
   test suite; it catches what unit tests structurally miss (pattern:
   [ADR 0092.6](../adr/0092.6-memory-phase-c-engineering-record.md) found the composer.forget race). For any boundary that takes
   untrusted or per-home/tenant input (home headers, project roots, user-defined
   substrate schemas, claim collisions), verify it **fails closed** on malformed
   and adversarial input — not just the happy path. A review that only checks the
   happy-path isolation has not reviewed the boundary.
6. **Record** — engineering-record ADR with distilled insights, validation
   findings, and next phases (patterns: [0092.4](../adr/0092.4-memory-phase-a-b-engineering-record.md), [0092.6](../adr/0092.6-memory-phase-c-engineering-record.md)). Then loop.
