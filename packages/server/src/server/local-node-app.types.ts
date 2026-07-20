import type { Hono } from 'hono';
import type { BacklogHome } from '../core/backlog-home.types.js';
import type { LocalRuntime } from '../storage/local/local-runtime.js';
import type { LocalRuntimeRegistry } from '../storage/local/local-runtime-registry.js';
import type { RecentHomesStore } from '../storage/local/recent-homes-store.js';

export interface CreateLocalNodeAppOptions {
  env?: Readonly<Record<string, string | undefined>>;
  globalRoot?: string;
  registry?: LocalRuntimeRegistry;
  requestShutdown?: () => void | Promise<void>;
  /** Recent-homes registry (ADR 0128); defaults to a store under the global state dir. */
  recentHomes?: RecentHomesStore;
}

/** Process-owned production app graph and its default global runtime. */
export interface LocalNodeAppComposition {
  app: Hono;
  home: BacklogHome;
  runtime: LocalRuntime;
  registry: LocalRuntimeRegistry;
}
