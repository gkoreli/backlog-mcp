# Pressure Ledger

*Future-proof the information model and boundaries; do not pre-build future
execution machinery* (PROMPT 0012). A living table, not a roadmap: one row
per pressure, updated when evidence arrives, adjudicated on the Desk.
Build-now changes require the evidence column to cite something real.

| Pressure | Evidence today | Seam to preserve | Build now? |
|---|---|---|---|
| Parallel writers | 3× MEMO id collisions on 2026-07-18 alone (TASK-0005) | stable identity, atomic creation, conflict visibility | **Yes** — compact ADR ruling a sync-survivable allocation, then smallest fix; renumber protocol documented meanwhile |
| Stale updates | none yet | optional version preconditions on writes | No — design seam only |
| Retries | agent/tool reality; none observed | client idempotency keys + operation ids | No — small addition when first observed |
| Branch convergence | live (worktree fleet; W2 divergence stubs shipped) | diagnostics + renumber protocol | **Yes** — operationally (protocol documented, W2 stubs live) |
| Schema aging | inevitable; `definitionVersion` pinned to literal 1 | versioned definitions, frozen history, lenient reads | **Yes** — ADR 0122 (Proposed; slices A-C on GO) |
| Derived memories outliving sources | `--derived --refs` exists; no invalidation | supersedes edges → stale-source flags | **Yes** — charter D1 (pressure-map) |
| Derived-state destruction | index rebuilds; but telemetry/journal/usage are neither derived nor authoritative | three-class boundary: authoritative / derived / evidence | **Yes** — charter D2: boundary law + destruction CI gate |
| Epistemic authority | core product pressure; ledger pieces live (0119/0120/0121) | provenance × human ratification; never stored confidence scalars | Continue |
| Retrieval scale | 25 tail-reachability failures (R-8-gated); Cerebras scoped-projects warning (REF-0015) | budgets, omission truth, E1 kill-evidence, 0121 gates | Continue |
| Peer sync | not yet proven | stable ids, causality, operation provenance | No |
| CRDT merge | not yet required (0107 parked) | authoritative/derived separation (D2) | No |
| Actor mailboxes | belongs to aime | clean external intent port; store is not an actor | No |
| Actor-transition authorization (grants) | zero wrong-actor incidents in 2 days of 5-agent fleet | optional `permitted` on workflow transitions (additive under 0122) | No — seam reserved (PROMPT 0013, compiled-process R-B) |
| Process as data (meta-state-machine) | our own merge/review/release law is prose scattered across ADRs+memories | descriptive + validating only — never a run-loop; named gates enable Tenet 11's earned absorption | **Experiment** — E-PROC: declare our own process, suite checks history against it (compiled-process R-C) |

Provenance: seeded from PROMPT 0012's table, extended with this repo's
evidence; assessed in docs/proposals/pressure-map-2026-07.md.
