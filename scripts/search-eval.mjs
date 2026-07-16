#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import os from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const HELP = `Usage:
  pnpm search:eval -- \\
    --corpus <entities.jsonl> \\
    --queries <queries.jsonl> \\
    --qrels <qrels.jsonl> \\
    --output <report.json> \\
    [--warmups N] \\
    [--repetitions N]

Required:
  --corpus       One Entity JSON object per line
  --queries      One judged search/recall query per line
  --qrels        One graded relevance judgment per line
  --output       Durable JSON report destination

Optional:
  --warmups      Full-query-set warmup passes (default: 1)
  --repetitions  Measured full-query-set passes (default: 3)
  --help         Show this help

Run "pnpm build" before executing a benchmark.
`;

const REQUIRED_ARGUMENTS = ['corpus', 'queries', 'qrels', 'output'];
const VALUE_ARGUMENTS = new Set([...REQUIRED_ARGUMENTS, 'warmups', 'repetitions']);
const SEARCHABLE_TYPES = new Set([
  'task',
  'epic',
  'folder',
  'artifact',
  'milestone',
  'cron',
  'memory',
  'resource',
]);
const STATUSES = new Set(['open', 'in_progress', 'blocked', 'done', 'cancelled']);
const MEMORY_LAYERS = new Set(['episodic', 'semantic', 'procedural']);
const MODEL_METADATA = {
  id: 'Xenova/all-MiniLM-L6-v2',
  revision: 'unfixed',
  dimensions: 384,
  dtype: 'fp32',
  max_tokens: 256,
  document_prefix: '',
  query_prefix: '',
  pooling: 'mean',
  post_pool_transform: 'none',
  normalize: true,
};

function fail(message) {
  throw new Error(message);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value, location) {
  if (!isRecord(value)) fail(`${location} must be a JSON object`);
  return value;
}

function requireString(value, location) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`${location} must be a non-empty string`);
  }
  return value;
}

function requireStringArray(value, location) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.trim() === '')) {
    fail(`${location} must be an array of non-empty strings`);
  }
  return value;
}

function requireNonEmptyStringArray(value, location) {
  const values = requireStringArray(value, location);
  if (values.length === 0) fail(`${location} must not be empty`);
  return values;
}

function requireReviewedAssessor(value, location) {
  const assessor = requireString(value, location);
  if (!assessor.includes('reviewed:')) {
    fail(`${location} must include an independent "reviewed:" assessor`);
  }
  return assessor;
}

function requirePositiveInteger(value, name, defaultValue) {
  if (value === undefined) return defaultValue;
  if (!/^\d+$/.test(value)) fail(`--${name} must be a positive integer`);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    fail(`--${name} must be a positive integer`);
  }
  return parsed;
}

function requireNonnegativeInteger(value, name, defaultValue) {
  if (value === undefined) return defaultValue;
  if (!/^\d+$/.test(value)) fail(`--${name} must be a nonnegative integer`);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed)) fail(`--${name} must be a nonnegative integer`);
  return parsed;
}

function parseArguments(argv) {
  if (argv.includes('--help')) return { help: true };
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--') continue;
    if (!token?.startsWith('--')) fail(`Unexpected positional argument: ${token ?? ''}`);
    const name = token.slice(2);
    if (!VALUE_ARGUMENTS.has(name)) fail(`Unknown option: --${name}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) fail(`Missing value for --${name}`);
    if (values[name] !== undefined) fail(`Duplicate option: --${name}`);
    values[name] = value;
    index += 1;
  }
  for (const name of REQUIRED_ARGUMENTS) {
    if (values[name] === undefined) fail(`Missing required option: --${name}`);
  }
  return {
    help: false,
    corpus: resolve(values.corpus),
    queries: resolve(values.queries),
    qrels: resolve(values.qrels),
    output: resolve(values.output),
    warmups: requireNonnegativeInteger(values.warmups, 'warmups', 1),
    repetitions: requirePositiveInteger(values.repetitions, 'repetitions', 3),
  };
}

