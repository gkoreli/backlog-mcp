---
title: "Agent guidance audit: current contracts and progressive disclosure"
date: 2026-09-09
status: Complete
---

# Agent guidance audit

Tracked by [TASK-0013](../tasks/TASK-0013-audit-and-reconcile-agent-facing-documentation-with-current.md)
under [EPIC-0001](../epics/EPIC-0001-research-a-coherent-smaller-mcp-and-cli-surface.md).
User directive: “is there any misleading instructions in the readme or agents md
or important docs like that? lets respect bookkeeping”

The operational docs contained concrete invocation errors and stale architecture
claims. The `description` → `content` rename itself was intact. This change
reconciles guidance with existing contracts; it introduces no alias, new public
tool, or change to the substrate/disclosure tenets.

## Scope and method

Read README.md, AGENTS.md, CLAUDE.md, the root install SKILL.md,
docs/NORTH-STAR.md and the ADR index. Cross-check claims against source,
compiled tool schemas, the relevant accepted ADRs, and the actual failing blog
session. Inspect linked historical ADRs 0085, 0090 and 0106 for obsolete API
examples. The evaluation entrypoints contain research procedures, not a competing
body-field contract. CLAUDE.md delegates to AGENTS.md and needs no duplicate rules.

This is a local contract/documentation audit, not a new survey of client vendors,
competitors or every historical ADR. Historical measurements and research receipts
remain dated evidence. Actual schema deferral requires a client observation;
backlog's manifest alone cannot establish it.

## Confirmed findings and corrections

| Entrypoint | Misleading guidance | Correction and source of truth |
|---|---|---|
| README memory examples | `remember` omitted required `title`; `forget` used `id` | Include `title`; use `ids` array. [Remember schema](../../packages/server/src/tools/backlog-remember.ts), [forget schema](../../packages/server/src/tools/backlog-forget.ts). The latter strips unknown keys, then core rejects the missing criterion; schema acceptance alone is insufficient. |
| README edit examples | Retired `uri` argument and invented task/resource paths | Use `id` and an existing entity. Distinguish native prose editing from strict managed editing. [Write tool](../../packages/server/src/tools/backlog-write-resource.ts), [ADR 0117](../adr/0117-the-write-boundary.md), [ADR 0129.1](../adr/0129.1-one-document-address.md). |
| README list/status | No-argument list described as active tasks; status vocabulary treated as universal | Explicit task/status filters; recent entities by default, up to 20. Status belongs to the substrate. [Core list](../../packages/server/src/core/list.ts), [storage list](../../packages/server/src/storage/local/docs-native-filesystem-storage.ts). |
| README lifecycle/home | Server said never to capture memory; CLI reduced to daemon management; repo scope stated unconditionally; npx asserted always latest | Separate hook-injected policy from completion episodes; document one-shot CLI operations, default home fallback and installed-versus-running version. [CLI](../../packages/server/src/cli/index.ts), [home resolution](../../packages/server/src/core/backlog-home.ts), [startup](../../packages/server/src/cli/server-manager.ts). |
| AGENTS.md | Memories declared ground truth; unconditional mid-session wakeup ban; stale test counts | Evaluate age/provenance/corrections, preserve current user direction and verified contracts, recover after context loss, and take counts from the runner. [Recall guidance](../../packages/server/src/tools/backlog-recall.ts), North Star Amnesia Test. |
| README / AGENTS / North Star | Brief discovery could be mistaken for the argument contract; deferred loading presented as a universal property | Expand the selected tool's complete schema. Keep discovery concise and measure actual client loading, schema expansion and retries. [Compiler](../../packages/server/src/core/substrates/compile-substrate-intents.ts), [registrar](../../packages/server/src/tools/register-substrate-intents.ts). |
| North Star implementation prose | Substrates treated as design-time-only; all writes through MCP; shipped intent/home work still future; old filename recipe | Distinguish built-in Zod types from runtime JSON declarations, core adapters from native edits, and current identity-plus-slug storage. [Home registry](../../packages/server/src/storage/local/home-substrate-registry.ts), ADRs 0113, 0106.5, 0117, 0129. |
| Install SKILL.md | Executable presence selected the host; control directory described as cache-only; verification reran wakeup | Follow the active/user-selected host, distinguish configuration from ignored cache/state journals, capture one briefing and reuse it. Compare git state before/after. [Runtime ignores](../../packages/server/src/storage/local/local-runtime.ts). |
| ADR index and historical examples | Old `description`, generic MCP create/update, and source-path examples remained easy to mistake for current instructions; index called implemented ADR 0119.1 still in flight | Add current-contract pointers without rewriting original decisions and reconcile 0119.1's index status with its own record. The old examples document their era; they are not a second API. |

## The reported hallucination: evidence and limits

