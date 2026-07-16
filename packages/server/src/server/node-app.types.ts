import type { AppRequestRuntimeResolver } from './app-request-runtime.types.js';

/** Construction options for the Node Hono application graph. */
export interface CreateNodeAppOptions {
  skipStatic?: boolean;
  resolveRuntime?: AppRequestRuntimeResolver;
}