function readJsonLines(path, label) {
  let raw;
  try {
    raw = readFileSync(path);
  } catch (error) {
    fail(`Cannot read ${label} file ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const records = [];
  const lines = raw.toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim();
    if (!line) continue;
    try {
      records.push(JSON.parse(line));
    } catch (error) {
      fail(`${label} ${path}:${index + 1} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (records.length === 0) fail(`${label} file ${path} contains no JSON records`);
  return { raw, records };
}

function validateStringEnumArray(value, allowed, location) {
  const values = requireStringArray(value, location);
  for (const item of values) {
    if (!allowed.has(item)) fail(`${location} contains unsupported value "${item}"`);
  }
  return values;
}

function validateLimit(value, location) {
  if (!Number.isSafeInteger(value) || value < 1) fail(`${location} must be a positive integer`);
  return value;
}

function validateSearchOptions(value, location) {
  const options = requireRecord(value, location);
  const validated = {};
  if (options.types !== undefined) {
    validated.types = validateStringEnumArray(options.types, SEARCHABLE_TYPES, `${location}.types`);
  }
  if (options.status !== undefined) {
    validated.status = validateStringEnumArray(options.status, STATUSES, `${location}.status`);
  }
  if (options.parent_id !== undefined) {
    validated.parent_id = requireString(options.parent_id, `${location}.parent_id`);
  }
  if (options.limit !== undefined) validated.limit = validateLimit(options.limit, `${location}.limit`);
  const allowed = new Set(['types', 'status', 'parent_id', 'limit']);
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) fail(`${location} contains unsupported field "${key}"`);
  }
  return validated;
}

function validateRecallOptions(value, location) {
  const options = requireRecord(value, location);
  const validated = {};
  if (options.layers !== undefined) {
    validated.layers = validateStringEnumArray(options.layers, MEMORY_LAYERS, `${location}.layers`);
  }
  if (options.context !== undefined) {
    validated.context = requireString(options.context, `${location}.context`);
  }
  if (options.tags !== undefined) validated.tags = requireStringArray(options.tags, `${location}.tags`);
  if (options.limit !== undefined) validated.limit = validateLimit(options.limit, `${location}.limit`);
  const allowed = new Set(['layers', 'context', 'tags', 'limit']);
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) fail(`${location} contains unsupported field "${key}"`);
  }
  return validated;
}

function validateQueries(records) {
  const queries = [];
  const ids = new Set();
  records.forEach((raw, index) => {
    const location = `queries line ${index + 1}`;
    const query = requireRecord(raw, location);
    const id = requireString(query.id, `${location}.id`);
    if (ids.has(id)) fail(`Duplicate query ID: ${id}`);
    ids.add(id);
    const surface = requireString(query.surface, `${location}.surface`);
    if (surface !== 'search' && surface !== 'recall') {
      fail(`${location}.surface must be "search" or "recall"`);
    }
    queries.push({
      id,
      class: requireString(query.class, `${location}.class`),
      surface,
      query: requireString(query.query, `${location}.query`),
      ...(query.options === undefined
        ? {}
        : {
            options: surface === 'search'
              ? validateSearchOptions(query.options, `${location}.options`)
              : validateRecallOptions(query.options, `${location}.options`),
          }),
      assessor: requireReviewedAssessor(query.assessor, `${location}.assessor`),
      rationale: requireString(query.rationale, `${location}.rationale`),
      provenance: requireNonEmptyStringArray(query.provenance, `${location}.provenance`),
    });
  });
  return queries;
}

function validateQrels(records, queryIds, documentIds) {
  const qrels = [];
  const pairs = new Set();
  records.forEach((raw, index) => {
    const location = `qrels line ${index + 1}`;
    const qrel = requireRecord(raw, location);
    const queryId = requireString(qrel.query_id, `${location}.query_id`);
    const documentId = requireString(qrel.document_id, `${location}.document_id`);
    if (!queryIds.has(queryId)) fail(`${location} references unknown query "${queryId}"`);
    if (!documentIds.has(documentId)) fail(`${location} references unknown document "${documentId}"`);
    const pair = `${queryId}\0${documentId}`;
    if (pairs.has(pair)) fail(`Duplicate qrel pair: ${queryId} / ${documentId}`);
    pairs.add(pair);
    if (!Number.isInteger(qrel.grade) || qrel.grade < 0 || qrel.grade > 3) {
      fail(`${location}.grade must be one of 0, 1, 2, or 3`);
    }
    qrels.push({
      query_id: queryId,
      document_id: documentId,
      grade: qrel.grade,
      assessor: requireReviewedAssessor(qrel.assessor, `${location}.assessor`),
      rationale: requireString(qrel.rationale, `${location}.rationale`),
    });
  });
  for (const queryId of queryIds) {
    if (!qrels.some(qrel => qrel.query_id === queryId)) {
      fail(`Query "${queryId}" has no qrels`);
    }
  }
  return qrels;
}

