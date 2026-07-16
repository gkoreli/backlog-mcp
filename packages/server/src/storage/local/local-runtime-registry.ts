import type { BacklogHome } from '../../core/backlog-home.types.js';
import { createLocalRuntime, type LocalRuntime } from './local-runtime.js';
import type { LocalRuntimeFactory } from './local-runtime-registry.types.js';

/**
 * Lazily owns one started local runtime per canonical backlog-home root.
 */
export class LocalRuntimeRegistry {
  private readonly runtimes = new Map<string, Promise<LocalRuntime>>();

  constructor(
    private readonly factory: LocalRuntimeFactory = createLocalRuntime,
  ) {}

  /** Return the shared started runtime for one canonical backlog home. */
  get(home: BacklogHome): Promise<LocalRuntime> {
    const existing = this.runtimes.get(home.root);
    if (existing !== undefined) return existing;

    const creation = this.createStartedRuntime(home);
    this.runtimes.set(home.root, creation);

    const runtimes = this.runtimes;
    const root = home.root;
    function evictFailedCreation(): void {
      if (runtimes.get(root) === creation) {
        runtimes.delete(root);
      }
    }
    void creation.catch(evictFailedCreation);

    return creation;
  }

  /** Stop and remove the cached runtime for one home, if present. */
  async close(home: BacklogHome): Promise<boolean> {
    const creation = this.runtimes.get(home.root);
    if (creation === undefined) return false;

    this.runtimes.delete(home.root);
    const runtime = await creation;
    await runtime.stop();
    return true;
  }

  /** Stop every cached runtime in deterministic root-key order. */
  async closeAll(): Promise<void> {
    const entries = [...this.runtimes.entries()].sort(
      function compareRoots([left], [right]) {
        if (left < right) return -1;
        if (left > right) return 1;
        return 0;
      },
    );
    this.runtimes.clear();

    let firstFailure: unknown;
    let failed = false;
    for (const [, creation] of entries) {
      try {
        const runtime = await creation;
        await runtime.stop();
      } catch (error) {
        if (!failed) {
          firstFailure = error;
          failed = true;
        }
      }
    }

    if (failed) throw firstFailure;
  }

  private async createStartedRuntime(home: BacklogHome): Promise<LocalRuntime> {
    const runtime = this.factory(home);
    await runtime.start();
    return runtime;
  }
}
