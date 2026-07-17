import type {
  UsageInstrumentInput,
  UsageInstrumentReport,
  UsageInstrumentSource,
  UsageInstrumentSourceSummary,
} from './usage-instrument.types.js';

interface ParsedLine {
  line: number;
  value: Record<string, unknown>;
}

interface ParsedSource {
  summary: UsageInstrumentSourceSummary;
  events: ParsedLine[];
}

interface TimedUsageEvent extends ParsedLine {
  timestamp: number;
  ts: string;
}

const LEGACY_MUTATIONS: Readonly<Record<string, string>> = {
  backlog_create: 'create',
  backlog_update: 'update',
  backlog_delete: 'delete',
  write_resource: 'resource-edit',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSource(source: UsageInstrumentSource): ParsedSource {
  const events: ParsedLine[] = [];
  let nonemptyLines = 0;
  let malformedLines = 0;

  for (let index = 0; index < source.lines.length; index += 1) {
    const raw = source.lines[index]?.trim() ?? '';
    if (raw === '') continue;
    nonemptyLines += 1;
    try {
      const value: unknown = JSON.parse(raw);
      if (!isRecord(value)) {
        malformedLines += 1;
        continue;
      }
      events.push({ line: index + 1, value });
    } catch {
      malformedLines += 1;
    }
  }

  return {
    events,
    summary: {
      path: source.path,
      status: source.status,
      nonempty_lines: nonemptyLines,
      valid_events: events.length,
      malformed_or_unsupported_lines: malformedLines,
    },
  };
}

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    return undefined;
  }
  return value;
}

