#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
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
import { execFileSync } from 'node:child_process';

const HELP = `Usage:
  pnpm search:eval -- \\
    --project-root <project> \\
    --queries <queries.jsonl> \\
    --qrels <qrels.jsonl> \\
    --output <report.json> \\
    [--baseline-version N] \\
    [--warmups N] \\
    [--repetitions N]

Required:
  --project-root Docs-native project whose production search corpus is measured
  --queries      One judged search/recall query per line
  --qrels        One graded relevance judgment per line
  --output       Durable JSON report destination

Optional:
  --baseline-version Evidence version (default: 1; v1 is search-only)
  --warmups      Full-query-set warmup passes (default: 1)
  --repetitions  Measured full-query-set passes (default: 3)
  --help         Show this help

Run "pnpm build" before executing a benchmark.
`;

const REQUIRED_ARGUMENTS = ['project-root', 'queries', 'qrels', 'output'];
const VALUE_ARGUMENTS = new Set([
  ...REQUIRED_ARGUMENTS,
  'baseline-version',
  'warmups',
  'repetitions',
]);
const MEMORY_LAYERS = new Set(['episodic', 'semantic', 'procedural']);
const MODEL_METADATA = {
  id: 'Xenova/all-MiniLM-L6-v2',
  revision: 'default-main-unpinned',
  dimensions: 384,
  dtype: 'fp32',
  max_tokens: 512,
  trained_window_tokens: 256,
  document_prefix: '',
  query_prefix: '',
  pooling: 'mean',
  post_pool_transform: 'none',
  normalize: true,
};
const REQUIRED_MODEL_CACHE_FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'onnx/model.onnx',
];

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
    projectRoot: resolve(values['project-root']),
    queries: resolve(values.queries),
    qrels: resolve(values.qrels),
    output: resolve(values.output),
    baselineVersion: requirePositiveInteger(
      values['baseline-version'],
      'baseline-version',
      1,
    ),
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

function validateLimit(value, location) {
  if (!Number.isSafeInteger(value) || value < 1) fail(`${location} must be a positive integer`);
  return value;
}

