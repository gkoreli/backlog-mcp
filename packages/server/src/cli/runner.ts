import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import type { BacklogEventType } from '../events/event-bus.js';
import {
  BacklogHomeResolutionError,
  resolveBacklogHome,
} from '../core/backlog-home.js';
import { NotFoundError, ValidationError } from '../core/types.js';
import { createHomeReadCoordinator } from '../core/home-read-coordinator.js';
import type {
  HomeReadCoordinator,
  HomeReadRuntime,
  HomeReadRuntimeSelection,
  HomeReadSelection,
} from '../core/home-read-coordinator.types.js';
import { envActor } from '../operations/logger.js';
import { createLocalAppRequestRuntime } from '../server/local-app-request-runtime.js';
import { validateLocalRuntimeSelection } from '../server/local-runtime-request-resolver.js';
import {
  createLocalRuntime,
  type LocalRuntime,
} from '../storage/local/local-runtime.js';
import { resolveLegacyDataRoot } from '../utils/legacy-data-root.js';
import { resolveContext } from '../core/config.js';
import type {
  CliRunnerDependencies,
  CliRuntime,
} from './runner.types.js';

const IDENTITY_FILENAME = 'identity.md';

function readIdentityFile(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const raw = readFileSync(path, 'utf-8').trim();
    return raw.length > 0 ? raw : undefined;
  } catch {
    return undefined;
  }
}

function isBacklogEventType(type: string): type is BacklogEventType {
  return type === 'task_changed'
    || type === 'task_created'
    || type === 'task_deleted'
    || type === 'resource_changed';
}

async function createDocsNativeCliRuntime(
  deps: CliRunnerDependencies,
): Promise<CliRuntime> {
  if (deps.home === 'all') {
    throw new BacklogHomeResolutionError(
      'CLI home "all" is read-only; use search, recall, or wakeup',
    );
  }
  const env = deps.env ?? process.env;
  const explicitSelection = deps.home === undefined
    && deps.projectRoot === undefined
    ? undefined
    : validateLocalRuntimeSelection({
      home: deps.home,
      projectRoot: deps.projectRoot,
    });
  const home = resolveBacklogHome({
    home: explicitSelection?.home,
    projectRoot: explicitSelection?.projectRoot,
    cwd: deps.cwd ?? process.cwd(),
    env,
  });
  const adaptLocalRuntime = deps.adaptLocalRuntime
    ?? createLocalAppRequestRuntime;
  const localRuntime: LocalRuntime = deps.createLocalRuntime?.(home)
    ?? createLocalRuntime(home, {
      ...(home.kind === 'global'
        ? { legacyRoot: resolveLegacyDataRoot(env) }
        : {}),
    });

  try {
    await localRuntime.start();
  } catch (error) {
    await localRuntime.stop();
    throw error;
  }

  const appRuntime = adaptLocalRuntime(localRuntime);
  const sourceResolver = appRuntime.resolveSourcePath;
  if (sourceResolver === undefined) {
    await localRuntime.stop();
    throw new Error('Docs-native CLI runtime has no source-path resolver');
  }
  const identityPath = appRuntime.identityPath;
  const visionPath = appRuntime.visionPath;
  const actor = deps.actor?.() ?? envActor();
  const scopeRoot = resolveContext({ home, env });

  return {
    home,
    service: appRuntime.service,
    writeContext: {
      actor,
      operationLog: localRuntime.operationLogger,
      substrateRegistry: localRuntime.substrateRegistry,
      ...(scopeRoot === undefined ? {} : { scopeRoot }),
      eventBus: {
        emit(event): void {
          if (!isBacklogEventType(event.type)) {
            throw new Error(`Unsupported backlog event type: ${event.type}`);
          }
          localRuntime.eventBus.emit({
            ...event,
            type: event.type,
          });
        },
      },
      memoryComposer: localRuntime.memoryComposer,
    },
    memoryComposer: localRuntime.memoryComposer,
    mintMemoryEntry: appRuntime.mintMemoryEntry,
    usageTracker: appRuntime.usageTracker,
    operationLogger: localRuntime.operationLogger,
    readUsageLines: appRuntime.readUsageLines,
    readIdentity: function readDocsNativeIdentity() {
      return identityPath === undefined
        ? undefined
        : readIdentityFile(identityPath);
    },
    readVision: function readDocsNativeVision() {
      return visionPath === undefined
        ? undefined
        : readIdentityFile(visionPath);
    },
    getSourcePath: appRuntime.getSourcePath,
    resolveSourcePath: sourceResolver,
    close: async function closeDocsNativeRuntime(): Promise<void> {
      await localRuntime.stop();
    },
  };
}

/** Select and construct the single runtime graph owned by this invocation. */
export async function createCliRuntime(
  deps: CliRunnerDependencies = {},
): Promise<CliRuntime> {
  if (deps.home === 'all') {
    throw new BacklogHomeResolutionError(
      'CLI home "all" is read-only; use search, recall, or wakeup',
    );
  }
  return createDocsNativeCliRuntime(deps);
}

