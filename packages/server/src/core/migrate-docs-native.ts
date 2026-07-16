import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import {
  basename,
  dirname,
  extname,
  join,
  posix,
  relative,
  resolve,
  sep,
} from 'node:path';
import matter from 'gray-matter';
import { parseEntityId } from '@backlog-mcp/shared';
import { discoverDocuments } from './document-discovery.js';
import { parseDocumentIdentity } from './document-identity.js';
import { claimSubstrateDocuments } from './substrates/index.js';
import { storageDocumentSourcePath } from '../storage/storage-identity.js';
import type {
  DocsNativeMigrationAction,
  DocsNativeMigrationConfig,
  DocsNativeMigrationConfigSource,
  DocsNativeMigrationDirectoryEntry,
  DocsNativeMigrationFileSystem,
  DocsNativeMigrationIssue,
  DocsNativeMigrationMove,
  DocsNativeMigrationPlan,
  DocsNativeMigrationReport,
  MigrateDocsNativeParams,
  PlanDocsNativeMigrationParams,
} from './migrate-docs-native.types.js';

const realFileSystem: DocsNativeMigrationFileSystem = {
  exists: existsSync,
  readDirectory: function readDirectory(path) {
    return readdirSync(path, { withFileTypes: true });
  },
  readFile: readFileSync,
  makeDirectory: function makeDirectory(path) {
    mkdirSync(path, { recursive: true });
  },
  writeFileExclusive: function writeFileExclusive(path, content) {
    writeFileSync(path, content, { flag: 'wx' });
  },
  writeFile: writeFileSync,
  unlink: unlinkSync,
  removeTree: function removeTree(path) {
    rmSync(path, { recursive: true, force: true });
  },
  removeEmptyDirectory: function removeEmptyDirectory(path) {
    try {
      rmdirSync(path);
    } catch {
      // Existing or concurrently-created siblings keep their directory.
    }
  },
};

interface CollectedLegacyFile {
  sourcePath: string;
  absolutePath: string;
}

interface PlannedEntityDocument {
  sourcePath: string;
  type: string;
  id: string;
  targetDocumentPath: string;
  content: string;
}

const LEGACY_PROJECT_CONTROL_DIR = '.backlog-mcp';

/** Error containing every deterministic preflight issue. */
export class DocsNativeMigrationError extends Error {
  constructor(readonly issues: readonly DocsNativeMigrationIssue[]) {
    super(issues.map(function formatIssue(issue) {
      return issue.message;
    }).join('\n'));
    this.name = 'DocsNativeMigrationError';
  }
}

function fileSystem(
  overrides: Partial<DocsNativeMigrationFileSystem> | undefined,
): DocsNativeMigrationFileSystem {
  return { ...realFileSystem, ...overrides };
}

function toPosix(path: string): string {
  return path.split(sep).join('/');
}

function rootRelativePath(root: string, path: string): string {
  const result = toPosix(relative(root, path));
  if (result === '') return '';
  if (
    result === '..'
    || result.startsWith('../')
    || posix.isAbsolute(result)
  ) {
    throw new Error(`Migration path must be inside its root: ${path}`);
  }
  return result;
}

function compareActions(
  left: DocsNativeMigrationAction,
  right: DocsNativeMigrationAction,
): number {
  const leftPath = left.kind === 'move'
    ? `${left.targetPath}\u0000${left.sourcePath}`
    : left.kind === 'config'
      ? `${left.targetPath}\u0000config`
      : `${left.root}\u0000${left.path}`;
  const rightPath = right.kind === 'move'
    ? `${right.targetPath}\u0000${right.sourcePath}`
    : right.kind === 'config'
      ? `${right.targetPath}\u0000config`
      : `${right.root}\u0000${right.path}`;
  return leftPath.localeCompare(rightPath);
}

function compareIssues(
  left: DocsNativeMigrationIssue,
  right: DocsNativeMigrationIssue,
): number {
  const codeOrder = left.code.localeCompare(right.code);
  if (codeOrder !== 0) return codeOrder;
  const leftPath = left.targetPath ?? left.sourcePaths[0] ?? '';
  const rightPath = right.targetPath ?? right.sourcePaths[0] ?? '';
  return leftPath.localeCompare(rightPath);
}

