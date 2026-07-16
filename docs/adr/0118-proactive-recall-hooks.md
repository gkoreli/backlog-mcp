---
title: "0118. Proactive Recall — Hook-Driven Memory Injection at the Client Boundary"
date: 2026-06-20
status: PARKED, ONLY EXPLORATION DO NOT IMPLEMENT ANY TIME SOON
backlog_item: TASK-0694
folder: FLDR-0001
continues: 0092.5-agentic-memory-landscape-2026.md
informs: 0092.3-memory-experience-and-substrate.md
---

# 0118. Proactive Recall — Hook-Driven Memory Injection at the Client Boundary

**Status**: PARKED, ONLY EXPLORATION DO NOT IMPLEMENT ANY TIME SOON — design-first; implementation owned by the operator
**Problem class**: recall is in the LLM's decision space (a voluntary tool call) when it
should be in deterministic infrastructure (a lifecycle hook).
**Scope note**: the *mechanism* (hooks, injection) lives in the **client** (kiro-cli agent
specs in `GgsAgents`), but it depends on a **server** capability (fast recall). This ADR
lives in backlog-mcp because the latency fix — a recall path that returns in <100 ms — is a
backlog-mcp concern, and the design ruling here (stubs-only injection) extends the recall
contract set by ADR 0092.5.

## Context

### The recurring failure

