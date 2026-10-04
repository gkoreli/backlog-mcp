import { isDeepStrictEqual } from 'node:util';
import type { BacklogHome } from '../../core/backlog-home.types.js';
import { createLocalRuntime, type LocalRuntime } from './local-runtime.js';
import type { LocalRuntimeFactory } from './local-runtime-registry.types.js';

interface RuntimeEntry {
  home: BacklogHome;
  creation: Promise<LocalRuntime>;
  closing?: Promise<boolean>;
  closeFailed?: boolean;
}

/** Admission during shutdown is rejected; callers may retry after successful retirement. */
export class LocalRuntimeDrainingError extends Error {
  constructor(readonly root: string) {
    super(`Local runtime is draining or failed to stop: ${root}. Finish closing it before requesting a replacement.`);
    this.name = 'LocalRuntimeDrainingError';
  }
}

/** One canonical root cannot silently reuse another document/control configuration. */
export class LocalRuntimeConfigurationError extends Error {
  constructor(readonly root: string) {
    super(`Local runtime configuration differs for ${root}. Close the existing runtime before selecting different document or control paths.`);
    this.name = 'LocalRuntimeConfigurationError';
  }
}

/** Lazily owns one started graph per root, retaining admission guards throughout shutdown. */
export class LocalRuntimeRegistry {
  private readonly runtimes = new Map<string, RuntimeEntry>();
  private closingAll: Promise<void> | undefined;

  constructor(private readonly factory: LocalRuntimeFactory = createLocalRuntime) {}

  /** Share creation; reject draining roots and incompatible descriptors without creating a graph. */
  get(home: BacklogHome): Promise<LocalRuntime> {
    const existing = this.runtimes.get(home.root);
    if (this.closingAll !== undefined || existing?.closing !== undefined || existing?.closeFailed === true) {
      return Promise.reject(new LocalRuntimeDrainingError(home.root));
    }
    if (existing !== undefined) {
      if (!compatibleHome(existing.home, home)) return Promise.reject(new LocalRuntimeConfigurationError(home.root));
      return existing.creation;
    }
    const creation = this.createStartedRuntime(home);
    const entry: RuntimeEntry = { home: { ...home, ...(home.family === undefined ? {} : { family: { ...home.family } }) }, creation };
    this.runtimes.set(home.root, entry);
    const runtimes = this.runtimes;
    void creation.catch(function evictFailedCreation() {
      if (runtimes.get(home.root) === entry) runtimes.delete(home.root);
    });
    return creation;
  }

  /** Concurrent closes share retirement. Failed stops keep the root blocked, and can be retried. */
  close(home: BacklogHome): Promise<boolean> {
    const entry = this.runtimes.get(home.root);
    if (entry === undefined) return Promise.resolve(false);
    if (entry.closing !== undefined) return entry.closing;
    const closing = this.stopEntry(entry);
    entry.closing = closing;
    void closing.catch(function keepFailedRootBlocked() {
      entry.closeFailed = true;
      entry.closing = undefined;
    });
    return closing;
  }

  /** Reject all admission while draining; still attempt every root when one stop fails. */
  closeAll(): Promise<void> {
    if (this.closingAll !== undefined) return this.closingAll;
    const closing = this.drainAll();
    this.closingAll = closing;
    const registry = this;
    void closing.then(function reopened() { registry.closingAll = undefined; }, function failed() { registry.closingAll = undefined; });
    return closing;
  }

  private async drainAll(): Promise<void> {
    const entries = [...this.runtimes.values()].sort(function compareRoots(left, right) {
      return left.home.root < right.home.root ? -1 : left.home.root > right.home.root ? 1 : 0;
    });
    let firstFailure: unknown;
    let failed = false;
    for (const entry of entries) {
      try { await this.close(entry.home); }
      catch (error) { if (!failed) { firstFailure = error; failed = true; } }
    }
    if (failed) throw firstFailure;
  }

  private async stopEntry(entry: RuntimeEntry): Promise<boolean> {
    const runtime = await entry.creation;
    await runtime.stop();
    if (this.runtimes.get(entry.home.root) === entry) this.runtimes.delete(entry.home.root);
    return true;
  }

  private async createStartedRuntime(home: BacklogHome): Promise<LocalRuntime> {
    const runtime = this.factory(home);
    await runtime.start();
    return runtime;
  }
}

function compatibleHome(left: BacklogHome, right: BacklogHome): boolean {
  return left.kind === right.kind && left.id === right.id
    && left.documentsDir === right.documentsDir && left.controlDir === right.controlDir && isDeepStrictEqual(left.family, right.family);
}