function collectFiles(
  root: string,
  sourceRoot: string,
  fs: DocsNativeMigrationFileSystem,
  issues: DocsNativeMigrationIssue[],
): CollectedLegacyFile[] {
  if (!fs.exists(sourceRoot)) return [];

  const files: CollectedLegacyFile[] = [];
  function visit(directory: string): void {
    let entries: DocsNativeMigrationDirectoryEntry[];
    try {
      entries = fs.readDirectory(directory);
    } catch (error) {
      issues.push({
        code: 'unsupported-source',
        message: `Cannot read legacy migration directory ${rootRelativePath(root, directory)}: ${String(error)}`,
        sourcePaths: [rootRelativePath(root, directory)],
      });
      return;
    }

    entries.sort(function compareNames(left, right) {
      return left.name.localeCompare(right.name);
    });
    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      const sourcePath = rootRelativePath(root, absolutePath);
      if (entry.isSymbolicLink()) {
        issues.push({
          code: 'unsupported-source',
          message: `Legacy migration does not follow symbolic links: ${sourcePath}`,
          sourcePaths: [sourcePath],
        });
      } else if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile()) {
        files.push({ sourcePath, absolutePath });
      } else {
        issues.push({
          code: 'unsupported-source',
          message: `Unsupported legacy migration source: ${sourcePath}`,
          sourcePaths: [sourcePath],
        });
      }
    }
  }

  visit(sourceRoot);
  return files.sort(function compareSourcePaths(left, right) {
    return left.sourcePath.localeCompare(right.sourcePath);
  });
}

function createMove(
  category: DocsNativeMigrationMove['category'],
  sourcePath: string,
  targetPath: string,
  entity?: { id: string; type: string },
): DocsNativeMigrationMove {
  return {
    kind: 'move',
    category,
    sourcePath,
    targetPath,
    ...(entity === undefined
      ? {}
      : { entityId: entity.id, substrateType: entity.type }),
  };
}

function planEntity(
  file: CollectedLegacyFile,
  params: PlanDocsNativeMigrationParams,
  fs: DocsNativeMigrationFileSystem,
  documentsRootPath: string,
  issues: DocsNativeMigrationIssue[],
): {
  move?: DocsNativeMigrationMove;
  document?: PlannedEntityDocument;
} {
  if (!/\.md$/iu.test(file.sourcePath)) {
    const relativeTaskPath = toPosix(relative(
      join(resolve(params.legacyRoot ?? params.home.root), 'tasks'),
      file.absolutePath,
    ));
    return {
      move: createMove(
        'resource',
        file.sourcePath,
        posix.join(documentsRootPath, 'resources', 'legacy-tasks', relativeTaskPath),
      ),
    };
  }

  let raw: Buffer;
  try {
    raw = fs.readFile(file.absolutePath);
  } catch (error) {
    issues.push({
      code: 'invalid-entity',
      message: `Cannot read legacy entity ${file.sourcePath}: ${String(error)}`,
      sourcePaths: [file.sourcePath],
    });
    return {};
  }

  try {
    const markdown = matter(raw.toString('utf-8'), {});
    const data = markdown.data as Record<string, unknown>;
    const filenameId = basename(file.sourcePath, extname(file.sourcePath));
    const id = typeof data.id === 'string' && data.id.trim()
      ? data.id.trim()
      : filenameId;
    if (id !== filenameId) {
      issues.push({
        code: 'invalid-entity',
        message: `Legacy entity id ${id} does not match filename ${filenameId}: ${file.sourcePath}`,
        sourcePaths: [file.sourcePath],
      });
      return {};
    }
    const inferredType = parseEntityId(id)?.type ?? 'task';
    const type = typeof data.type === 'string' && data.type.trim()
      ? data.type.trim()
      : inferredType;
    const candidate = {
      ...data,
      id,
      type,
      content: markdown.content.trim(),
    };
    const validation = params.registry.validateWrite(candidate);
    if (!validation.ok) {
      issues.push({
        code: 'invalid-entity',
        message: `Invalid legacy entity ${file.sourcePath}: ${validation.issues.map(
          function formatValidationIssue(issue) {
            return `${issue.path} ${issue.message}`;
          },
        ).join('; ')}`,
        sourcePaths: [file.sourcePath],
      });
      return {};
    }
    const entity = validation.entity;
    const claim = params.registry.getStorageClaim(entity.type);
    if (claim === undefined) {
      issues.push({
        code: 'missing-storage-claim',
        message: `No docs-native storage claim for ${entity.type}: ${file.sourcePath}`,
        sourcePaths: [file.sourcePath],
      });
      return {};
    }
    const targetDocumentPath = storageDocumentSourcePath(claim, entity.id);
    const targetPath = posix.join(documentsRootPath, targetDocumentPath);
    return {
      move: createMove('entity', file.sourcePath, targetPath, {
        id: entity.id,
        type: entity.type,
      }),
      document: {
        sourcePath: file.sourcePath,
        type: entity.type,
        id: entity.id,
        targetDocumentPath,
        content: raw.toString('utf-8'),
      },
    };
  } catch (error) {
    issues.push({
      code: 'invalid-entity',
      message: `Cannot migrate legacy entity ${file.sourcePath}: ${String(error)}`,
      sourcePaths: [file.sourcePath],
    });
    return {};
  }
}

