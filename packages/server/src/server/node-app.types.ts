import type {
  AppRequestRuntime,
  AppRequestRuntimeResolver,
} from './app-request-runtime.types.js';

/** Construction options for the Node Hono application graph. */
export interface CreateNodeAppOptions {
  runtime: AppRequestRuntime;
  skipStatic?: boolean;
  resolveRuntime?: AppRequestRuntimeResolver;
  requestShutdown?: () => void | Promise<void>;
}
