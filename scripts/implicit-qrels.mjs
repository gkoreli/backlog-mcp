#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HELP = `Usage:
  pnpm qrels:implicit -- \\
    --home <backlog-home-control-dir> [--home <another-home>] \\
    --output <candidates.jsonl> \\
    [--session-window-minutes N]

Read-only miner for implicit relevance candidates (see
docs/proposals/implicit-qrels-from-journal-2026-07.md). Each --home is one
backlog control directory (a project ".backlog" or the global "~/.backlog");
the miner reads "<home>/state/operations.jsonl" and
"<home>/state/memory-usage.jsonl" and links each expand (hydration via
backlog_get) to the most recent preceding recall within the session window.

Required:
  --home    Backlog home control directory; repeatable, at least one
  --output  Candidate JSONL destination (must not be inside any --home)

Optional:
  --session-window-minutes  Recall-to-hydration linkage window (default: 30)
  --help                    Show this help

The miner never writes to any home: journals, overlays, indexes, and the
store are read-only inputs; the only write is the --output file. Output is
deterministic: identical input bytes and arguments produce identical bytes
(no clock is read, so no --now flag exists). Missing input files are
reported as missing with zero observed events.

Every emitted line is a CANDIDATE, not evidence. Candidates require
independent human review per docs/evaluation/JUDGING.md before entering any
judged query or qrel set; no emitted assessor contains "reviewed:", so the
baseline runner rejects these lines as-is by construction.
`;

export const CANDIDATE_NOTICE =
  'CANDIDATES ONLY — every line below is a mined, unreviewed implicit-relevance '
  + 'candidate. Implicit signals are noisy: agents hydrate for many reasons and '
  + 'skip for many more. Each candidate requires independent human review per '
  + 'docs/evaluation/JUDGING.md before it may enter any judged query or qrel '
  + 'set. proposed_grade is a mining prior, not a judgment; no assessor '
  + 'contains "reviewed:", so scripts/search-eval.mjs rejects these lines '
  + 'as-is by construction.';

const MINED_ASSESSOR = 'mined:implicit-qrels.mjs — UNREVIEWED CANDIDATE';
const MUTATIONS = new Set(['create', 'update', 'delete', 'resource-edit']);
const ACTOR_TYPES = new Set(['user', 'agent']);

function fail(message) {
  throw new Error(message);
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseArguments(argv) {
  if (argv.includes('--help')) return { help: true };
  const homes = [];
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--') continue;
    if (!token?.startsWith('--')) fail(`Unexpected positional argument: ${token ?? ''}`);
    const name = token.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) fail(`Missing value for --${name}`);
    if (name === 'home') {
      homes.push(resolve(value));
    } else if (name === 'output' || name === 'session-window-minutes') {
      if (values[name] !== undefined) fail(`Duplicate option: --${name}`);
      values[name] = value;
    } else {
      fail(`Unknown option: --${name}`);
    }
    index += 1;
  }
  if (homes.length === 0) fail('Missing required option: --home');
  if (values.output === undefined) fail('Missing required option: --output');
  let sessionWindowMinutes = 30;
  if (values['session-window-minutes'] !== undefined) {
    if (!/^\d+$/.test(values['session-window-minutes'])) {
      fail('--session-window-minutes must be a positive integer');
    }
    sessionWindowMinutes = Number.parseInt(values['session-window-minutes'], 10);
    if (!Number.isSafeInteger(sessionWindowMinutes) || sessionWindowMinutes < 1) {
      fail('--session-window-minutes must be a positive integer');
    }
  }
  const output = resolve(values.output);
  for (const home of homes) {
    if (output === home || output.startsWith(`${home}${sep}`)) {
      fail(`--output must not live inside a mined home: ${home}`);
    }
  }
  return { help: false, homes, output, sessionWindowMinutes };
}

function readSource(path) {
  try {
    const raw = readFileSync(path);
    return {
      path,
      status: 'available',
      sha256: sha256(raw),
      lines: raw.toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/),
    };
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return { path, status: 'missing', sha256: null, lines: [] };
    }
    throw error;
  }
}

function asStringArray(value) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    return undefined;
  }
  return value;
}

function timestampOf(value) {
  if (typeof value.ts !== 'string') return undefined;
  const timestamp = Date.parse(value.ts);
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

function validActor(value) {
  if (!isRecord(value)) return false;
  return typeof value.name === 'string'
    && value.name.trim() !== ''
    && typeof value.type === 'string'
    && ACTOR_TYPES.has(value.type);
}

/** Same acceptance rule as the usage instrument: mutations are the journal. */
function validOperation(value) {
  return timestampOf(value) !== undefined
    && typeof value.tool === 'string'
    && value.tool.trim() !== ''
    && typeof value.mutation === 'string'
    && MUTATIONS.has(value.mutation)
    && isRecord(value.params)
    && Object.hasOwn(value, 'result')
    && validActor(value.actor);
}

function validMemoryIds(value) {
  const ids = asStringArray(value);
  return ids !== undefined && ids.length > 0 && ids.every(id => id.startsWith('MEMO-'));
}

function validUsageEvent(value) {
  if (timestampOf(value) === undefined || typeof value.type !== 'string') return false;
  if (value.type === 'recall') {
    return typeof value.query === 'string' && validMemoryIds(value.ids);
  }
  if (value.type === 'cite') return validMemoryIds(value.ids);
  if (value.type === 'expand') {
    return typeof value.id === 'string' && value.id.startsWith('MEMO-');
  }
  if (value.type === 'usage_summary') {
    return typeof value.memory_id === 'string'
      && Number.isSafeInteger(value.usage_count)
      && Number(value.usage_count) >= 0;
  }
  return false;
}

function parseJsonl(lines) {
  const events = [];
  let nonemptyLines = 0;
  let malformedLines = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index]?.trim() ?? '';
    if (raw === '') continue;
    nonemptyLines += 1;
    try {
      const value = JSON.parse(raw);
      if (!isRecord(value)) {
        malformedLines += 1;
        continue;
      }
      events.push({ line: index + 1, value });
    } catch {
      malformedLines += 1;
    }
  }
  return { events, nonemptyLines, malformedLines };
}

function increment(counts, key) {
  counts[key] = (counts[key] ?? 0) + 1;
}

function sortedCounts(counts) {
  return Object.fromEntries(Object.entries(counts).sort());
}

/**
 * Fold one home's usage overlay into recall windows.
 *
 * Linkage law (heuristic — see the coverage block): an expand belongs to the
 * most recent preceding recall event, and only when it lands within the
 * session window and expands an id that recall actually returned. Everything
 * else is counted, never guessed at.
 */
export function foldUsageChains(events, sessionWindowMs) {
  const timed = [];
  for (const event of events) {
    if (!validUsageEvent(event.value)) continue;
    const timestamp = timestampOf(event.value);
    if (timestamp === undefined) continue;
    timed.push({ ...event, timestamp });
  }
  timed.sort((left, right) => left.timestamp - right.timestamp || left.line - right.line);

  const windows = [];
  const byType = {};
  let active;
  let matchedHydrations = 0;
  let windowExpiredExpands = 0;
  let unmatchedExpands = 0;

  for (const event of timed) {
    increment(byType, String(event.value.type));
    if (event.value.type === 'recall') {
      active = {
        query: event.value.query,
        ts: event.value.ts,
        timestamp: event.timestamp,
        returnedIds: asStringArray(event.value.ids) ?? [],
        hydrations: [],
      };
      windows.push(active);
      continue;
    }
    if (event.value.type !== 'expand') continue;
    const id = event.value.id;
    if (active !== undefined && active.returnedIds.includes(id)) {
      if (event.timestamp - active.timestamp <= sessionWindowMs) {
        active.hydrations.push({ id, ts: event.value.ts });
        matchedHydrations += 1;
      } else {
        windowExpiredExpands += 1;
      }
    } else {
      unmatchedExpands += 1;
    }
  }

  return {
    windows,
    by_type: sortedCounts(byType),
    valid_events: timed.length,
    matched_hydrations: matchedHydrations,
    window_expired_expands: windowExpiredExpands,
    unmatched_expands: unmatchedExpands,
  };
}

function foldOperations(events) {
  const byMutation = {};
  const byTool = {};
  let validMutations = 0;
  for (const event of events) {
    if (!validOperation(event.value)) continue;
    validMutations += 1;
    increment(byMutation, String(event.value.mutation));
    increment(byTool, String(event.value.tool));
  }
  return {
    valid_mutations: validMutations,
    by_mutation: sortedCounts(byMutation),
    by_tool: sortedCounts(byTool),
  };
}

function queryId(query) {
  return `implicit-recall-${sha256(`recall ${query}`).slice(0, 12)}`;
}

/** Greedy session count: a new session begins when the gap exceeds the window. */
function countSessions(timestamps, sessionWindowMs) {
  if (timestamps.length === 0) return 0;
  const ordered = [...timestamps].sort((left, right) => left - right);
  let sessions = 1;
  let sessionStart = ordered[0];
  for (const timestamp of ordered.slice(1)) {
    if (timestamp - sessionStart > sessionWindowMs) {
      sessions += 1;
      sessionStart = timestamp;
    }
  }
  return sessions;
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Pure extraction fold: homes in, candidate records and honest coverage out.
 *
 * homes: [{ home, operations: { path, status, lines },
 *           usage: { path, status, lines } }]
 */
export function mineImplicitQrels(homes, options) {
  const sessionWindowMs = options.sessionWindowMinutes * 60_000;
  const homeSummaries = [];
  const allWindows = [];
  const counts = {
    recall_hit_events: 0,
    recall_events_with_hydration: 0,
    matched_hydrations: 0,
    window_expired_expands: 0,
    unmatched_expands: 0,
    operations_valid_mutations: 0,
    operations_read_surface_events: 0,
  };

  for (const home of homes) {
    const operationsParsed = parseJsonl(home.operations.lines);
    const operationsFold = foldOperations(operationsParsed.events);
    const usageParsed = parseJsonl(home.usage.lines);
    const usageFold = foldUsageChains(usageParsed.events, sessionWindowMs);
    const chains = usageFold.windows.filter(window => window.hydrations.length > 0);

    counts.recall_hit_events += usageFold.windows.length;
    counts.recall_events_with_hydration += chains.length;
    counts.matched_hydrations += usageFold.matched_hydrations;
    counts.window_expired_expands += usageFold.window_expired_expands;
    counts.unmatched_expands += usageFold.unmatched_expands;
    counts.operations_valid_mutations += operationsFold.valid_mutations;

    for (const window of usageFold.windows) {
      allWindows.push({ ...window, home: home.home });
    }

    homeSummaries.push({
      home: home.home,
      operations: {
        path: home.operations.path,
        status: home.operations.status,
        sha256: home.operations.sha256 ?? null,
        nonempty_lines: operationsParsed.nonemptyLines,
        valid_mutations: operationsFold.valid_mutations,
        malformed_or_unsupported_lines:
          operationsParsed.nonemptyLines - operationsFold.valid_mutations,
        by_mutation: operationsFold.by_mutation,
        by_tool: operationsFold.by_tool,
        read_surface_events: 0,
      },
      usage: {
        path: home.usage.path,
        status: home.usage.status,
        sha256: home.usage.sha256 ?? null,
        nonempty_lines: usageParsed.nonemptyLines,
        valid_events: usageFold.valid_events,
        malformed_or_unsupported_lines: usageParsed.nonemptyLines - usageFold.valid_events,
        by_type: usageFold.by_type,
        recall_hit_events: usageFold.windows.length,
        recall_events_with_hydration: chains.length,
        matched_hydrations: usageFold.matched_hydrations,
        window_expired_expands: usageFold.window_expired_expands,
        unmatched_expands: usageFold.unmatched_expands,
      },
    });
  }

  // Group recall windows by exact query text; only queries with at least one
  // hydration chain produce candidates. A hydration-free recall proves
  // nothing either way (the stub menu may have satisfied the agent).
  const groups = new Map();
  for (const window of allWindows) {
    const group = groups.get(window.query) ?? { query: window.query, windows: [] };
    group.windows.push(window);
    groups.set(window.query, group);
  }

  const candidateQueries = [];
  const candidateQrels = [];
  for (const group of [...groups.values()].sort((a, b) => compareStrings(a.query, b.query))) {
    const chains = group.windows.filter(window => window.hydrations.length > 0);
    if (chains.length === 0) continue;
    const id = queryId(group.query);
    const homesSeen = [...new Set(group.windows.map(window => window.home))].sort();

    candidateQueries.push({
      record: 'candidate_query',
      id,
      class: 'memory-recall',
      surface: 'recall',
      query: group.query,
      assessor: MINED_ASSESSOR,
      rationale: `Real recall demand mined from the memory-usage overlay (${group.windows.length} recall hit event(s), ${chains.length} with hydration). Candidate only: requires independent human review per docs/evaluation/JUDGING.md.`,
      provenance: group.windows.map(window => `implicit-journal ${window.home} ${window.ts}`),
      mined: {
        recall_events: group.windows.length,
        chains: chains.length,
        homes: homesSeen,
      },
    });

    const documents = new Map();
    for (const window of chains) {
      const hydratedHere = new Set(window.hydrations.map(hydration => hydration.id));
      for (const documentId of window.returnedIds) {
        const document = documents.get(documentId) ?? {
          chainRecallTs: [],
          chainRecallTimestamps: [],
          expandTs: [],
          returnedWithoutHydration: 0,
          homes: new Set(),
        };
        document.homes.add(window.home);
        if (hydratedHere.has(documentId)) {
          document.chainRecallTs.push(window.ts);
          document.chainRecallTimestamps.push(window.timestamp);
          for (const hydration of window.hydrations) {
            if (hydration.id === documentId) document.expandTs.push(hydration.ts);
          }
        } else {
          document.returnedWithoutHydration += 1;
        }
        documents.set(documentId, document);
      }
    }

    for (const [documentId, document] of [...documents.entries()].sort(
      (a, b) => compareStrings(a[0], b[0]),
    )) {
      const chainCount = document.chainRecallTs.length;
      const homesList = [...document.homes].sort();
      if (chainCount > 0) {
        const sessions = countSessions(document.chainRecallTimestamps, sessionWindowMs);
        const repeat = sessions >= 2;
        candidateQrels.push({
          record: 'candidate_qrel',
          provenance: 'implicit-journal',
          query_id: id,
          document_id: documentId,
          signal: repeat ? 'repeat-hydrated' : 'hydrated',
          proposed_grade: repeat ? 3 : 2,
          assessor: MINED_ASSESSOR,
          rationale: repeat
            ? `Hydrated after real recall in ${sessions} distinct sessions (${document.expandTs.length} expand event(s) across ${chainCount} chain(s)). Strong implicit positive; confirm per JUDGING.md.`
            : `Hydrated after real recall (${document.expandTs.length} expand event(s) in ${chainCount} chain(s)). Implicit positive; confirm per JUDGING.md.`,
          evidence: {
            chains: chainCount,
            sessions,
            expands: document.expandTs.length,
            returned_without_hydration: document.returnedWithoutHydration,
            homes: homesList,
            recall_ts: [...document.chainRecallTs].sort(),
            expand_ts: [...document.expandTs].sort(),
          },
        });
      } else {
        candidateQrels.push({
          record: 'candidate_qrel',
          provenance: 'implicit-journal',
          query_id: id,
          document_id: documentId,
          signal: 'returned-not-hydrated',
          proposed_grade: 0,
          assessor: MINED_ASSESSOR,
          rationale: `Returned in ${document.returnedWithoutHydration} hydrated recall window(s) but never hydrated. Weak negative — skipping a stub has benign causes; confirm or discard per JUDGING.md.`,
          evidence: {
            chains: 0,
            returned_without_hydration: document.returnedWithoutHydration,
            homes: homesList,
          },
        });
      }
    }
  }

  const candidateCounts = {
    queries: candidateQueries.length,
    qrels_positive: candidateQrels.filter(qrel => qrel.signal === 'hydrated').length,
    qrels_repeat_positive: candidateQrels.filter(qrel => qrel.signal === 'repeat-hydrated').length,
    qrels_weak_negative: candidateQrels.filter(
      qrel => qrel.signal === 'returned-not-hydrated',
    ).length,
  };

  return {
    homes: homeSummaries,
    counts: { ...counts, candidates: candidateCounts },
    candidate_queries: candidateQueries,
    candidate_qrels: candidateQrels,
    coverage: buildCoverage(homeSummaries),
  };
}

/** Honest scope statement — what this miner can and cannot observe. */
function buildCoverage(homeSummaries) {
  const usageAvailable = homeSummaries.some(home => home.usage.status === 'available');
  return {
    recall_to_hydration_chains: usageAvailable
      ? {
          status: 'heuristic',
          reason: 'An expand is linked to the most recent preceding recall within the session window. Usage events carry no session or actor id, so interleaved concurrent sessions can mislink an expand to another session\'s recall — false positives are possible and human review is mandatory.',
        }
      : {
          status: 'unavailable',
          reason: 'No memory-usage overlay was readable in any selected home.',
        },
    operations_journal_read_surface: {
      status: 'unavailable',
      reason: 'The operations journal records managed mutations only (create/update/delete/resource-edit); search, recall, and get never append. No query-to-hydration chain exists in operations.jsonl by construction.',
    },
    search_surface: {
      status: 'unavailable',
      reason: 'backlog_search demand is recorded in no journal: neither the query nor the returned stub ids are logged anywhere. Search-surface implicit qrels are unminable until a search demand event exists.',
    },
    non_memory_hydration: {
      status: 'unavailable',
      reason: 'Expand events are appended only for MEMO- ids (usage-tracker recordExpand), so hydration of search results such as tasks, ADRs, or resources is invisible.',
    },
    recall_misses: {
      status: 'unavailable',
      reason: 'Recall calls returning zero ids append no event, so fruitless-recall-then-remember miss markers cannot be mined.',
    },
  };
}

function writeCandidatesAtomically(outputPath, lines) {
  mkdirSync(dirname(outputPath), { recursive: true });
  const temporaryPath = join(
    dirname(outputPath),
    `.${basename(outputPath)}.${process.pid}.tmp`,
  );
  try {
    writeFileSync(temporaryPath, lines.map(line => `${JSON.stringify(line)}\n`).join(''), {
      flag: 'wx',
    });
    renameSync(temporaryPath, outputPath);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }

  const homes = args.homes.map(home => ({
    home,
    operations: readSource(join(home, 'state', 'operations.jsonl')),
    usage: readSource(join(home, 'state', 'memory-usage.jsonl')),
  }));
  const mined = mineImplicitQrels(homes, {
    sessionWindowMinutes: args.sessionWindowMinutes,
  });

  const header = {
    record: 'header',
    format: 'implicit-qrels-candidates',
    format_version: 1,
    provenance: 'implicit-journal',
    notice: CANDIDATE_NOTICE,
    review_law: 'docs/evaluation/JUDGING.md',
    proposal: 'docs/proposals/implicit-qrels-from-journal-2026-07.md',
    runner: 'scripts/implicit-qrels.mjs',
    session_window_minutes: args.sessionWindowMinutes,
    inputs: mined.homes.map(home => ({
      home: home.home,
      operations: {
        path: home.operations.path,
        status: home.operations.status,
        sha256: home.operations.sha256,
      },
      usage: {
        path: home.usage.path,
        status: home.usage.status,
        sha256: home.usage.sha256,
      },
    })),
    counts: mined.counts,
  };

  writeCandidatesAtomically(args.output, [
    header,
    ...mined.candidate_queries,
    ...mined.candidate_qrels,
  ]);

  const report = {
    notice: CANDIDATE_NOTICE,
    output: args.output,
    session_window_minutes: args.sessionWindowMinutes,
    counts: mined.counts,
    homes: mined.homes,
    coverage: mined.coverage,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

const isDirectRun = process.argv[1] !== undefined
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`qrels:implicit: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