Agents repeatedly skip `backlog_recall` before answering "how do I…" / configuration /
tooling questions, despite an explicit invariant ("Check memory before generating from
scratch"). Observed 5+ times. The root cause is architectural, not a prompt-quality problem:

- The invariant is a **prompt instruction** competing with the model's confidence in its own
  training data. Under the slightest certainty, the model answers directly and never calls the
  tool.
- Recall sits in the **LLM's decision space**. The decision to recall is exactly the thing the
  model is bad at self-triggering — it cannot reliably self-identify an "unfamiliar" situation,
  because unfamiliarity feels like familiarity from the inside.

> Chain of thought: you cannot fix a *will-it-fire* problem by making the instruction louder.
> A louder instruction is still an instruction. The only durable fix is to remove the decision
> from the model and make recall happen *before* the model reasons — i.e. move it from the
> prompt layer to the infrastructure layer.

### What the field actually does (evidence)

Primary-source review of the production memory systems (extends the landscape survey in
ADR 0092.5):

- **Mem0 (Claude Code plugin)** — fires recall on **every** `UserPromptSubmit`, unconditionally;
  the only guard is skipping very short prompts. No intent classifier. Message in → search →
  inject. ([Mem0 proactive-memory guide](https://mem0.ai/blog/proactive-memory-in-ai-agents-a-developer-s-guide))
- **Mem0 Hermes** — pre-fetches between turns and injects the *previous* turn's cached results
  (≈0 ms at response time; slightly stale).
- **MemPalace** — `wake-up` at session start + a per-prompt hook that searches the (spatially
  scoped) store; ChromaDB vector search, ~20–50 ms.
- **claude-mem** — `UserPromptSubmit` hook fires unconditionally at **~12 ms** because it hits a
  local SQLite FTS5 index; crucially it injects an **index of stubs** (id + one-line title +
  token estimate), not full bodies, then lets the agent drill in via MCP tools.

**Ruling from the evidence:** none of them use a smart "should I recall?" gate. They make recall
**cheap enough to fire every turn**. The discriminator between "noisy and slow" and "free and
invisible" is (1) latency and (2) how much is injected — not gating intelligence. The
DEMAND/NO_DEMAND intent-classifier (PASK / ProactAgent) is a *research* pattern for when recall
is expensive; it is not how shipping systems behave.

### Latency is already solved — the sidecar is warm

`backlog-mcp serve` already runs as an HTTP MCP server (Streamable HTTP on `/mcp`). The recall
MCP tool is already registered and callable via JSON-RPC. The Orama index is warm in memory.

**Measured latency** (2026-06-20, production daemon on port 3030, 974 entities indexed):
- MCP `tools/call` via `curl`: **38 ms**
- Full hook end-to-end (stdin parse + curl + jq format): **109 ms**

This means **no server changes are needed.** The hook simply sends a `tools/call` JSON-RPC
request to the already-running sidecar. The initial concern about `npx -y backlog-mcp recall`
(2–5 s Node cold start) is irrelevant — we never spawn a new process; we hit the warm daemon.

```bash
# Actual measured call — 38ms
curl -s --max-time 1 -X POST http://127.0.0.1:3030/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"backlog_recall","arguments":{"query":"...","limit":5}}}'
```

### What already exists (grounding)

- **Core recall is transport-free.** `packages/server/src/core/recall.ts` is a thin delegator to
  `MemoryComposer.recall`, mirroring `search` so every transport adapter has one mental model
  (ADR 0090 core-first layering; MEMO-0005). It already supports `full` (stubs vs bodies),
  `layers`, `context`, `tags`, `limit`.
- **A long-running daemon already serves HTTP.** `serve` runs the Hono app
  (`packages/server/src/server/hono-app.ts`) with `/search`, `/tasks`, `/memory/contradictions`,
  `/api/status`, `/events` (SSE) — but **no `/recall` route yet**. The daemon is the natural
  home for a sub-50 ms recall path: the index is already warm in memory.
- **Stubs-by-default is already the recall contract.** ADR 0092.5's two-stage recall returns
  stubs (id + digest) within a token budget; a follow-up expand is the server-observable usage
  signal. Proactive injection of *stubs* is therefore not a new behavior — it is the existing
  recall contract delivered through a new trigger.
- **Per-repo auto-scope exists.** ADR 0105 (`.backlog-mcp/config.json`) supplies a default
  scope; a hook running in a project dir can recall already scoped to that project's `context`
  (e.g. `FLDR-0001`) without the agent passing it.
- **kiro-cli supports the needed lifecycle hooks.** `agentSpawn` (session start) and
  `userPromptSubmit` (every prompt) both inject their STDOUT into agent context on exit 0.
  (Verified via kiro-cli `introspect` → "Hooks System".)

## Decision

Adopt **hook-driven proactive recall** with two layers — no server changes required:

1. **Session-start briefing** — `agentSpawn` hook runs `backlog-mcp wakeup` once per session.
   Cost is paid once; cold start is acceptable. *(Already wired in the `engineer` agent spec.)*
2. **Per-turn recall** — `userPromptSubmit` hook sends a JSON-RPC `tools/call` to the
   already-running HTTP MCP sidecar, requesting `backlog_recall` with the user's prompt. Injects
   **stubs only** into context. The agent expands specific `MEMO-…` ids via the MCP `recall`/
   `get` tools when a stub looks relevant (the ADR 0092.5 two-stage contract, now triggered
   automatically instead of voluntarily).

The hook script (`scripts/memory-recall-hook.sh` in GgsAgents):

```bash
#!/bin/bash
EVENT=$(cat)
PROMPT=$(echo "$EVENT" | jq -r '.prompt // empty')
[ ${#PROMPT} -lt 12 ] && exit 0

QUERY=$(printf '%s' "$PROMPT" | jq -sR .)
PORT=${BACKLOG_PORT:-3030}

RESULT=$(curl -s --max-time 1 -X POST "http://127.0.0.1:${PORT}/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"backlog_recall\",\"arguments\":{\"query\":${QUERY},\"limit\":5}}}" 2>/dev/null)

[ -z "$RESULT" ] && exit 0

echo "$RESULT" | jq -r '
  .result.content[0].text | fromjson |
  if .total == 0 then empty
  else
    "# Recalled memories (\(.total) matches)\n" +
    ([.items[] | select(.score > 0.5) |
      "- **\(.id)** (score \(.score | . * 100 | floor / 100)): \(.digest[:120])"
    ] | join("\n"))
  end' 2>/dev/null
```

Agent spec wiring (`clientConfig.kiroCli.hooks`):

```json
{
  "agentSpawn": [
    { "command": "npx -y backlog-mcp wakeup --max-completions 3 --max-activity 3" },
    { "command": "ghx skill" },
    { "command": "cbx skill" }
  ],
  "userPromptSubmit": [
    { "command": "{{aim:filepath:scripts/memory-recall-hook.sh}}", "timeout_ms": 2000 }
  ]
}
```

### Design rulings (locked)

- **No intent classifier.** Fire every turn (above the short-prompt floor). Matches every
  shipping system; avoids adding an LLM to the hot path (which would also violate the
  no-LLM-in-write-path posture and add its own latency).
- **Stubs, not bodies.** Inject id + one-line digest + score (~100–200 tokens for 5 results).
  Full bodies are pulled on demand by the agent. This is the single most important
  noise-control lever and it is *already* the recall default.
- **Relevance floor.** Only inject stubs above a score threshold (start at ~0.6, tune) so
  low-signal turns inject nothing rather than junk.
- **Fail-open, never block.** Daemon down / timeout / empty ⇒ exit 0 with no output. A memory
  hook must never delay or break the agent.
- **Scope by default.** Use ADR 0105 per-repo scope so project hooks recall that project's
  memories without the model choosing a `context`.

## Alternatives considered

1. **Louder prompt / stronger invariant.** Rejected — this is what we have; it is the failure.
   You cannot instruction-tune away a decision the model can't self-trigger.
2. **Intent classifier (DEMAND/NO_DEMAND, PASK/ProactAgent).** Rejected for v1 — research-grade,
   adds an LLM call to the hot path (latency + cost + a model in the loop), and no shipping
   system needs it once recall is cheap. Revisit only if stub injection proves noisy *after*
   the score floor.
3. **`npx backlog-mcp recall` directly in the hook.** Rejected — the 2–5 s cold start makes it
   unusable per-turn. The sidecar is already warm; use it.
4. **Dedicated REST endpoint (`GET /memory/recall`).** Unnecessary — the MCP `tools/call`
   JSON-RPC on the existing `/mcp` endpoint already returns recall results at 38 ms. Adding a
   separate REST route would duplicate the interface for no latency gain.
5. **Pre-fetch / cache previous turn's results (Mem0 Hermes).** Deferred — at 109 ms end-to-end
   the hook is fast enough. Revisit Hermes-style prefetch only if empirical testing shows this
   latency is perceptible.
6. **SQLite FTS5 sidecar (claude-mem).** Rejected — we already have a warm Orama index in the
   daemon; standing up a second store would fork our search stack (cf. ADR 0049 "keep Orama").

## Consequences

- **Positive:** recall stops being a coin-flip. The "forgot to recall" failure class is
  eliminated by construction — the model can't forget what it doesn't decide. Token cost stays
  bounded (stubs, ~200 tokens for 5 results). **No server changes required** — the mechanism
  piggybacks on the existing MCP Streamable HTTP sidecar.
- **Cost / risk:** requires the daemon to be running for per-turn recall (acceptable — `serve`
  is the normal posture, ADR 0013.7; and the hook fails open when it isn't). Per-turn injection
  consumes a little context every turn even when irrelevant — mitigated by the score floor and
  stubs-only rule. Tuning the threshold is empirical.
- **Boundary:** this ADR owns the *injection contract (stubs, floor, fail-open)* and the
  *hook design*. The concrete hook wiring (which agents, exact commands) is a GgsAgents concern.

## Implementation

**Status: Validated.** The hook script exists at `GgsAgents/scripts/memory-recall-hook.sh` and
has been tested end-to-end against the production daemon (974 entities, port 3030).

| Metric | Measured |
|--------|----------|
| MCP `tools/call` round-trip | 38 ms |
| Full hook (stdin → curl → jq → stdout) | 109 ms |
| Stubs injected | 5 max, ~200 tokens |
| Score floor | 0.5 (configurable) |
| Failure mode | exit 0, no output |

**Remaining work:**
1. Wire into engineer agent spec (`userPromptSubmit` hook)
2. Roll out to triage, research-agent after validation
3. Empirical tuning of score floor and limit based on real sessions

## Cross-references — Internal

- **ADR 0092.5** (Agentic Memory Landscape 2026) — source of the two-stage stub-recall ruling and
  the Mem0/MemPalace/Hindsight evidence base this ADR builds on; **this ADR continues it** from
  "what recall returns" to "when recall fires."
- **ADR 0092.3** (Memory Experience & Substrate) — the north star ("smarter in week 10 than week
  1") that proactive recall directly serves; informed by this ADR.
- **ADR 0092.2** (Implicit Episodic Capture) — added `backlog_recall`; defined the composer-optional
  contract that `core/recall.ts` honors.
- **ADR 0090** (CLI & Core Extraction) — core-first layering; the new HTTP route is just another
  transport adapter over the same `core/recall.ts`.
- **ADR 0105** (Per-Repo Config Auto-Scope) — supplies the default `context` so project hooks
  recall the right project's memories.
- **ADR 0013.7** (Transport/Hosting Framework) — affirms the daemon model the warm-recall path
  relies on.
- **ADR 0049** (Keep Orama) — why we reuse the warm Orama index rather than a second FTS store.
- **TASK-0694** — tracking item for the full implementation.

## Cross-references — Prior Art (Per-Prompt Auto-Recall Implementations)

### Systems that DO fire recall on every prompt

| System | Mechanism | Latency | Token budget | Score floor |
|--------|-----------|---------|--------------|-------------|
| **Mem0** (Claude Code plugin) | `UserPromptSubmit` hook → Mem0 cloud API | ~50–100ms | Configurable | N/A (cloud-side) |
| **openclaw-auto-recall** | `before_prompt_build` → direct SQLite vector search | ~100ms | 768 tokens max | 0.5 |
| **Hindsight** (OpenClaw plugin) | Plugin `autoRecall: true` → PostgreSQL + PyTorch | Varies | `recallMaxTokens: 1024` | Relevance-ranked |
| **openclaw-plugin skill** | `autoRecall` hook → `prependContext` | ~100ms | Configurable | 0.3 (30%) |

**openclaw-auto-recall** (https://github.com/Alyx-Learbott/openclaw-auto-recall) is the closest
architectural match to our design. Their documented rationale:
- *"AI agents sometimes forget to search their own memory. Every successful memory system at scale
  injects context before the prompt."*
- No second LLM, no new database — calls existing search engine directly
- Draft path penalty (noisy content gets -0.15 score), `[auto-recall]` visibility tags
- Skip conditions: <10 chars, heartbeats, slash commands

**Hindsight/Vectorize** (https://hindsight.vectorize.io/blog/2026/03/06/adding-memory-to-openclaw-with-hindsight):
- *"Memory that works automatically is qualitatively different from memory that depends on model
  behavior. When the agent doesn't have to choose what to save or when to search, it just has the
  right context."*
- Strips own `<hindsight_memories>` tags before retention (echo prevention)
- `recallBudget` (low/mid/high), `recallContextTurns` (how many prior turns inform the query)

**OpenClaw issue #12179** (https://github.com/openclaw/openclaw/issues/12179) — community feature
request for native auto-inject. A user who hacked it in reported:
- *"These additions have completely changed the game for me. My Clawdbot is operating 10000x more
  efficiently, with literally ZERO noticeable knowledge loss."*
- Sub-300ms latency target, implemented via source modification adding `UserPromptSubmit` hook

### Systems that do NOT fire per-prompt (session-start only or agent-initiated)

| System | What it does | Why no per-prompt |
|--------|-------------|-------------------|
| **Claude Code native Session Memory** | Injects past session summaries at session start | Background reference only; relies on agent for mid-session |
| **Supermemory** | MCP tools (`memory`, `recall`, `/context` prompt) | Agent must call `recall` voluntarily |
| **Recall (recallmcp.com)** | 4 lifecycle hooks (session-start/observe/pre-compact/session-end) | Session-start injection only; mid-session is agent-initiated |
| **MemPalace** | `wake-up` hook at session start; `save_hook` for writes | Explicitly gates: "inject once per conversation" |
| **claude-auto-mem** | SessionStart hook → ~50 tokens injected | Session-start only |

### Opinions FOR per-prompt recall

**Mem0** (https://mem0.ai/blog/proactive-memory-in-ai-agents-a-developer-s-guide):
- Three patterns: (1) Session-start scan, (2) Intent-gated per-turn (DEMAND/NO_DEMAND), (3)
  Scheduled reflection. Their Claude Code plugin implements pattern 1+2 unconditionally.
- *"The agent is permanently in answer mode... The trigger is always the user typing something."*
- *"This is the gap proactive memory closes: retrieval triggered by context, not by the user."*
- Token efficiency validated: retrieval-based injection cuts 594→166 tokens vs full injection
  (72% savings, same answer quality) — https://mem0.ai/blog/the-2026-token-optimization-playbook

**Mem0 production paper** (arXiv:2504.19413, "Building Production-Ready AI Agents with Scalable
Long-Term Memory"):
- *"Mem0 achieves 26% relative improvements in the LLM-as-a-Judge metric over OpenAI"*
- Memory retrieval measurably outperforms full-context approaches

**Vectorize/Hindsight** (https://hindsight.vectorize.io):
- *"OpenClaw's built-in memory depends on the agent deciding what to save — and models don't do
  this consistently. Hindsight replaces it with automated extraction and auto-recall."*

**Mem0 on OpenClaw** (https://mem0.ai/blog/add-persistent-memory-openclaw):
- *"OpenClaw's default memory system does not guarantee persistence or memory recall. Memory
  storage and retrieval are left to the LLM, guided by prompts, heuristics, and a small set of
  markdown files."*

### Opinions AGAINST per-prompt recall (or advocating selective/gated recall)

**PASK paper** (arXiv:2604.08000, "Toward Intent-Aware Proactive Agents with Long-Term Memory"):
- *"Most AI systems are good at either helping when needed or staying silent when not needed, but
  not both."*
- *"True proactivity requires knowing when NOT to fire just as much as knowing when to fire."*
- *"An agent that always fires proactively annoys users with irrelevant context."*
- *"Memory search is not free, and firing it on every turn is wrong."*
- Proposes **IntentFlow classifier** — trained DEMAND/NO_DEMAND binary decision per turn

**RAG research** (arXiv:2411.19463, "Understanding the Design Decisions of RAG Systems", 3 LLMs,
6 datasets):
- *"RAG deployment must be highly selective — variable recall thresholds and failure modes
  affecting up to 12.6% of samples even with perfect documents."*
- *"Golden documents harm RAG system performance in some scenarios"* — injecting correct content
  can make the model worse
- *"Excessive retrieval introduces distracting noise that degrades accuracy"*
- Optimal retrieval volume: 5–10 documents for QA (diminishing returns beyond)

**JetBrains Research** (https://blog.jetbrains.com/research/2025/12/efficient-context-management/):
- *"Agent-generated context actually quickly turns into noise instead of being useful information."*
- Context grows rapidly, becomes expensive, does not deliver significantly better performance

**Chroma research team** (cited in Medium, "Automatic Context Compression in LLM Agents"):
- *"Context rot — the gradual degradation of response quality as irrelevant history crowds the
  context window."*

**Vstorm** (https://oss.vstorm.co/blog/ai-agent-selective-memory/, 30+ production agent deployments):
- *"Most AI agent memory systems store everything and retrieve badly — vector databases saving
  every message produce megabytes of noise where RAG retrieval returns 10 irrelevant snippets for
  every useful one."*
- *"Selective, intentional memory beats total recall every time."*
- Their solution: file-based memory where the LLM decides what to save; search is on-demand

**Mem0's OWN nuanced position** (same proactive memory blog):
- *"Rate-limit proactive injections — one at session start, one per significant context shift,
  not one per turn."*
- Pattern 2 (intent-gated) is their recommended approach, not unconditional firing

### Research Papers

| Paper | Key finding | Relevance |
|-------|-------------|-----------|
| **PASK** (arXiv:2604.08000) | Intent-aware DEMAND/NO_DEMAND classifier; "firing every turn is wrong" | Strongest case for gated recall over unconditional |
| **ProMem** (arXiv:2601.04463) | Feed-forward extraction misses details; self-questioning loop recovers them | Write-path quality affects what's available to recall |
| **RAG Design Decisions** (arXiv:2411.19463) | 12.6% harm rate from perfect docs; selective deployment required | Even perfect recall can hurt; noise is real |
| **Mem0 production** (arXiv:2504.19413) | 26% improvement over OpenAI with retrieval-based memory | Validates that retrieval-based > full-context injection |
| **ProactAgent** (arXiv:2604.20572) | RL-trained retrieval policy learns WHEN to recall | Learned gating outperforms fixed "always" or "never" |
| **CogniFold** (arXiv:2605.13438) | Always-on proactive memory substrate with continuous folding | Theoretical ideal: memory never "fires" — it's always there |
| **Selective Retrieval** (arXiv:2504.01018) | Selective RAG improves over always-retrieve by utilizing LLM knowledge | Model should skip retrieval when it already knows the answer |

### Synthesis — The Honest Position

The evidence splits into two camps:

**"Fire always, make it cheap"** (Mem0, openclaw-auto-recall, Hindsight): If recall is <100ms and
injected content is bounded (stubs, score floor, token cap), the noise cost is low enough to
accept for eliminating the "forgot to recall" failure class entirely.

**"Fire selectively, know when to stay silent"** (PASK, RAG research, JetBrains, Vstorm): Even
cheap injection adds noise; 12.6% harm rate from perfect docs proves noise is real; the right
answer is an intent gate that only fires when the turn warrants it.

**Our v1 design is the pragmatic middle:** fire unconditionally with strong mitigations (stubs
only ~200 tokens, score floor 0.5, skip short messages, fail-open). This eliminates the failure
class immediately while keeping the door open for Pattern 2 (intent-gated) as a v2 optimization
if empirical testing shows noise is a problem. The harm-rate research (12.6%) applies to full
document injection, not 200-token stubs — our injection is lightweight enough that the noise
ceiling is structurally bounded.