async function validateCorpus(records, entitySchema) {
  const entities = [];
  const ids = new Set();
  records.forEach((raw, index) => {
    const location = `corpus line ${index + 1}`;
    let entity;
    try {
      entity = entitySchema.parse(raw);
    } catch (error) {
      fail(`${location} is not a valid Entity: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (ids.has(entity.id)) fail(`Duplicate corpus document ID: ${entity.id}`);
    ids.add(entity.id);
    entities.push(entity);
  });
  return { entities, ids };
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.min(ordered.length - 1, Math.ceil(fraction * ordered.length) - 1);
  return ordered[Math.max(0, index)] ?? 0;
}

function roundMilliseconds(value) {
  return Number(value.toFixed(3));
}

function durationMilliseconds(start) {
  return Number(process.hrtime.bigint() - start) / 1_000_000;
}

function recordRss(samples, phase) {
  samples.push({ phase, bytes: process.memoryUsage().rss });
}

function fileBytes(path) {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function readPackageVersion(requireFromServer, packageName) {
  try {
    const packagePath = requireFromServer.resolve(`${packageName}/package.json`);
    return JSON.parse(readFileSync(packagePath, 'utf8')).version ?? 'unknown';
  } catch {
    try {
      let current = dirname(requireFromServer.resolve(packageName));
      while (current !== dirname(current)) {
        const packagePath = join(current, 'package.json');
        if (existsSync(packagePath)) {
          const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
          if (packageJson.name === packageName) return packageJson.version ?? 'unknown';
        }
        current = dirname(current);
      }
      return 'unknown';
    } catch {
      return 'unknown';
    }
  }
}

function buildEnvironment(repoRoot) {
  const requireFromServer = createRequire(join(repoRoot, 'packages/server/package.json'));
  const transformersRequire = createRequire(requireFromServer.resolve('@huggingface/transformers'));
  const serverPackage = JSON.parse(readFileSync(join(repoRoot, 'packages/server/package.json'), 'utf8'));
  const memoryPackage = JSON.parse(readFileSync(join(repoRoot, 'packages/memory/package.json'), 'utf8'));
  const cpus = os.cpus();
  const firstCpu = cpus[0];
  return {
    node: process.version,
    platform: process.platform,
    os_release: os.release(),
    arch: process.arch,
    cpu: firstCpu?.model ?? 'unknown',
    cpu_count: cpus.length,
    ram_bytes: os.totalmem(),
    packages: {
      'backlog-mcp': serverPackage.version ?? 'unknown',
      '@backlog-mcp/memory': memoryPackage.version ?? 'unknown',
      '@huggingface/transformers': readPackageVersion(requireFromServer, '@huggingface/transformers'),
      '@orama/orama': readPackageVersion(requireFromServer, '@orama/orama'),
      'onnxruntime-node': readPackageVersion(transformersRequire, 'onnxruntime-node'),
    },
  };
}

class BenchmarkServiceAdapter {
  constructor(searchService) {
    this.searchService = searchService;
  }

  async searchUnified(query, options) {
    const results = await this.searchService.searchAll(query, {
      docTypes: options?.types,
      limit: options?.limit ?? 20,
      sort: options?.sort === 'recent' ? 'recent' : 'relevant',
      filters: {
        status: options?.status,
        parent_id: options?.parent_id,
      },
    });
    return results.map(result => ({
      item: result.item,
      score: result.score,
      type: result.type,
      snippet: result.snippet,
    }));
  }
}

function groupJudgments(qrels) {
  const grouped = new Map();
  for (const qrel of qrels) {
    const current = grouped.get(qrel.query_id) ?? [];
    current.push({ id: qrel.document_id, grade: qrel.grade });
    grouped.set(qrel.query_id, current);
  }
  return grouped;
}

async function retrieve(query, adapter, memoryStore) {
  if (query.surface === 'recall') {
    const results = await memoryStore.recall({
      query: query.query,
      limit: query.options?.limit ?? 20,
      layers: query.options?.layers,
      context: query.options?.context,
      tags: query.options?.tags,
    });
    return results.map(result => result.entry.id);
  }
  const results = await adapter.searchUnified(query.query, {
    types: query.options?.types,
    status: query.options?.status,
    parent_id: query.options?.parent_id,
    limit: query.options?.limit ?? 20,
  });
  return results.map(result => result.item.id);
}

async function runQuerySet(queries, adapter, memoryStore) {
  const results = [];
  for (const query of queries) {
    const start = process.hrtime.bigint();
    const rankedIds = await retrieve(query, adapter, memoryStore);
    results.push({
      query_id: query.id,
      ranked_ids: rankedIds,
      duration_ms: roundMilliseconds(durationMilliseconds(start)),
    });
  }
  return results;
}

function summarizeMode(queries, measuredRuns, judgmentsByQuery, metrics) {
  const firstRun = measuredRuns[0] ?? [];
  const firstById = new Map(firstRun.map(result => [result.query_id, result]));
  const timingsById = new Map();
  for (const run of measuredRuns) {
    for (const result of run) {
      const values = timingsById.get(result.query_id) ?? [];
      values.push(result.duration_ms);
      timingsById.set(result.query_id, values);
    }
  }

  const perQuery = queries.map(query => {
    const first = firstById.get(query.id);
    if (!first) fail(`Missing measured result for query "${query.id}"`);
    const timings = timingsById.get(query.id) ?? [];
    const deterministic = measuredRuns.every(run => {
      const result = run.find(candidate => candidate.query_id === query.id);
      return JSON.stringify(result?.ranked_ids ?? []) === JSON.stringify(first.ranked_ids);
    });
    const judgments = judgmentsByQuery.get(query.id) ?? [];
    return {
      query_id: query.id,
      class: query.class,
      surface: query.surface,
      ranked_ids: first.ranked_ids,
      timings_ms: timings,
      deterministic,
      metrics: metrics.evaluateQuery(first.ranked_ids, judgments),
      unjudged_at_10: metrics.unjudgedRateAt(first.ranked_ids, judgments, 10),
    };
  });

  const overallMetrics = metrics.summarizeEvaluations(perQuery.map(result => result.metrics));
  const byClass = {};
  for (const queryClass of [...new Set(queries.map(query => query.class))].sort()) {
    const classResults = perQuery.filter(result => result.class === queryClass);
    byClass[queryClass] = {
      ...metrics.summarizeEvaluations(classResults.map(result => result.metrics)),
      unjudged_at_10: classResults.reduce((sum, result) => sum + result.unjudged_at_10, 0)
        / classResults.length,
    };
  }
  const allTimings = perQuery.flatMap(result => result.timings_ms);
  return {
    deterministic_repeat_check: perQuery.every(result => result.deterministic),
    overall: {
      ...overallMetrics,
      unjudged_at_10: perQuery.reduce((sum, result) => sum + result.unjudged_at_10, 0)
        / perQuery.length,
    },
    by_class: byClass,
    first_measured_query: {
      query_id: firstRun[0]?.query_id ?? null,
      duration_ms: firstRun[0]?.duration_ms ?? null,
    },
    warm_query_latency_ms: {
      p50: roundMilliseconds(percentile(allTimings, 0.5)),
      p95: roundMilliseconds(percentile(allTimings, 0.95)),
    },
    queries: perQuery,
  };
}

async function benchmarkMode({
  mode,
  hybridSearch,
  entities,
  queries,
  qrels,
  warmups,
  repetitions,
  cachePath,
  OramaSearchService,
  BacklogMemoryStore,
  metrics,
}) {
  const rssSamples = [];
  recordRss(rssSamples, 'before_index');
  const searchService = new OramaSearchService({ cachePath, hybridSearch });
  const adapter = new BenchmarkServiceAdapter(searchService);
  const memoryStore = new BacklogMemoryStore(() => adapter);
  const indexStart = process.hrtime.bigint();
  await searchService.index(entities);
  const indexDuration = roundMilliseconds(durationMilliseconds(indexStart));
  searchService.flush();
  recordRss(rssSamples, 'after_index');

  const hybridActive = searchService.isHybridSearchActive();
  if (hybridSearch && !hybridActive) {
    fail('MiniLM hybrid initialization failed; refusing to record a BM25 fallback as a hybrid baseline');
  }

  for (let index = 0; index < warmups; index += 1) {
    await runQuerySet(queries, adapter, memoryStore);
  }
  recordRss(rssSamples, 'after_warmups');

  const measuredRuns = [];
  for (let index = 0; index < repetitions; index += 1) {
    measuredRuns.push(await runQuerySet(queries, adapter, memoryStore));
    recordRss(rssSamples, `after_repetition_${index + 1}`);
  }
  searchService.flush();
  recordRss(rssSamples, 'after_flush');

  return {
    mode,
    hybrid_active: hybridActive,
    build_duration_ms: indexDuration,
    cache_bytes: fileBytes(cachePath),
    rss: {
      before_bytes: rssSamples[0]?.bytes ?? process.memoryUsage().rss,
      after_bytes: rssSamples.at(-1)?.bytes ?? process.memoryUsage().rss,
      peak_sampled_bytes: Math.max(...rssSamples.map(sample => sample.bytes)),
      samples: rssSamples,
    },
    ...summarizeMode(queries, measuredRuns, groupJudgments(qrels), metrics),
  };
}

function writeReportAtomically(outputPath, report) {
  mkdirSync(dirname(outputPath), { recursive: true });
  const temporaryPath = join(
    dirname(outputPath),
    `.${basename(outputPath)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    renameSync(temporaryPath, outputPath);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}

async function loadRuntime(repoRoot) {
  const paths = {
    orama: join(repoRoot, 'packages/server/dist/memory/src/search/orama-search-service.mjs'),
    memoryStore: join(repoRoot, 'packages/server/dist/memory/backlog-memory-store.mjs'),
    entitySchema: join(repoRoot, 'packages/server/dist/shared/src/substrates/registry.mjs'),
    metrics: join(repoRoot, 'packages/memory/src/search/evaluation.ts'),
  };
  for (const [name, path] of Object.entries(paths)) {
    if (!existsSync(path)) {
      fail(`Missing ${name} runtime at ${path}; run "pnpm build" first`);
    }
  }
  const [oramaModule, memoryModule, schemaModule, metrics] = await Promise.all([
    import(pathToFileURL(paths.orama).href),
    import(pathToFileURL(paths.memoryStore).href),
    import(pathToFileURL(paths.entitySchema).href),
    import(pathToFileURL(paths.metrics).href),
  ]);
  return {
    OramaSearchService: oramaModule.OramaSearchService,
    BacklogMemoryStore: memoryModule.BacklogMemoryStore,
    EntitySchema: schemaModule.EntitySchema,
    metrics,
  };
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }

  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const runtime = await loadRuntime(repoRoot);
  const corpusInput = readJsonLines(args.corpus, 'corpus');
  const queryInput = readJsonLines(args.queries, 'queries');
  const qrelInput = readJsonLines(args.qrels, 'qrels');
  const { entities, ids: documentIds } = await validateCorpus(
    corpusInput.records,
    runtime.EntitySchema,
  );
  const queries = validateQueries(queryInput.records);
  const qrels = validateQrels(qrelInput.records, new Set(queries.map(query => query.id)), documentIds);

  const benchmarkDirectory = join(
    tmpdir(),
    `backlog-mcp-search-eval-${process.pid}-${Date.now()}`,
  );
  mkdirSync(benchmarkDirectory, { recursive: true });
  try {
    const common = {
      entities,
      queries,
      qrels,
      warmups: args.warmups,
      repetitions: args.repetitions,
      OramaSearchService: runtime.OramaSearchService,
      BacklogMemoryStore: runtime.BacklogMemoryStore,
      metrics: runtime.metrics,
    };
    const bm25 = await benchmarkMode({
      ...common,
      mode: 'bm25',
      hybridSearch: false,
      cachePath: join(benchmarkDirectory, 'bm25-index.json'),
    });
    const hybrid = await benchmarkMode({
      ...common,
      mode: 'hybrid',
      hybridSearch: true,
      cachePath: join(benchmarkDirectory, 'hybrid-index.json'),
    });
    const report = {
      schema_version: 1,
      generated_at: new Date().toISOString(),
      runner: 'scripts/search-eval.mjs',
      inputs: {
        corpus: { path: args.corpus, sha256: sha256(corpusInput.raw), count: entities.length },
        queries: { path: args.queries, sha256: sha256(queryInput.raw), count: queries.length },
        qrels: { path: args.qrels, sha256: sha256(qrelInput.raw), count: qrels.length },
      },
      settings: { warmups: args.warmups, repetitions: args.repetitions },
      environment: buildEnvironment(repoRoot),
      model: MODEL_METADATA,
      modes: { bm25, hybrid },
    };
    writeReportAtomically(args.output, report);
    process.stdout.write(`Recorded search baseline: ${args.output}\n`);
  } finally {
    rmSync(benchmarkDirectory, { recursive: true, force: true });
  }
}

main().catch(error => {
  process.stderr.write(`search:eval: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
