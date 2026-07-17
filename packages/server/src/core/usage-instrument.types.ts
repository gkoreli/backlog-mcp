export type UsageInstrumentSourceStatus = 'available' | 'missing';

export interface UsageInstrumentSource {
  path: string;
  status: UsageInstrumentSourceStatus;
  lines: string[];
}

export interface UsageInstrumentInput {
  operations: UsageInstrumentSource;
  usage: UsageInstrumentSource;
}

export interface UsageInstrumentSourceSummary {
  path: string;
  status: UsageInstrumentSourceStatus;
  nonempty_lines: number;
  valid_events: number;
  malformed_or_unsupported_lines: number;
}

export interface UsageInstrumentCoverage {
  status: 'exact' | 'heuristic' | 'unavailable';
  reason: string;
}

export interface UsageInstrumentReport {
  schema_version: 1;
  sources: {
    operations: UsageInstrumentSourceSummary;
    usage: UsageInstrumentSourceSummary;
  };
  observed_time_range: {
    first: string | null;
    last: string | null;
  };
  successful_writes: {
    total: number;
    by_intent: Record<string, number>;
    by_mutation: Record<string, number>;
  };
  memory_usage: {
    observed_hit_recalls: number;
    returned_memory_ids: number;
    expands: number;
    citations: number;
    usage_summaries: number;
    recall_to_hydration: {
      candidate_chains: number;
      recalls_with_candidate_hydration: number;
      returned_ids_hydrated: number;
      unmatched_expands: number;
    };
    hit_vs_miss: {
      observed_hits: number;
      observed_misses: null;
      hit_rate: null;
    };
  };
  section_usage: {
    observed_sections: null;
  };
  coverage: {
    successful_write_counts: UsageInstrumentCoverage;
    all_tool_call_counts: UsageInstrumentCoverage;
    observed_recall_hits: UsageInstrumentCoverage;
    recall_misses_and_hit_rate: UsageInstrumentCoverage;
    recall_to_hydration: UsageInstrumentCoverage;
    wakeup_section_usage: UsageInstrumentCoverage;
  };
}