/**
 * Read explicit home selection from the root CLI command.
 *
 * Home selection remains caller-scoped and separate from entity context.
 */
export function cliRuntimeDependencies(
  program: Pick<Command, 'opts'>,
): CliRunnerDependencies {
  const options = program.opts<{
    home?: string;
    projectRoot?: string;
  }>();
  let home: 'global' | 'project' | 'all' | undefined;
  if (
    options.home === 'global'
    || options.home === 'project'
    || options.home === 'all'
  ) {
    home = options.home;
  } else if (options.home !== undefined) {
    throw new BacklogHomeResolutionError(
      `Invalid backlog home "${options.home}"; expected "global", "project", or "all"`,
    );
  }

  return {
    ...(home === undefined ? {} : { home }),
    ...(options.projectRoot === undefined
      ? {}
      : { projectRoot: options.projectRoot }),
  };
}

function toHomeReadRuntime(runtime: CliRuntime): HomeReadRuntime {
  const home = runtime.home;
  if (home === undefined) {
    throw new Error('Cross-home CLI reads require a docs-native runtime');
  }
  return {
    home,
    service: runtime.service,
    memoryComposer: runtime.memoryComposer,
    usageTracker: runtime.usageTracker,
    getSourcePath: runtime.getSourcePath,
    readIdentity: runtime.readIdentity,
    acceptsParent: function acceptsParent(type) {
      return runtime.writeContext.substrateRegistry?.acceptsParent(type) === true;
    },
    readOperations: function readOperations(options) {
      return runtime.operationLogger.read(options);
    },
    mintMemoryEntry: runtime.mintMemoryEntry,
  };
}

function printResult<R>(
  value: R,
  format: (result: R) => string,
  json: boolean,
): void {
  console.log(
    json
      ? JSON.stringify(value, null, 2)
      : format(value),
  );
}

function throwRunError(error: unknown): never {
  if (error instanceof NotFoundError || error instanceof ValidationError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}

/**
 * Run one bounded global-plus-project read and close every acquired runtime.
 *
 * Missing projects are reported by the coordinator rather than preventing the
 * global home from serving.
 */
export async function runAcrossHomes<R>(
  handler: (
    coordinator: HomeReadCoordinator,
    selection: HomeReadSelection | undefined,
  ) => Promise<R>,
  format: (result: R) => string,
  json: boolean,
  deps: CliRunnerDependencies,
): Promise<void> {
  const env = deps.env ?? process.env;

  const {
    home: _home,
    projectRoot,
    ...runtimeDeps
  } = deps;
  const acquired: CliRuntime[] = [];
  async function resolveRuntime(
    selection: HomeReadRuntimeSelection,
  ): Promise<HomeReadRuntime> {
    const runtime = await createCliRuntime({
      ...runtimeDeps,
      env,
      home: selection.home,
      ...(selection.home === 'project'
        ? { projectRoot: selection.projectRoot }
        : {}),
    });
    acquired.push(runtime);
    return toHomeReadRuntime(runtime);
  }
  const coordinator = createHomeReadCoordinator({ resolveRuntime });
  const selection = projectRoot === undefined
    ? undefined
    : { projectRoot };

  let outcome:
    | { ok: true; value: R }
    | { ok: false; error: unknown };
  try {
    outcome = {
      ok: true,
      value: await handler(coordinator, selection),
    };
  } catch (error) {
    outcome = { ok: false, error };
  }

  const closeResults = await Promise.allSettled(
    acquired
      .sort(function compareRuntimes(left, right) {
        const leftId = left.home?.id ?? '';
        const rightId = right.home?.id ?? '';
        if (leftId < rightId) return -1;
        if (leftId > rightId) return 1;
        return 0;
      })
      .map(function closeRuntime(runtime) {
        return runtime.close();
      }),
  );
  if (outcome.ok) {
    const closeFailure = closeResults.find(function isCloseFailure(result) {
      return result.status === 'rejected';
    });
    if (closeFailure?.status === 'rejected') {
      outcome = { ok: false, error: closeFailure.reason };
    }
  }

  if (!outcome.ok) throwRunError(outcome.error);
  printResult(outcome.value, format, json);
}

export async function run<R>(
  handler: (runtime: CliRuntime) => Promise<R>,
  format: (result: R) => string,
  json: boolean,
  deps: CliRunnerDependencies = {},
): Promise<void> {
  let runtime: CliRuntime | undefined;
  let outcome:
    | { ok: true; value: R }
    | { ok: false; error: unknown }
    | undefined;

  try {
    runtime = await createCliRuntime(deps);
    outcome = {
      ok: true,
      value: await handler(runtime),
    };
  } catch (error) {
    outcome = { ok: false, error };
  } finally {
    if (runtime !== undefined) {
      try {
        await runtime.close();
      } catch (error) {
        if (outcome?.ok === true) {
          outcome = { ok: false, error };
        }
      }
    }
  }

  if (outcome === undefined) {
    throw new Error('CLI runtime completed without an outcome');
  }
  if (!outcome.ok) {
    throwRunError(outcome.error);
  }

  printResult(outcome.value, format, json);
}
