import type { Hono } from 'hono';
import type { LocalRuntimeRegistry } from '../storage/local/local-runtime-registry.js';

/** Vite app graph with explicit ownership of its per-home runtimes. */
export interface DevAppComposition {
  app: Hono;
  registry: LocalRuntimeRegistry;
  close(): Promise<void>;
}
