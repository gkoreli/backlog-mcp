/**
 * Tier-1 retrieval telemetry (ADR 0121 R7, under the usage-instrument
 * charter B18).
 *
 * PURPOSE — this instrument measures:
 *   - the ADR 0121 R6 mining trigger (≥25 recall-hit events across ≥5
 *     distinct days, probed monthly, before the implicit-qrels miner may
 *     arm);
 *   - the memory-placement proposal's promotion-lane evidence (cross-home
 *     recall demand: which home a recall landed on, and which home was
 *     consulted and had nothing);
 *   - experiments E1/E3.
 * It is NOT qrel manufacture — no line written here ever becomes a
 * relevance judgment without the R6 review gates.
 *
 * Tier 1 ONLY: a shared session id on recall/search/expand events, and
 * recall-miss events (`ids: []`) as first-class lines. Tier 2 — query-text
 * demand logging — is deliberately NOT built here; it is gated separately
 * (R7) on the derived-state hygiene boundary with query text declared
 * sensitive. No query text enters this sink.
 *
 * Events are append-only, one JSON line each:
 *
 *   {session, ts, event: "recall"|"search"|"expand", ids: [...], home}
 *
 * plus `actor` when the ADR 0119.1 attribution ladder resolves one. Lines
 * land in the home's uncommitted state area
 * (`<controlDir>/state/retrieval-telemetry.jsonl`, beside the usage
 * overlay; `state/` is gitignored in project homes) — never in committed
 * docs, and never in the mutation journal (operations.jsonl records
 * mutations only).
 *
 * Fail-open everywhere: a telemetry failure is swallowed, never surfaced,
 * and retrieval behavior stays byte-identical — this is observation only.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export type RetrievalTelemetryEventName = 'recall' | 'search' | 'expand';

/** One appended telemetry line (ADR 0121 R7 Tier-1 event shape). */
export interface RetrievalTelemetryEvent {
  session: string;
  ts: string;
  event: RetrievalTelemetryEventName;
  /** Returned ids in ranked order; `[]` is the first-class recall-miss. */
  ids: string[];
  /** Owning home id — 'global' or the project root path. */
  home: string;
  /** Resolved ADR 0119.1 agent identity, when present. */
  actor?: string;
}

let mintedSessionId: string | undefined;

/**
 * Request-scoped session for the stateless HTTP/MCP transport, which
 * constructs a fresh server per request (review 0001): two independent
 * HTTP requests must never share a telemetry session, so the process-wide
 * minted id below must not be their fallback.
 */
const requestSessionScope = new AsyncLocalStorage<string>();

/**
 * Run `fn` with a freshly minted request-scoped telemetry session.
 *
 * The stateless HTTP/MCP transport wraps each request's handling in this
 * scope; every telemetry event recorded inside — across both homes of a
 * cross-home read — carries the same per-request UUID, and no id survives
 * into the next request. `BACKLOG_SESSION` still overrides inside the
 * scope. CLI processes never enter a scope and keep per-process minting.
 */
export function withRequestTelemetrySession<T>(fn: () => T): T {
  return requestSessionScope.run(randomUUID(), fn);
}

/**
 * The telemetry session id for the CURRENT context.
 *
 * Precedence (review 0001):
 *  1. `BACKLOG_SESSION` env — lets a harness thread one session across
 *     many CLI calls. No config files, no verbs.
 *  2. The request scope opened by {@link withRequestTelemetrySession} —
 *     one UUID per stateless HTTP/MCP request.
 *  3. One UUID minted per process — a CLI invocation is its own process,
 *     so it mints one per invocation.
 */
export function telemetrySessionId(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const override = env['BACKLOG_SESSION']?.trim();
  if (override !== undefined && override !== '') return override;
  const requestScoped = requestSessionScope.getStore();
  if (requestScoped !== undefined) return requestScoped;
  if (mintedSessionId === undefined) mintedSessionId = randomUUID();
  return mintedSessionId;
}

/** Drop the minted session id so the next call re-mints (tests only). */
export function resetTelemetrySessionIdForTests(): void {
  mintedSessionId = undefined;
}

export interface RetrievalTelemetryDeps {
  /** Owning home id (BacklogHome.id). */
  home: string;
  /** Append one line to the telemetry JSONL — best-effort at the edge. */
  appendLine: (line: string) => void;
  /**
   * Resolve the ambient agent identity (ADR 0119.1 ladder). Injected so
   * this module stays pure; compositions pass the live ladder binding.
   */
  resolveActor?: () => string | undefined;
  now?: () => number;
  /** Test seam: env source for the session override. */
  env?: Readonly<Record<string, string | undefined>>;
}

export class RetrievalTelemetry {
  constructor(private readonly deps: RetrievalTelemetryDeps) {}

  /**
   * Append one Tier-1 event. Never throws: a failing sink, clock, or
   * identity probe must not break or surface in the retrieval call.
   */
  record(event: RetrievalTelemetryEventName, ids: readonly string[]): void {
    try {
      let actor: string | undefined;
      try {
        actor = this.deps.resolveActor?.();
      } catch {
        // Identity stays optional (ADR 0119.1) — the event still lands.
      }
      const line: RetrievalTelemetryEvent = {
        session: telemetrySessionId(this.deps.env ?? process.env),
        ts: new Date(this.deps.now?.() ?? Date.now()).toISOString(),
        event,
        ids: [...ids],
        home: this.deps.home,
        ...(actor === undefined ? {} : { actor }),
      };
      this.deps.appendLine(JSON.stringify(line));
    } catch {
      // Fail-open (ADR 0121 R7): telemetry never breaks a retrieval.
    }
  }
}