The blog rollout `01a0743e-3475-70d2-a6a4-58772d6c746a` shows:

1. The complete create-work declaration advertised `content` (line 2829).
2. An earlier create-work call used `content` successfully (2946).
3. Two compactions occurred (3229, 3723).
4. Discovery then used `description.slice(0,95)`, omitting the argument
   declaration (3956); the subsequent call supplied `description` and failed
   validation (3964–3965).

The loaded blog-writing skill correctly calls article SEO metadata `description`;
tool-discovery metadata also uses that name for documentation about a tool.
Interference between these meanings is plausible but unproven. No examined skill
instructed the caller to send `description` to backlog. Neither stale ADR examples
nor a stale schema was established as the cause. Do not turn this incident into a
requirement to add a legacy alias or rename valid article metadata.

Commit `129ec1c` added “Full Markdown body of the document” to the shared
`content` schema. This propagates into six built-in intent schemas; project
declarations continue to own their own fields. The wording is generic because the
base schema serves multiple substrates. Its manifest cost is 306 additional
serialized schema bytes across those six tools, not a measured token cost.

## Validation

- Captured schemas through the current tool registrar, using built-in and packaged
  declarations, without invoking mutation handlers. Checked supplied keys as well
  as parsing, since some static schemas strip unknown fields. The previous README
  had **five invalid examples out of 37**; the corrected README has **38 examples
  with zero schema/key failures**. This verifies argument shapes, not existence of
  illustrative IDs, runtime quarantine, or successful writes in every home.
- The install skill passed `skill-creator/scripts/quick_validate.py` using an
  isolated `uv` Python environment with PyYAML. The default Python lacked PyYAML;
  no project dependency changed.
- Executed the revised budget-check shell recipe with captured JSON fixtures:
  bounded JSON passed (14 bytes), oversized JSON failed (3,115 bytes), malformed
  JSON failed. No extra wakeup or installation was performed.
- Relative file links in changed entrypoints resolved; `git diff --check` passed.
- For the preceding schema change: generated-schema inspection confirmed the
  annotation survives compilation, and all 10 focused unit tests passed. The
  initial broad server run passed 1,445 tests with two skipped and failed only the
  expected old manifest fingerprint, which was refreshed and rechecked.

No new tests were added for prose changes. At the initial audit checkpoint, no
release, build deployment or daemon restart was performed; installed processes
and client schema caches can lag source. The later release is recorded below.

## Bookkeeping exception and follow-up

`backlog_propose_adr` refused to create this audit ADR because the existing corpus
contains duplicate ADR identity claims: 0008, 0018, 0106.2 and 0106.4, including
delegation/audit companion files that resemble ADR identities. The guard was not
bypassed, no manual ADR number was allocated, and no historical file was renamed.
This ordinary report preserves the engineering record and is linked from the task,
epic and ADR index. Identity reconciliation is tracked separately as
[TASK-0014](../tasks/TASK-0014-reconcile-historical-adr-identity-claims-that-block-managed.md).

The running daemon also routed TASK-0013 to FLDR-0001 despite the supplied
EPIC-0001 parent, matching the already-fixed ADR 0132 behavior. Its frontmatter was
corrected through the native file lane. Source fixes do not imply an installed
daemon has loaded them.

## Break and release checkpoint — 2026-09-09 UTC

The owner requested final bookkeeping and release 0.74.1 before taking a break.
The final sweep also corrected the nonexistent MCP spelling
`backlog_consolidation-candidates` to `backlog_consolidation_candidates`, made
CLI flags versus MCP field names explicit in AGENTS.md, corrected the global
document path in the architecture diagram, and removed the changelog's false
claim that viewer and server versions always advance together.

Release preparation is tracked by
[TASK-0015](../tasks/TASK-0015-release-server-0-74-1-and-record-the-break-checkpoint.md).
The server package and exported VERSION are 0.74.1; viewer remains 0.66.0.
`pnpm build` and `pnpm test` passed locally: server 1,446 passed / 2 skipped,
viewer 157 passed, memory 49 passed. These later checks supersede the earlier
partial test checkpoint above. CI publication is verified separately before
the release task closes. The EPIC-0001 break checkpoint records where to resume.

### Publication verified

[Release v0.74.1](https://github.com/gkoreli/backlog-mcp/releases/tag/v0.74.1)
was created from `07013d8783888d1c7b6b4655c81dbc3c6c031fa4`.
[CI run 34304923248](https://github.com/gkoreli/backlog-mcp/actions/runs/34304923248)
passed install, build, tests, tagging, GitHub release and npm publication with
signed provenance. Public registry reads subsequently confirmed version 0.74.1
and `dist-tags.latest = 0.74.1`; initial cached reads briefly returned the prior
release. TASK-0015 is complete. The final documentation receipt is committed
after the release tag. No research or identity repair was started during the break.