function addOptionalFile(
  actions: DocsNativeMigrationAction[],
  legacyRoot: string,
  fs: DocsNativeMigrationFileSystem,
  sourcePath: string,
  targetPath: string,
  category: DocsNativeMigrationMove['category'],
): void {
  if (fs.exists(join(legacyRoot, ...sourcePath.split('/')))) {
    actions.push(createMove(category, sourcePath, targetPath));
  }
}

function addTreeMoves(
  actions: DocsNativeMigrationAction[],
  issues: DocsNativeMigrationIssue[],
  legacyRoot: string,
  sourceRootPath: string,
  targetRootPath: string,
  category: DocsNativeMigrationMove['category'],
  fs: DocsNativeMigrationFileSystem,
): void {
  const sourceRoot = join(legacyRoot, ...sourceRootPath.split('/'));
  for (const file of collectFiles(legacyRoot, sourceRoot, fs, issues)) {
    const nestedPath = toPosix(relative(sourceRoot, file.absolutePath));
    actions.push(createMove(
      category,
      file.sourcePath,
      posix.join(targetRootPath, nestedPath),
    ));
  }
}

function addProjectControlMoves(
  params: PlanDocsNativeMigrationParams,
  legacyRoot: string,
  controlRootPath: string,
  actions: DocsNativeMigrationAction[],
  issues: DocsNativeMigrationIssue[],
  fs: DocsNativeMigrationFileSystem,
): boolean {
  const targetControl = params.home.controlDir;
  if (fs.exists(legacyRoot) && fs.exists(targetControl)) {
    issues.push({
      code: 'ambiguous-control-layout',
      message: `Both project control directories exist; resolve them manually before migration: ${legacyRoot}, ${targetControl}`,
      sourcePaths: [
        rootRelativePath(params.home.root, legacyRoot),
        rootRelativePath(params.home.root, targetControl),
      ].sort(),
    });
    return false;
  }
  if (!fs.exists(legacyRoot)) return true;

  for (const file of collectFiles(legacyRoot, legacyRoot, fs, issues)) {
    if (
      file.sourcePath === 'config.json'
      || file.sourcePath === 'config.local.json'
    ) {
      continue;
    }
    if (file.sourcePath.startsWith('state/')) {
      actions.push(createMove(
        'legacy-state',
        file.sourcePath,
        posix.join(controlRootPath, file.sourcePath),
      ));
    } else if (!file.sourcePath.startsWith('cache/')) {
      issues.push({
        code: 'unsupported-source',
        message: `Project control migration only moves cache/, state/, config.json, and config.local.json; resolve ${posix.join(LEGACY_PROJECT_CONTROL_DIR, file.sourcePath)} manually`,
        sourcePaths: [posix.join(LEGACY_PROJECT_CONTROL_DIR, file.sourcePath)],
      });
    }
  }

  const legacyCache = join(legacyRoot, 'cache');
  if (fs.exists(legacyCache)) {
    actions.push({
      kind: 'discard',
      category: 'cache',
      root: 'legacy',
      path: 'cache',
    });
  }
  return true;
}