function validateSearchOptions(value, location) {
  const options = requireRecord(value, location);
  const validated = {};
  if (options.types !== undefined) {
    validated.types = requireStringArray(options.types, `${location}.types`);
  }
  if (options.status !== undefined) {
    validated.status = requireStringArray(options.status, `${location}.status`);
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
    const layers = requireStringArray(options.layers, `${location}.layers`);
    for (const layer of layers) {
      if (!MEMORY_LAYERS.has(layer)) {
        fail(`${location}.layers contains unsupported value "${layer}"`);
      }
    }
    validated.layers = layers;
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

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function stableJsonLine(value) {
  return `${JSON.stringify(value)}\n`;
}

function corpusSnapshot(entityDocuments, resources) {
  const records = [
    ...entityDocuments.map(function entityRecord(document) {
      return { kind: 'entity', document };
    }),
    ...resources.map(function resourceRecord(resource) {
      return { kind: 'resource', resource };
    }),
  ].sort(function compareCorpusRecords(left, right) {
    const leftId = left.kind === 'entity' ? left.document.entity.id : left.resource.id;
    const rightId = right.kind === 'entity' ? right.document.entity.id : right.resource.id;
    const leftKey = String(leftId);
    const rightKey = String(rightId);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  return Buffer.from(records.map(stableJsonLine).join(''));
}

function countEntityTypes(entityDocuments) {
  const counts = {};
  for (const document of entityDocuments) {
    const type = String(document.entity.type);
    counts[type] = (counts[type] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(function compareTypes(left, right) {
    return left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0;
  }));
}

function gitCommit(repoRoot) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'unknown';
  }
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

function packageRoot(requireFromServer, packageName) {
  try {
    const packagePath = requireFromServer.resolve(`${packageName}/package.json`);
    return dirname(packagePath);
  } catch {
    try {
      let current = dirname(requireFromServer.resolve(packageName));
      while (current !== dirname(current)) {
        const packagePath = join(current, 'package.json');
        if (existsSync(packagePath)) {
          const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
          if (packageJson.name === packageName) return current;
        }
        current = dirname(current);
      }
      return undefined;
    } catch {
      return undefined;
    }
  }
}

function readPackageVersion(requireFromServer, packageName) {
  const root = packageRoot(requireFromServer, packageName);
  if (root === undefined) return 'unknown';
  try {
    return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function directoryBytes(path) {
  if (!existsSync(path)) return 0;
  let bytes = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const entryPath = join(path, entry.name);
    bytes += entry.isDirectory() ? directoryBytes(entryPath) : fileBytes(entryPath);
  }
  return bytes;
}

function modelCacheSnapshot(cacheDir) {
  const path = join(cacheDir, ...MODEL_METADATA.id.split('/'));
  const requiredFiles = Object.fromEntries(REQUIRED_MODEL_CACHE_FILES.map(
    function modelFile(relativePath) {
      const absolutePath = join(path, ...relativePath.split('/'));
      return [relativePath, existsSync(absolutePath) ? sha256(readFileSync(absolutePath)) : null];
    },
  ));
  return {
    path,
    bytes: directoryBytes(path),
    complete: Object.values(requiredFiles).every(hash => hash !== null),
    required_file_sha256: requiredFiles,
  };
}

function assertModelMetadata(repoRoot) {
  const source = readFileSync(
    join(repoRoot, 'packages/memory/src/search/embedding-service.ts'),
    'utf8',
  );
  const expectedSource = [
    `const MODEL_ID = '${MODEL_METADATA.id}'`,
    `export const EMBEDDING_DIMENSIONS = ${MODEL_METADATA.dimensions}`,
    `dtype: '${MODEL_METADATA.dtype}'`,
    `pooling: '${MODEL_METADATA.pooling}'`,
    `normalize: ${String(MODEL_METADATA.normalize)}`,
  ];
  for (const fragment of expectedSource) {
    if (!source.includes(fragment)) {
      fail(`Runner model metadata drifted from embedding-service.ts: ${fragment}`);
    }
  }
}

function assertRuntimeTokenBoundary(modelPath) {
  const tokenizerConfig = JSON.parse(
    readFileSync(join(modelPath, 'tokenizer_config.json'), 'utf8'),
  );
  const modelConfig = JSON.parse(
    readFileSync(join(modelPath, 'config.json'), 'utf8'),
  );
  if (
    tokenizerConfig.model_max_length !== MODEL_METADATA.max_tokens
    || modelConfig.max_position_embeddings !== MODEL_METADATA.max_tokens
  ) {
    fail('Runner max_tokens drifted from the cached tokenizer/model boundary');
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
  entityDocuments,
  resources,
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
  const serviceBuildStart = process.hrtime.bigint();
  recordRss(rssSamples, 'before_index');
  const searchService = new OramaSearchService({ cachePath, hybridSearch });
  const adapter = new BenchmarkServiceAdapter(searchService);
  const memoryStore = new BacklogMemoryStore(() => adapter);
  const indexStart = process.hrtime.bigint();
  await searchService.index(entityDocuments);
  await searchService.reconcileResources(resources);
  const indexDuration = roundMilliseconds(durationMilliseconds(indexStart));
  searchService.flush();
  recordRss(rssSamples, 'after_index');

  const hybridActive = searchService.isHybridSearchActive();
  if (hybridSearch && !hybridActive) {
    fail('MiniLM hybrid initialization failed; refusing to record a BM25 fallback as a hybrid baseline');
  }

  const firstQuery = queries[0];
  if (firstQuery === undefined) fail('At least one query is required');
  const firstResultStart = process.hrtime.bigint();
  await retrieve(firstQuery, adapter, memoryStore);
  const firstResultAfterReady = roundMilliseconds(durationMilliseconds(firstResultStart));
  const serviceBuildToFirstResult = roundMilliseconds(
    durationMilliseconds(serviceBuildStart),
  );

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
    startup_ms: {
      service_build_to_first_result: serviceBuildToFirstResult,
      first_result_after_ready: firstResultAfterReady,
      probe_query_id: firstQuery.id,
    },
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
  const requireFromServer = createRequire(join(repoRoot, 'packages/server/package.json'));
  const paths = {
    orama: join(repoRoot, 'packages/server/dist/memory/src/search/orama-search-service.mjs'),
    memoryStore: join(repoRoot, 'packages/server/dist/memory/backlog-memory-store.mjs'),
    backlogHome: join(repoRoot, 'packages/server/dist/core/backlog-home.mjs'),
    homeRegistry: join(repoRoot, 'packages/server/dist/storage/local/home-substrate-registry.mjs'),
    storageCatalog: join(repoRoot, 'packages/server/dist/storage/local/builtin-substrate-storage-catalog.mjs'),
    storage: join(repoRoot, 'packages/server/dist/storage/local/docs-native-filesystem-storage.mjs'),
    searchDocument: join(repoRoot, 'packages/server/dist/core/substrates/create-search-entity-document.mjs'),
    resourceManager: join(repoRoot, 'packages/server/dist/resources/manager.mjs'),
    metrics: join(repoRoot, 'packages/memory/src/search/evaluation.ts'),
    transformers: requireFromServer.resolve('@huggingface/transformers'),
  };
  for (const [name, path] of Object.entries(paths)) {
    if (!existsSync(path)) {
      fail(`Missing ${name} runtime at ${path}; run "pnpm build" first`);
    }
  }
  const [
    oramaModule,
    memoryModule,
    backlogHomeModule,
    homeRegistryModule,
    storageCatalogModule,
    storageModule,
    searchDocumentModule,
    resourceManagerModule,
    metrics,
    transformersModule,
  ] = await Promise.all([
    import(pathToFileURL(paths.orama).href),
    import(pathToFileURL(paths.memoryStore).href),
    import(pathToFileURL(paths.backlogHome).href),
    import(pathToFileURL(paths.homeRegistry).href),
    import(pathToFileURL(paths.storageCatalog).href),
    import(pathToFileURL(paths.storage).href),
    import(pathToFileURL(paths.searchDocument).href),
    import(pathToFileURL(paths.resourceManager).href),
    import(pathToFileURL(paths.metrics).href),
    import(pathToFileURL(paths.transformers).href),
  ]);
  return {
    OramaSearchService: oramaModule.OramaSearchService,
    BacklogMemoryStore: memoryModule.BacklogMemoryStore,
    resolveBacklogHome: backlogHomeModule.resolveBacklogHome,
    loadHomeSubstrateRegistry: homeRegistryModule.loadHomeSubstrateRegistry,
    BuiltinSubstrateStorageCatalog: storageCatalogModule.BuiltinSubstrateStorageCatalog,
    DocsNativeFilesystemStorage: storageModule.DocsNativeFilesystemStorage,
    createSearchEntityDocument: searchDocumentModule.createSearchEntityDocument,
    ResourceManager: resourceManagerModule.ResourceManager,
    metrics,
    transformersCacheDir:
      transformersModule.env?.cacheDir
      ?? transformersModule.default?.env?.cacheDir,
  };
}

function loadProductCorpus(args, runtime) {
  const home = runtime.resolveBacklogHome({
    home: 'project',
    projectRoot: args.projectRoot,
  });
  const definitions = runtime.loadHomeSubstrateRegistry(
    home,
    new runtime.BuiltinSubstrateStorageCatalog(),
  );
  if (definitions.diagnostics.length > 0) {
    fail(`Project substrate diagnostics prevent a baseline: ${JSON.stringify(definitions.diagnostics)}`);
  }
  const storage = new runtime.DocsNativeFilesystemStorage(home, definitions.registry);
  const storedDocuments = Array.from(storage.iterateDocuments());
  const getSearchFields = definitions.registry.getSearchFields.bind(definitions.registry);
  const entityDocuments = storedDocuments.flatMap(function projectStoredEntity(stored) {
    const document = runtime.createSearchEntityDocument(stored.entity, getSearchFields);
    return document === undefined ? [] : [document];
  });
  const entitySourcePaths = new Set(storedDocuments.map(function sourcePath(stored) {
    return stored.sourcePath;
  }));
  const resourceManager = new runtime.ResourceManager(home.documentsDir);
  const resources = resourceManager.list().filter(function excludeEntityMarkdown(resource) {
    return !entitySourcePaths.has(resource.path);
  });
  const ids = new Set();
  const documentIds = [
    ...entityDocuments.map(function entityId(document) {
      return document.entity.id;
    }),
    ...resources.map(function resourceId(resource) {
      return resource.id;
    }),
  ];
  for (const id of documentIds) {
    if (ids.has(id)) fail(`Duplicate corpus document ID: ${id}`);
    ids.add(id);
  }
  if (ids.size === 0) fail(`Project corpus is empty: ${home.documentsDir}`);
  return { home, entityDocuments, resources, ids };
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }

  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const runtime = await loadRuntime(repoRoot);
  assertModelMetadata(repoRoot);
  if (typeof runtime.transformersCacheDir !== 'string') {
    fail('Cannot resolve the active Transformers.js filesystem cache');
  }
  const queryInput = readJsonLines(args.queries, 'queries');
  const qrelInput = readJsonLines(args.qrels, 'qrels');
  const corpus = loadProductCorpus(args, runtime);
  const corpusInput = corpusSnapshot(corpus.entityDocuments, corpus.resources);
  const queries = validateQueries(queryInput.records);
  const recallQueries = queries.filter(query => query.surface === 'recall');
  if (args.baselineVersion === 1 && recallQueries.length > 0) {
    fail('Baseline v1 is search-only; real-memory recall evidence begins in v2');
  }
  if (args.baselineVersion >= 2) {
    if (recallQueries.length < 4) {
      fail('Baseline v2+ requires at least four reviewed memory-recall queries');
    }
    if ((countEntityTypes(corpus.entityDocuments).memory ?? 0) === 0) {
      fail('Baseline v2+ requires a real memory corpus; synthetic memories are not evidence');
    }
  }
  const qrels = validateQrels(
    qrelInput.records,
    new Set(queries.map(query => query.id)),
    corpus.ids,
  );

  const benchmarkDirectory = join(
    tmpdir(),
    `backlog-mcp-search-eval-${process.pid}-${Date.now()}`,
  );
  mkdirSync(benchmarkDirectory, { recursive: true });
  try {
    const modelCacheBefore = modelCacheSnapshot(runtime.transformersCacheDir);
    const common = {
      entityDocuments: corpus.entityDocuments,
      resources: corpus.resources,
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
    const modelCacheAfter = modelCacheSnapshot(runtime.transformersCacheDir);
    if (!modelCacheAfter.complete) {
      fail('Hybrid search initialized without a complete MiniLM cache snapshot');
    }
    // Transformers.js 3.8.1 enforces these cached runtime values. The model
    // authors' separately reported 256-token trained window remains metadata.
    assertRuntimeTokenBoundary(modelCacheAfter.path);
    const modelDownloadedBytes = Math.max(
      0,
      modelCacheAfter.bytes - modelCacheBefore.bytes,
    );
    const modelSource = modelCacheBefore.complete
      && modelCacheAfter.bytes === modelCacheBefore.bytes
      ? 'cache'
      : 'downloaded';
    const report = {
      schema_version: 1,
      baseline_version: args.baselineVersion,
      generated_at: new Date().toISOString(),
      runner: 'scripts/search-eval.mjs',
      inputs: {
        corpus: {
          project_root: corpus.home.root,
          documents_dir: corpus.home.documentsDir,
          home_id: corpus.home.id,
          sha256: sha256(corpusInput),
          count: corpus.ids.size,
          entity_count: corpus.entityDocuments.length,
          resource_count: corpus.resources.length,
          entity_types: countEntityTypes(corpus.entityDocuments),
        },
        queries: { path: args.queries, sha256: sha256(queryInput.raw), count: queries.length },
        qrels: { path: args.qrels, sha256: sha256(qrelInput.raw), count: qrels.length },
      },
      scope: {
        surfaces: [...new Set(queries.map(query => query.surface))].sort(),
        recall_classes: [...new Set(queries.filter(
          query => query.surface === 'recall',
        ).map(query => query.class))].sort(),
        ...(queries.some(query => query.surface === 'recall')
          ? {}
          : {
              recall_limitation: 'Absent — blocked pending a real memory corpus after global Phase E migration into ~/.backlog/docs; this report is not recall evidence.',
            }),
      },
      settings: {
        warmups: args.warmups,
        repetitions: args.repetitions,
        query_warmups_skipped: args.warmups === 0,
      },
      environment: buildEnvironment(repoRoot),
      provenance: {
        git_commit: gitCommit(repoRoot),
        runner_sha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
        corpus_membership_ruling: 'Beryl domain ruling, 2026-07-16: record after ADR 0113 Phase C so packaged substrate documents are members of the measured corpus.',
        query_assessors: [...new Set(queries.map(query => query.assessor))].sort(),
        qrel_assessors: [...new Set(qrels.map(qrel => qrel.assessor))].sort(),
        query_sources: Object.fromEntries(queries.map(function querySource(query) {
          return [query.id, query.provenance];
        })),
      },
      model: {
        ...MODEL_METADATA,
        model_source: modelSource,
        cache_path: modelCacheAfter.path,
        cache_complete_before: modelCacheBefore.complete,
        cache_complete_after: modelCacheAfter.complete,
        cache_bytes_before: modelCacheBefore.bytes,
        cache_bytes_after: modelCacheAfter.bytes,
        required_file_sha256: modelCacheAfter.required_file_sha256,
        ...(modelSource === 'downloaded'
          ? { downloaded_bytes: modelDownloadedBytes }
          : {}),
      },
      readiness_ms: {
        lexical_ready: bm25.build_duration_ms,
        semantic_ready: hybrid.build_duration_ms,
      },
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