function timestampOf(value: Record<string, unknown>): number | undefined {
  if (typeof value.ts !== 'string') return undefined;
  const timestamp = Date.parse(value.ts);
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

function validOperation(value: Record<string, unknown>): boolean {
  return timestampOf(value) !== undefined
    && typeof value.tool === 'string'
    && value.tool.trim() !== '';
}

function validUsageEvent(value: Record<string, unknown>): boolean {
  const timestamp = timestampOf(value);
  if (timestamp === undefined || typeof value.type !== 'string') return false;
  if (value.type === 'recall' || value.type === 'cite') {
    return asStringArray(value.ids) !== undefined;
  }
  if (value.type === 'expand') return typeof value.id === 'string';
  if (value.type === 'usage_summary') {
    return typeof value.memory_id === 'string'
      && Number.isSafeInteger(value.usage_count)
      && Number(value.usage_count) >= 0;
  }
  return false;
}

function timedUsageEvents(events: ParsedLine[]): TimedUsageEvent[] {
  const timed: TimedUsageEvent[] = [];
  for (const event of events) {
    if (!validUsageEvent(event.value)) continue;
    const timestamp = timestampOf(event.value);
    if (timestamp === undefined || typeof event.value.ts !== 'string') continue;
    timed.push({ ...event, timestamp, ts: event.value.ts });
  }
  return timed.sort(function compareUsageEvents(left, right) {
    return left.timestamp - right.timestamp || left.line - right.line;
  });
}

function candidateHydration(events: TimedUsageEvent[]): {
  candidate_chains: number;
  recalls_with_candidate_hydration: number;
  returned_ids_hydrated: number;
  unmatched_expands: number;
} {
  let activeRecallIds: Set<string> | undefined;
  let activeRecallHydrated = false;
  let recallsWithHydration = 0;
  let candidateChains = 0;
  let unmatchedExpands = 0;
  const hydratedIds = new Set<string>();

  for (const event of events) {
    if (event.value.type === 'recall') {
      if (activeRecallHydrated) recallsWithHydration += 1;
      activeRecallIds = new Set(asStringArray(event.value.ids) ?? []);
      activeRecallHydrated = false;
      continue;
    }
    if (event.value.type !== 'expand' || typeof event.value.id !== 'string') continue;
    if (activeRecallIds?.has(event.value.id)) {
      candidateChains += 1;
      activeRecallHydrated = true;
      hydratedIds.add(event.value.id);
    } else {
      unmatchedExpands += 1;
    }
  }
  if (activeRecallHydrated) recallsWithHydration += 1;

  return {
    candidate_chains: candidateChains,
    recalls_with_candidate_hydration: recallsWithHydration,
    returned_ids_hydrated: hydratedIds.size,
    unmatched_expands: unmatchedExpands,
  };
}

function observedTimeRange(timestamps: number[]): { first: string | null; last: string | null } {
  if (timestamps.length === 0) return { first: null, last: null };
  let first = timestamps[0] ?? 0;
  let last = first;
  for (const timestamp of timestamps.slice(1)) {
    first = Math.min(first, timestamp);
    last = Math.max(last, timestamp);
  }
  return {
    first: new Date(first).toISOString(),
    last: new Date(last).toISOString(),
  };
}

function exactWhenAvailable(
  source: UsageInstrumentSource,
  availableReason: string,
  missingReason: string,
): { status: 'exact' | 'unavailable'; reason: string } {
  return source.status === 'available'
    ? { status: 'exact', reason: availableReason }
    : { status: 'unavailable', reason: missingReason };
}

/**
 * Fold append-only operation and memory-usage JSONL into a deterministic,
 * aggregate-only report. The fold never exposes queries, params, results, or
 * memory bodies and never writes to either source.
 */
export function mineUsage(input: UsageInstrumentInput): UsageInstrumentReport {
  const operations = parseSource(input.operations);
  const usage = parseSource(input.usage);
  const byIntent: Record<string, number> = {};
  const byMutation: Record<string, number> = {};
  const timestamps: number[] = [];
  let validOperations = 0;

  for (const event of operations.events) {
    if (!validOperation(event.value) || typeof event.value.tool !== 'string') continue;
    validOperations += 1;
    const timestamp = timestampOf(event.value);
    if (timestamp !== undefined) timestamps.push(timestamp);
    increment(byIntent, event.value.tool);
    const mutation = typeof event.value.mutation === 'string'
      ? event.value.mutation
      : LEGACY_MUTATIONS[event.value.tool];
    if (mutation !== undefined) increment(byMutation, mutation);
  }
  operations.summary.valid_events = validOperations;
  operations.summary.malformed_or_unsupported_lines =
    operations.summary.nonempty_lines - validOperations;

  const timedUsage = timedUsageEvents(usage.events);
  usage.summary.valid_events = timedUsage.length;
  usage.summary.malformed_or_unsupported_lines = usage.summary.nonempty_lines - timedUsage.length;
  let recalls = 0;
  let returnedMemoryIds = 0;
  let expands = 0;
  let citations = 0;
  let usageSummaries = 0;

  for (const event of timedUsage) {
    timestamps.push(event.timestamp);
    if (event.value.type === 'recall') {
      recalls += 1;
      returnedMemoryIds += (asStringArray(event.value.ids) ?? []).length;
    } else if (event.value.type === 'expand') {
      expands += 1;
    } else if (event.value.type === 'cite') {
      citations += 1;
    } else if (event.value.type === 'usage_summary') {
      usageSummaries += 1;
    }
  }

  return {
    schema_version: 1,
    sources: {
      operations: operations.summary,
      usage: usage.summary,
    },
    observed_time_range: observedTimeRange(timestamps),
    successful_writes: {
      total: validOperations,
      by_intent: Object.fromEntries(Object.entries(byIntent).sort()),
      by_mutation: Object.fromEntries(Object.entries(byMutation).sort()),
    },
    memory_usage: {
      observed_hit_recalls: recalls,
      returned_memory_ids: returnedMemoryIds,
      expands,
      citations,
      usage_summaries: usageSummaries,
      recall_to_hydration: candidateHydration(timedUsage),
      hit_vs_miss: {
        observed_hits: recalls,
        observed_misses: null,
        hit_rate: null,
      },
    },
    section_usage: {
      observed_sections: null,
    },
    coverage: {
      successful_write_counts: exactWhenAvailable(
        input.operations,
        'The operations journal appends successful managed mutations.',
        'The operations journal source is missing; zero observed events is not evidence of zero writes.',
      ),
      all_tool_call_counts: {
        status: 'unavailable',
        reason: 'Read tools do not append to the operations journal.',
      },
      observed_recall_hits: exactWhenAvailable(
        input.usage,
        'The usage overlay appends recalls only when at least one memory id is returned.',
        'The usage overlay source is missing; zero observed events is not evidence of zero recall hits.',
      ),
      recall_misses_and_hit_rate: {
        status: 'unavailable',
        reason: 'Recall calls with zero returned ids do not append an event.',
      },
      recall_to_hydration: input.usage.status === 'available'
        ? {
            status: 'heuristic',
            reason: 'An expand is paired with a returned id after the latest recall; usage events have no session or actor id.',
          }
        : {
            status: 'unavailable',
            reason: 'The usage overlay source is missing.',
          },
      wakeup_section_usage: {
        status: 'unavailable',
        reason: 'Wakeup calls and consumed briefing sections are not logged.',
      },
    },
  };
}