function addNestedGlobalControlMoves(
  legacyRoot: string,
  controlRootPath: string,
  actions: DocsNativeMigrationAction[],
  issues: DocsNativeMigrationIssue[],
  fs: DocsNativeMigrationFileSystem,
): void {
  const nestedControl = join(legacyRoot, LEGACY_PROJECT_CONTROL_DIR);
  if (!fs.exists(nestedControl)) return;

  for (const file of collectFiles(nestedControl, nestedControl, fs, issues)) {
    if (
      file.sourcePath === 'config.json'
      || file.sourcePath === 'config.local.json'
    ) {
      continue;
    }
    if (file.sourcePath.startsWith('state/')) {
      actions.push(createMove(
        'legacy-state',
        posix.join(LEGACY_PROJECT_CONTROL_DIR, file.sourcePath),
        posix.join(controlRootPath, file.sourcePath),
      ));
    } else if (!file.sourcePath.startsWith('cache/')) {
      issues.push({
        code: 'unsupported-source',
        message: `Nested global control migration only moves cache/, state/, and config files: ${posix.join(LEGACY_PROJECT_CONTROL_DIR, file.sourcePath)}`,
        sourcePaths: [posix.join(LEGACY_PROJECT_CONTROL_DIR, file.sourcePath)],
      });
    }
  }

  if (fs.exists(join(nestedControl, 'cache'))) {
    actions.push({
      kind: 'discard',
      category: 'cache',
      root: 'legacy',
      path: posix.join(LEGACY_PROJECT_CONTROL_DIR, 'cache'),
    });
  }
}

function configSourceAbsolute(
  source: DocsNativeMigrationConfigSource,
  legacyRoot: string,
  homeRoot: string,
): string {
  const root = source.root === 'legacy' ? legacyRoot : homeRoot;
  return join(root, ...source.path.split('/'));
}

function normalizedConfig(
  source: DocsNativeMigrationConfigSource,
  legacyRoot: string,
  homeRoot: string,
  fs: DocsNativeMigrationFileSystem,
  issues?: DocsNativeMigrationIssue[],
): Record<string, unknown> | undefined {
  const absolutePath = configSourceAbsolute(source, legacyRoot, homeRoot);
  try {
    const value = JSON.parse(fs.readFile(absolutePath).toString('utf-8')) as unknown;
    if (
      typeof value !== 'object'
      || value === null
      || Array.isArray(value)
    ) {
      throw new Error('config must be a JSON object');
    }
    const config = { ...value } as Record<string, unknown>;
    if ('scope' in config && 'context' in config) {
      throw new Error('config declares both scope and context');
    }
    if ('scope' in config) {
      config.context = config.scope;
      delete config.scope;
    }
    return config;
  } catch (error) {
    issues?.push({
      code: 'invalid-config',
      message: `Cannot migrate config ${source.path}: ${String(error)}`,
      sourcePaths: [source.path],
    });
    return undefined;
  }
}

function addConfigAction(
  action: DocsNativeMigrationConfig,
  legacyRoot: string,
  homeRoot: string,
  fs: DocsNativeMigrationFileSystem,
  issues: DocsNativeMigrationIssue[],
  actions: DocsNativeMigrationAction[],
): void {
  const parsed = action.sources.map(function parseSource(source) {
    return normalizedConfig(source, legacyRoot, homeRoot, fs, issues);
  });
  if (parsed.some(function isInvalid(value) {
    return value === undefined;
  })) {
    return;
  }
  if (action.sources.length === 1) {
    const source = action.sources[0];
    if (source !== undefined) {
      const sourcePath = configSourceAbsolute(source, legacyRoot, homeRoot);
      const targetPath = join(homeRoot, ...action.targetPath.split('/'));
      if (sourcePath === targetPath) {
        const raw = JSON.parse(fs.readFile(sourcePath).toString('utf-8')) as
          Record<string, unknown>;
        if (!('scope' in raw)) return;
      }
    }
  }
  actions.push(action);
}

function addProjectConfigActions(
  homeRoot: string,
  legacyRoot: string,
  controlRootPath: string,
  fs: DocsNativeMigrationFileSystem,
  issues: DocsNativeMigrationIssue[],
  actions: DocsNativeMigrationAction[],
): void {
  const useLegacy = fs.exists(legacyRoot);
  const sourceRoot = useLegacy
    ? legacyRoot
    : join(homeRoot, ...controlRootPath.split('/'));
  const sourceKind = useLegacy ? 'legacy' : 'home';
  const sourcePrefix = useLegacy ? '' : controlRootPath;

  for (const name of ['config.json', 'config.local.json']) {
    if (!fs.exists(join(sourceRoot, name))) continue;
    addConfigAction({
      kind: 'config',
      category: 'config',
      sources: [{
        root: sourceKind,
        path: sourcePrefix === '' ? name : posix.join(sourcePrefix, name),
      }],
      targetPath: posix.join(controlRootPath, name),
    }, legacyRoot, homeRoot, fs, issues, actions);
  }
}

