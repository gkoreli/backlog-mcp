# backlog-mcp

Minimal, boring, correct core for persistent backlog state.

> *Backlog MCP is intentionally opinionated about state validity and completion claims, while remaining agnostic about how work is planned or performed.*

## What This Is

- A strict task schema
- An explicit state machine with allowed transitions
- Disk-backed persistence (coming soon)
- Crash-safe updates
- Deterministic behavior

## What This Is Not

- An autonomous agent
- A productivity app
- A workflow engine
- A task source of truth

This is an **execution ledger**, not a task manager. Remote systems own intent; this owns execution truth per workspace.

## Status Semantics

| Status | Meaning |
|--------|---------|
| `open` | Work is defined but not started |
| `in_progress` | Someone is actively working to produce artifacts |
| `blocked` | Progress is impossible without external change |
| `verifying` | Work claims submitted, awaiting audit |
| `done` | Claims verified; required evidence exists (terminal) |
| `cancelled` | Work intentionally abandoned (terminal) |

## State Machine

```
open ──────► in_progress ──────► verifying ──────► done
  │               │                  │
  │               │                  ├─► in_progress (rejected)
  │               │                  │
  │               │                  └─► cancelled
  │               │
  │               ├────────────────► blocked
  │               │                     │
  │               │                     ├─► in_progress
  │               │                     │
  │               │                     └─► cancelled
  │               │
  │               └────────────────► cancelled
  │
  └────────────────────────────────► cancelled
```

## Core Invariants

1. **DONE must be earned, not asserted.** Requires passing through `verifying` with valid DoD and evidence.

2. **No state teleportation.** Transitions follow explicit rules.

3. **Evidence is structured, not prose.** Artifacts array, not free text.

4. **Verification is a phase.** Work claims get scrutiny time before completion.

5. **Server enforces invariants.** Clients are untrusted.

## Verification Philosophy

Verification is **structural only**:
- `dod.checklist` must be non-empty
- `evidence.artifacts` must have at least 1 item
- All strings must be non-empty

The server does NOT run commands, check file existence, or validate URLs. Artifacts are opaque strings.

## Mutation Authority

| Field | Mutable in states |
|-------|-------------------|
| `title`, `description` | open, in_progress, blocked |
| `dod` | open, in_progress |
| `evidence` | Set only via transition to verifying |
| `blocked` | Set only via transition to blocked |

Nothing is mutable in terminal states (`done`, `cancelled`).

## Failure Semantics

If verification is rejected (`verifying` → `in_progress`):
- Evidence is cleared
- DoD is kept for retry

## Installation

```bash
npm install
npm run build
```

## License

MIT
