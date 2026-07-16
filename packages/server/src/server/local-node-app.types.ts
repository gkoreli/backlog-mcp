import type { Hono } from 'hono';
import type { BacklogHome } from '../core/backlog-home.types.js';
import type { LocalRuntime } from '../storage/local/local-runtime.js';
import type { LocalRuntimeRegistry } from '../storage/local/local-runtime-registry.js';

export interface CreateLocalNodeAppOptions {
  env?: Readonly<Record<string, string | undefined>>;
  globalRoot?: string;
  registry?: LocalRuntimeRegistry;
  requestShutdown?: () => void | Promise<void>;
}

/** Process-owned production app graph and its default global runtime. */
export interface LocalNodeAppComposition {
  app: Hono;
  home: BacklogHome;
  runtime: LocalRuntime;
  registry: LocalRuntimeRegistry;
}