function addGlobalConfigAction(
  homeRoot: string,
  legacyRoot: string,
  fs: DocsNativeMigrationFileSystem,
  issues: DocsNativeMigrationIssue[],
  actions: DocsNativeMigrationAction[],
): void {
  const nestedPrefix = LEGACY_PROJECT_CONTROL_DIR;
  const nestedConfig = fs.exists(join(legacyRoot, nestedPrefix, 'config.json'));
  const nestedLocal = fs.exists(
    join(legacyRoot, nestedPrefix, 'config.local.json'),
  );
  const rootConfig = fs.exists(join(legacyRoot, 'config.json'));
  const rootLocal = fs.exists(join(legacyRoot, 'config.local.json'));

  if ((nestedConfig || nestedLocal) && (rootConfig || rootLocal)) {
    issues.push({
      code: 'ambiguous-control-layout',
      message: `Global config exists in both the home root and ${LEGACY_PROJECT_CONTROL_DIR}; resolve the two layouts manually`,
      sourcePaths: [
        ...(rootConfig ? ['config.json'] : []),
        ...(rootLocal ? ['config.local.json'] : []),
        ...(nestedConfig ? [`${nestedPrefix}/config.json`] : []),
        ...(nestedLocal ? [`${nestedPrefix}/config.local.json`] : []),
      ].sort(),
    });
    return;
  }

  const sources: DocsNativeMigrationConfigSource[] = [];
  if (nestedConfig) {
    sources.push({ root: 'legacy', path: `${nestedPrefix}/config.json` });
  }
  if (nestedLocal) {
    sources.push({ root: 'legacy', path: `${nestedPrefix}/config.local.json` });
  }
  if (rootConfig) sources.push({ root: 'legacy', path: 'config.json' });
  if (rootLocal) {
    sources.push({ root: 'legacy', path: 'config.local.json' });
  }
  if (sources.length === 0) return;

  addConfigAction({
    kind: 'config',
    category: 'config',
    sources,
    targetPath: 'config.json',
  }, legacyRoot, homeRoot, fs, issues, actions);
}

function addCollisionIssues(
  params: PlanDocsNativeMigrationParams,
  plannedDocuments: readonly PlannedEntityDocument[],
  issues: DocsNativeMigrationIssue[],
): void {
  const discovered = discoverDocuments({
    documentsDir: params.home.documentsDir,
  });
  const syntheticDocuments = plannedDocuments.map(function createDocument(document) {
    return {
      sourcePath: document.targetDocumentPath,
      absolutePath: join(
        params.home.documentsDir,
        ...document.targetDocumentPath.split('/'),
      ),
      format: 'markdown' as const,
      content: document.content,
      identity: parseDocumentIdentity({
        sourcePath: document.targetDocumentPath,
      }),
    };
  });
  const claims = claimSubstrateDocuments({
    homeKey: params.home.root,
    documents: [...discovered.documents, ...syntheticDocuments],
    substrates: params.registry.listSubstrates(),
  });

  for (const diagnostic of claims.diagnostics) {
    issues.push({
      code: 'identity-collision',
      message: `Docs-native ${diagnostic.type} identity ${diagnostic.semanticKey} collides across ${diagnostic.sourcePaths.join(', ')}`,
      sourcePaths: diagnostic.sourcePaths,
    });
  }
}

