import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { OramaSearchService } from '@backlog-mcp/memory/search';
import type { MemoryComposer } from '@backlog-mcp/memory';
import type { SubstrateType } from '@backlog-mcp/shared';
import type { BacklogHome } from '../../core/backlog-home.types.js';
import { assertDocsNativeMigrationComplete } from '../../core/migrate-docs-native.js';
import {
  type ProjectSubstrateRegistry,
  type SubstrateDefinitionDiagnostic,
} from '../../core/substrates/index.js';
import { RESERVED_TOOL_NAMES } from '../../server/tool-name-reservations.js';
import { LocalEventBus } from '../../events/local-event-bus.js';
import { BacklogMemoryStore } from '../../memory/backlog-memory-store.js';
import { createComposerForStore } from '../../memory/bootstrap.js';
import { MemoryUsageOverlay } from '../../memory/memory-usage-overlay.js';
import { MemoryUsageTracker } from '../../memory/usage-tracker.js';
import {
  createOperationLogger,
  type OperationLogger,
} from '../../operations/logger.js';
import { ResourceManager } from '../../resources/manager.js';
import { BacklogService } from './backlog-service.js';
import { BuiltinSubstrateStorageCatalog } from './builtin-substrate-storage-catalog.js';
import { DocsNativeFilesystemStorage } from './docs-native-filesystem-storage.js';
import type {
  DocsTreeWatcher,
  DocsTreeWatcherErrorCallback,
  DocsTreeWatcherSubscription,
} from './docs-tree-watcher.contract.js';
import type { LocalRuntimeDependencies } from './local-runtime.types.js';
import { loadHomeSubstrateRegistry } from './home-substrate-registry.js';
import { ParcelDocsTreeWatcher } from './parcel-docs-tree-watcher.js';
import { nextStorageDocumentId } from '../storage-identity.js';

const SEARCH_HALF_LIFE_DAYS = 30;
const MEMORY_USAGE_LOG = 'memory-usage.jsonl';

function createSearch(home: BacklogHome): OramaSearchService {
  return new OramaSearchService({
    cachePath: join(home.controlDir, 'cache', 'search-index.json'),
    halfLifeDays: SEARCH_HALF_LIFE_DAYS,
  });
}

function ensureRuntimeDirectories(home: BacklogHome): void {
  mkdirSync(home.documentsDir, { recursive: true });
  mkdirSync(home.controlDir, { recursive: true });
  if (home.kind === 'project') ensureProjectControlIgnores(home);
}

/**
 * Derived control paths the tool itself writes. BUG-0005 measured multi-MB
 * cache indexes AND state journals (operations/memory-usage JSONL) landing
 * as untracked project content — both must never surface in git status.
 */
const DERIVED_CONTROL_RULES = ['cache/', 'state/'] as const;

/**
 * Derived-state hygiene (EXP-1 BUG-0005 / B-1): the first read must not
 * leave `.backlog/` git-visible.
 *
 * - Absent file → create a tool-owned boundary that also ignores itself,
 *   so a zero-setup read leaves a clean `git status`. (A repo that WANTS
 *   the boundary tracked — like this one — simply commits it; ignore rules
 *   never affect tracked files.)
 * - Existing file → human-authored lines are preserved verbatim; only
 *   missing derived-state rules (cache/, state/) are appended, and a file
 *   that already covers them is left byte-identical. Never overwritten.
 */
function ensureProjectControlIgnores(home: BacklogHome): void {
  const gitignorePath = join(home.controlDir, '.gitignore');
  if (!existsSync(gitignorePath)) {
    appendFileSync(
      gitignorePath,
      `.gitignore\nconfig.local.json\n${DERIVED_CONTROL_RULES.join('\n')}\n`,
    );
    return;
  }

  const content = readFileSync(gitignorePath, 'utf-8');
  const lines = content.split(/\r?\n/u);
  const missing = DERIVED_CONTROL_RULES.filter(rule => !lines.includes(rule));
  if (missing.length === 0) return;
  appendFileSync(
    gitignorePath,
    `${content.endsWith('\n') || content === '' ? '' : '\n'}${missing.join('\n')}\n`,
  );
}

