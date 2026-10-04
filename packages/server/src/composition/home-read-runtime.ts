/** Select home-owned read capabilities for CLI/HTTP coordination (ADR 0136 R3). */
import type { HomeReadCoordinator, HomeReadRuntime } from '../core/home-read-coordinator.types.js';
import { createHomeReadCoordinator } from '../core/home-read-coordinator.js';
import type { AppRequestRuntimeResolver } from './app-request-runtime.types.js';

/** Composition facts, with optional local file and journal readers. */
export interface HomeReadRuntimeSource extends Omit<HomeReadRuntime, 'home'> {
  home?: HomeReadRuntime['home'];
  readLocalFile?: (path: string) => string | null;
  identityPath?: string;
  visionPath?: string;
  operationLogger?: { read: NonNullable<HomeReadRuntime['readOperations']> };
  substrateRegistry?: { acceptsParent: NonNullable<HomeReadRuntime['acceptsParent']> };
}

function textReader(source: HomeReadRuntimeSource, path: string | undefined): (() => string | undefined) | undefined {
  const read = source.readLocalFile;
  if (read === undefined || path === undefined) return undefined;
  return function readTrimmedDocument() {
    return read(path)?.trim() || undefined;
  };
}

/** Project capabilities, never actor/write authority, from one selected home. */
export function createHomeReadRuntime(source: HomeReadRuntimeSource): HomeReadRuntime {
  const home = source.home;
  if (home === undefined) throw new Error('Cross-home reads require a docs-native local runtime');
  const registry = source.substrateRegistry;
  const logger = source.operationLogger;
  return {
    home,
    service: source.service,
    memoryComposer: source.memoryComposer,
    usageTracker: source.usageTracker,
    getSourcePath: source.getSourcePath,
    readIdentity: source.readIdentity ?? textReader(source, source.identityPath),
    readVision: source.readVision ?? textReader(source, source.visionPath),
    readGrounding: source.readGrounding,
    readOperations: source.readOperations ?? (logger === undefined ? undefined : function readOperations(options) { return logger.read(options); }),
    acceptsParent: source.acceptsParent ?? (registry === undefined ? undefined : function acceptsParent(type) { return registry.acceptsParent(type); }),
    mintMemoryEntry: source.mintMemoryEntry,
  };
}

/** Bind a caller-selected project to one stateless coordinator; explicit selections win. */
export function createSelectedHomeReadCoordinator(resolveRuntime: AppRequestRuntimeResolver, projectRoot?: string): HomeReadCoordinator {
  const coordinator = createHomeReadCoordinator({
    resolveRuntime: async function resolveReadRuntime(selection) {
      return createHomeReadRuntime(await resolveRuntime(selection));
    },
  });
  const inherited = projectRoot === undefined ? undefined : { projectRoot };
  return {
    search: function search(params, selection) { return coordinator.search(params, selection ?? inherited); },
    recall: function recall(params, selection) { return coordinator.recall(params, selection ?? inherited); },
    wakeup: function wakeup(params, selection) { return coordinator.wakeup(params, selection ?? inherited); },
  };
}