function addDestinationIssues(
  planRoot: string,
  legacyRoot: string,
  actions: readonly DocsNativeMigrationAction[],
  fs: DocsNativeMigrationFileSystem,
  issues: DocsNativeMigrationIssue[],
): void {
  const byTarget = new Map<string, DocsNativeMigrationMove[]>();
  for (const action of actions) {
    if (action.kind !== 'move') continue;
    const group = byTarget.get(action.targetPath) ?? [];
    group.push(action);
    byTarget.set(action.targetPath, group);
  }

  for (const [targetPath, group] of byTarget) {
    const sourcePaths = group.map(function getSourcePath(action) {
      return action.sourcePath;
    }).sort();
    if (group.length > 1) {
      issues.push({
        code: 'identity-collision',
        message: `Several legacy sources resolve to ${targetPath}: ${sourcePaths.join(', ')}`,
        sourcePaths,
        targetPath,
      });
    }
    if (fs.exists(join(planRoot, ...targetPath.split('/')))) {
      issues.push({
        code: 'destination-exists',
        message: `Docs-native migration destination already exists: ${targetPath}`,
        sourcePaths,
        targetPath,
      });
    }
  }

  for (const action of actions) {
    if (action.kind !== 'config') continue;
    const moveSources = byTarget.get(action.targetPath)?.map(
      function getMoveSource(move) {
        return move.sourcePath;
      },
    ) ?? [];
    if (moveSources.length > 0) {
      issues.push({
        code: 'identity-collision',
        message: `Config migration and legacy moves both resolve to ${action.targetPath}`,
        sourcePaths: [
          ...moveSources,
          ...action.sources.map(function getConfigSource(source) {
            return source.path;
          }),
        ].sort(),
        targetPath: action.targetPath,
      });
    }

    const target = join(planRoot, ...action.targetPath.split('/'));
    const targetIsSource = action.sources.some(function matchesTarget(source) {
      return configSourceAbsolute(source, legacyRoot, planRoot) === target;
    });
    if (fs.exists(target) && !targetIsSource) {
      issues.push({
        code: 'destination-exists',
        message: `Docs-native migration destination already exists: ${action.targetPath}`,
        sourcePaths: action.sources.map(function getSource(source) {
          return source.path;
        }).sort(),
        targetPath: action.targetPath,
      });
    }
  }
}

/** Build the complete deterministic migration plan without mutating disk. */
export function planDocsNativeMigration(
  params: PlanDocsNativeMigrationParams,
): DocsNativeMigrationPlan {
  const fs = fileSystem(params.fileSystem);
  const legacyRoot = resolve(
    params.legacyRoot
      ?? (params.home.kind === 'project'
        ? join(params.home.root, LEGACY_PROJECT_CONTROL_DIR)
        : params.home.root),
  );
  const homeRoot = resolve(params.home.root);
  const issues: DocsNativeMigrationIssue[] = [];
  const actions: DocsNativeMigrationAction[] = [];
  const plannedDocuments: PlannedEntityDocument[] = [];

  const documentsRootPath = rootRelativePath(homeRoot, params.home.documentsDir);
  const controlRootPath = rootRelativePath(homeRoot, params.home.controlDir);
  if (params.home.kind === 'project') {
    const unambiguous = addProjectControlMoves(
      params,
      legacyRoot,
      controlRootPath,
      actions,
      issues,
      fs,
    );
    if (unambiguous) {
      addProjectConfigActions(
        homeRoot,
        legacyRoot,
        controlRootPath,
        fs,
        issues,
        actions,
      );
    }
    addDestinationIssues(homeRoot, legacyRoot, actions, fs, issues);
    return {
      homeKind: params.home.kind,
      legacyRoot,
      homeRoot,
      actions: actions.sort(compareActions),
      issues: issues.sort(compareIssues),
    };
  }

  const tasksRoot = join(legacyRoot, 'tasks');
  for (const file of collectFiles(legacyRoot, tasksRoot, fs, issues)) {
    const planned = planEntity(
      file,
      { ...params, legacyRoot },
      fs,
      documentsRootPath,
      issues,
    );
    if (planned.move !== undefined) actions.push(planned.move);
    if (planned.document !== undefined) plannedDocuments.push(planned.document);
  }

  addTreeMoves(
    actions,
    issues,
    legacyRoot,
    'resources',
    posix.join(documentsRootPath, 'resources'),
    'resource',
    fs,
  );
  addTreeMoves(
    actions,
    issues,
    legacyRoot,
    '.internal',
    posix.join(controlRootPath, 'state', 'legacy-internal'),
    'legacy-state',
    fs,
  );
  const legacyOperations = actions.find(function isLegacyOperations(action) {
    return action.kind === 'move'
      && action.sourcePath === '.internal/operations.jsonl';
  });
  if (legacyOperations?.kind === 'move') {
    const index = actions.indexOf(legacyOperations);
    actions[index] = createMove(
      'operations',
      legacyOperations.sourcePath,
      posix.join(controlRootPath, 'state', 'operations.jsonl'),
    );
  }
  addTreeMoves(
    actions,
    issues,
    legacyRoot,
    'logs',
    posix.join(controlRootPath, 'state', 'logs'),
    'log',
    fs,
  );
  addOptionalFile(
    actions,
    legacyRoot,
    fs,
    'identity.md',
    posix.join(documentsRootPath, 'identity.md'),
    'identity',
  );
  addOptionalFile(
    actions,
    legacyRoot,
    fs,
    'memory-usage.jsonl',
    posix.join(controlRootPath, 'state', 'memory-usage.jsonl'),
    'usage',
  );
  addNestedGlobalControlMoves(
    legacyRoot,
    controlRootPath,
    actions,
    issues,
    fs,
  );
  addGlobalConfigAction(
    homeRoot,
    legacyRoot,
    fs,
    issues,
    actions,
  );

  if (fs.exists(join(legacyRoot, '.cache'))) {
    actions.push({
      kind: 'discard',
      category: 'cache',
      root: 'legacy',
      path: '.cache',
    });
  }
  const homeCachePath = posix.join(controlRootPath, 'cache');
  const absoluteHomeCache = join(homeRoot, ...homeCachePath.split('/'));
  if (
    fs.exists(absoluteHomeCache)
    && !(legacyRoot === homeRoot && homeCachePath === '.cache')
  ) {
    actions.push({
      kind: 'discard',
      category: 'cache',
      root: 'home',
      path: homeCachePath,
    });
  }

  addCollisionIssues(params, plannedDocuments, issues);
  addDestinationIssues(homeRoot, legacyRoot, actions, fs, issues);

  return {
    homeKind: params.home.kind,
    legacyRoot,
    homeRoot,
    actions: actions.sort(compareActions),
    issues: issues.sort(compareIssues),
  };
}