function usageLogPath(home: BacklogHome): string {
  return join(home.controlDir, 'state', MEMORY_USAGE_LOG);
}

function appendUsageLine(path: string, line: string): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${line}\n`);
  } catch {
    // Usage telemetry is derived and must never break a user operation.
  }
}

function readUsageLines(path: string): string[] {
  try {
    return readFileSync(path, 'utf-8')
      .split('\n')
      .filter(function isNonEmpty(line) {
        return line.trim().length > 0;
      });
  } catch {
    return [];
  }
}

/**
 * The complete local service graph for one canonical backlog home.
 *
 * Markdown under `home.documentsDir` remains authoritative. The watcher only
 * requests full reconciliation; it never applies event-level mutations.
 */
export class LocalRuntime {
  private subscription: DocsTreeWatcherSubscription | undefined;
  private startPromise: Promise<void> | undefined;
  private reconciliation: Promise<void> | undefined;
  private reconcilePending = false;
  private started = false;

  constructor(
    readonly home: BacklogHome,
    readonly storage: DocsNativeFilesystemStorage,
    readonly search: OramaSearchService,
    readonly resourceManager: ResourceManager,
    readonly service: BacklogService,
    readonly operationLogger: OperationLogger,
    readonly eventBus: LocalEventBus,
    readonly memoryStore: BacklogMemoryStore,
    readonly memoryComposer: MemoryComposer,
    readonly substrateRegistry: ProjectSubstrateRegistry,
    readonly substrateDiagnostics: readonly SubstrateDefinitionDiagnostic[],
    readonly usageTracker: MemoryUsageTracker,
    readonly readUsageLines: () => string[],
    private readonly watcher: DocsTreeWatcher,
    private readonly onWatcherError?: DocsTreeWatcherErrorCallback,
  ) {}

  /** Subscribe before the initial full reconciliation so startup changes queue. */
  async start(): Promise<void> {
    if (this.started) return;
    if (this.startPromise !== undefined) {
      await this.startPromise;
      return;
    }

    const startPromise = this.startOnce();
    this.startPromise = startPromise;
    try {
      await startPromise;
    } finally {
      if (this.startPromise === startPromise) {
        this.startPromise = undefined;
      }
    }
  }

  /**
   * Request a full docs-tree reconciliation.
   *
   * Bursts collapse into one pending pass while preserving a final pass for
   * changes that arrive during an in-flight reconciliation.
   */
  async reconcile(): Promise<void> {
    this.reconcilePending = true;
    if (this.reconciliation !== undefined) {
      await this.reconciliation;
      return;
    }

    const reconciliation = this.drainReconciliation();
    this.reconciliation = reconciliation;
    try {
      await reconciliation;
    } finally {
      if (this.reconciliation === reconciliation) {
        this.reconciliation = undefined;
      }
    }
  }

  /** Stop watching and flush this home's derived search cache. */
  async stop(): Promise<void> {
    if (this.startPromise !== undefined) {
      await this.startPromise;
    }

    const subscription = this.subscription;
    this.subscription = undefined;
    this.started = false;
    if (subscription !== undefined) {
      await subscription.unsubscribe();
    }
    if (this.reconciliation !== undefined) {
      await this.reconciliation;
    }
    this.service.flush();
  }

  private async startOnce(): Promise<void> {
    ensureRuntimeDirectories(this.home);
    const subscription = await this.watcher.subscribe(
      this.home.documentsDir,
      this.requestWatcherReconciliation,
      this.onWatcherError,
    );
    this.subscription = subscription;

    try {
      await this.reconcile();
      this.started = true;
    } catch (error) {
      this.subscription = undefined;
      await subscription.unsubscribe();
      throw error;
    }
  }

  private readonly requestWatcherReconciliation = (): Promise<void> => {
    return this.reconcile();
  };

  private async drainReconciliation(): Promise<void> {
    while (this.reconcilePending) {
      this.reconcilePending = false;
      await this.service.reconcile();
    }
  }
}

/** Construct, but do not start, one isolated docs-native local runtime. */
export function createLocalRuntime(
  home: BacklogHome,
  deps: LocalRuntimeDependencies = {},
): LocalRuntime {
  const catalog = deps.catalog ?? new BuiltinSubstrateStorageCatalog();
  assertDocsNativeMigrationComplete(home, {
    legacyRoot: deps.legacyRoot,
  });
  ensureRuntimeDirectories(home);
  const definitions = loadHomeSubstrateRegistry(
    home,
    catalog,
    RESERVED_TOOL_NAMES,
  );
  const substrateRegistry = definitions.registry;
  const storage = new DocsNativeFilesystemStorage(home, substrateRegistry);
  const search = deps.createSearch?.(home) ?? createSearch(home);
  // Root-anchored catalog (first-impression charter, Slice A): resource
  // IDs/paths are home-root-relative so repo-root orientation files
  // (README.md, AGENTS.md, the vision doc) hydrate by the same address
  // as everything under the documents directory.
  const resourceManager = new ResourceManager(home.root, home.documentsDir);
  function allocateId(type: SubstrateType, currentMaxId: number): string {
    return nextStorageDocumentId(substrateRegistry, type, currentMaxId);
  }
  const service = new BacklogService({
    storage,
    search,
    resourceManager,
    getSearchFields: substrateRegistry.getSearchFields.bind(substrateRegistry),
    allocateId,
    listDisclosureRelations:
      substrateRegistry.listDisclosureRelations.bind(substrateRegistry),
    listWakeupDisclosures: function listWakeupDisclosures() {
      // Deterministic: listSubstrates is sourcePath-sorted; only substrates
      // declaring a wakeup disclosure appear.
      return substrateRegistry.listSubstrates().flatMap(function toSection(substrate) {
        const wakeup = substrateRegistry.getDisclosure(substrate.storageClaim.type)?.wakeup;
        return wakeup === undefined
          ? []
          : [{ type: substrate.storageClaim.type, wakeup }];
      });
    },
  });
  const operationLogger = createOperationLogger(
    join(home.controlDir, 'state', 'operations.jsonl'),
  );
  const eventBus = new LocalEventBus();
  function getRuntimeService(): BacklogService {
    return service;
  }
  const usageOverlay = home.kind === 'project'
    ? new MemoryUsageOverlay(home.controlDir)
    : undefined;
  const memoryStore = new BacklogMemoryStore(
    getRuntimeService,
    usageOverlay,
  );
  const memoryComposer = createComposerForStore(memoryStore);
  const runtimeUsagePath = usageLogPath(home);
  const usageTracker = new MemoryUsageTracker({
    getService: getRuntimeService,
    appendLine: usageOverlay === undefined
      ? function appendGlobalUsage(line) {
        appendUsageLine(runtimeUsagePath, line);
      }
      : function appendProjectUsage(line) {
        usageOverlay.appendLine(line);
      },
    ...(usageOverlay === undefined
      ? {}
      : { summaryStore: usageOverlay }),
  });
  const runtimeReadUsageLines = usageOverlay === undefined
    ? function readGlobalUsage(): string[] {
      return readUsageLines(runtimeUsagePath);
    }
    : function readProjectUsage(): string[] {
      return usageOverlay.readLines();
    };

  return new LocalRuntime(
    home,
    storage,
    search,
    resourceManager,
    service,
    operationLogger,
    eventBus,
    memoryStore,
    memoryComposer,
    substrateRegistry,
    definitions.diagnostics,
    usageTracker,
    runtimeReadUsageLines,
    deps.watcher ?? new ParcelDocsTreeWatcher(),
    deps.onWatcherError,
  );
}