function missingDirectories(
  path: string,
  stopAt: string,
  fs: DocsNativeMigrationFileSystem,
): string[] {
  const directories: string[] = [];
  let current = path;
  while (current !== stopAt && !fs.exists(current)) {
    directories.push(current);
    current = dirname(current);
  }
  return directories;
}

function cleanupCreatedTargets(
  targets: readonly string[],
  directories: readonly string[],
  fs: DocsNativeMigrationFileSystem,
): void {
  for (const target of [...targets].reverse()) {
    try {
      fs.unlink(target);
    } catch {
      // Best effort: the error that caused rollback remains primary.
    }
  }
  for (const directory of [...directories].sort(function deepestFirst(left, right) {
    return right.length - left.length;
  })) {
    fs.removeEmptyDirectory(directory);
  }
}

function renderConfig(
  action: DocsNativeMigrationConfig,
  plan: DocsNativeMigrationPlan,
  fs: DocsNativeMigrationFileSystem,
): Buffer {
  let merged: Record<string, unknown> = {};
  for (const source of action.sources) {
    const config = normalizedConfig(
      source,
      plan.legacyRoot,
      plan.homeRoot,
      fs,
    );
    if (config === undefined) {
      throw new Error(`Config changed before migration: ${source.path}`);
    }
    merged = { ...merged, ...config };
  }
  return Buffer.from(`${JSON.stringify(merged, null, 2)}\n`);
}

function executePlan(
  plan: DocsNativeMigrationPlan,
  fs: DocsNativeMigrationFileSystem,
): DocsNativeMigrationReport {
  if (plan.issues.length > 0) throw new DocsNativeMigrationError(plan.issues);
  const moves = plan.actions.filter(
    (action): action is DocsNativeMigrationMove => action.kind === 'move',
  );
  const configs = plan.actions.filter(
    (action): action is DocsNativeMigrationConfig => action.kind === 'config',
  );

  for (const move of moves) {
    const source = join(plan.legacyRoot, ...move.sourcePath.split('/'));
    const target = join(plan.homeRoot, ...move.targetPath.split('/'));
    if (!fs.exists(source)) {
      throw new Error(`Legacy migration source changed before execution: ${move.sourcePath}`);
    }
    if (fs.exists(target)) {
      throw new Error(`Docs-native migration destination changed before execution: ${move.targetPath}`);
    }
  }
  for (const config of configs) {
    const target = join(plan.homeRoot, ...config.targetPath.split('/'));
    for (const source of config.sources) {
      if (!fs.exists(configSourceAbsolute(
        source,
        plan.legacyRoot,
        plan.homeRoot,
      ))) {
        throw new Error(`Config source changed before execution: ${source.path}`);
      }
    }
    const targetIsSource = config.sources.some(function matchesTarget(source) {
      return configSourceAbsolute(
        source,
        plan.legacyRoot,
        plan.homeRoot,
      ) === target;
    });
    if (fs.exists(target) && !targetIsSource) {
      throw new Error(`Config destination changed before execution: ${config.targetPath}`);
    }
  }

  const createdTargets: string[] = [];
  const createdDirectories = new Set<string>();
  const overwrittenTargets = new Map<string, Buffer>();
  try {
    for (const move of moves) {
      const source = join(plan.legacyRoot, ...move.sourcePath.split('/'));
      const target = join(plan.homeRoot, ...move.targetPath.split('/'));
      const parent = dirname(target);
      for (const directory of missingDirectories(parent, plan.homeRoot, fs)) {
        createdDirectories.add(directory);
      }
      fs.makeDirectory(parent);
      fs.writeFileExclusive(target, fs.readFile(source));
      createdTargets.push(target);
    }
    for (const config of configs) {
      const target = join(plan.homeRoot, ...config.targetPath.split('/'));
      const parent = dirname(target);
      for (const directory of missingDirectories(parent, plan.homeRoot, fs)) {
        createdDirectories.add(directory);
      }
      fs.makeDirectory(parent);
      const content = renderConfig(config, plan, fs);
      if (fs.exists(target)) {
        overwrittenTargets.set(target, fs.readFile(target));
        fs.writeFile(target, content);
      } else {
        fs.writeFileExclusive(target, content);
        createdTargets.push(target);
      }
    }
  } catch (error) {
    for (const [target, content] of overwrittenTargets) {
      try {
        fs.writeFile(target, content);
      } catch {
        // Best effort: the error that caused rollback remains primary.
      }
    }
    cleanupCreatedTargets(
      createdTargets,
      [...createdDirectories],
      fs,
    );
    throw error;
  }

  for (const move of moves) {
    fs.unlink(join(plan.legacyRoot, ...move.sourcePath.split('/')));
  }
  let movedConfigs = 0;
  for (const config of configs) {
    const target = join(plan.homeRoot, ...config.targetPath.split('/'));
    for (const source of config.sources) {
      const absoluteSource = configSourceAbsolute(
        source,
        plan.legacyRoot,
        plan.homeRoot,
      );
      if (absoluteSource !== target) {
        fs.unlink(absoluteSource);
        movedConfigs += 1;
      }
    }
  }
  if (plan.homeKind === 'project') {
    fs.removeTree(plan.legacyRoot);
  } else {
    for (const directory of [
      'tasks',
      'resources',
      '.internal',
      'logs',
      LEGACY_PROJECT_CONTROL_DIR,
    ]) {
      fs.removeTree(join(plan.legacyRoot, directory));
    }
  }

  const discards = plan.actions.filter(function isDiscard(action) {
    return action.kind === 'discard';
  });
  for (const discard of discards) {
    const root = discard.root === 'legacy' ? plan.legacyRoot : plan.homeRoot;
    fs.removeTree(join(root, ...discard.path.split('/')));
  }

  return {
    dryRun: false,
    actions: plan.actions,
    moved: moves.length + movedConfigs,
    rewritten: configs.length,
    discarded: discards.length,
  };
}

/** Plan and optionally execute the one-shot global docs-native migration. */
export function migrateDocsNative(
  params: MigrateDocsNativeParams,
): DocsNativeMigrationReport {
  const plan = planDocsNativeMigration(params);
  if (plan.issues.length > 0) throw new DocsNativeMigrationError(plan.issues);
  if (params.dryRun) {
    return {
      dryRun: true,
      actions: plan.actions,
      moved: 0,
      rewritten: 0,
      discarded: 0,
    };
  }
  return executePlan(plan, fileSystem(params.fileSystem));
}
