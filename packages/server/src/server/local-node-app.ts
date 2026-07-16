import { resolveBacklogHome } from '../core/backlog-home.js';
import { createLocalRuntime } from '../storage/local/local-runtime.js';
import { LocalRuntimeRegistry } from '../storage/local/local-runtime-registry.js';
import { resolveLegacyDataRoot } from '../utils/legacy-data-root.js';
import { createLocalAppRequestRuntime } from './local-app-request-runtime.js';
import { LocalRuntimeRequestResolver } from './local-runtime-request-resolver.js';
import { createNodeApp } from './node-app.js';
import type {
  CreateLocalNodeAppOptions,
  LocalNodeAppComposition,
} from './local-node-app.types.js';

/**
 * Start the default global runtime and wire request-selected project homes.
 *
 * The detached server never consults its own cwd for caller context. Project
 * selection arrives on the request bridge and is resolved by the shared
 * process-owned registry.
 */
export async function createLocalNodeApp(
  options: CreateLocalNodeAppOptions = {},
): Promise<LocalNodeAppComposition> {
  const env = options.env ?? process.env;
  const legacyRoot = resolveLegacyDataRoot(env);
  const registry = options.registry
    ?? new LocalRuntimeRegistry(function createRuntime(home) {
      return createLocalRuntime(home, {
        ...(home.kind === 'global' && legacyRoot !== undefined
          ? { legacyRoot }
          : {}),
      });
    });
  const home = resolveBacklogHome({
    home: 'global',
    globalRoot: options.globalRoot,
    env: {},
  });
  const runtime = await registry.get(home);
  const requestResolver = new LocalRuntimeRequestResolver(registry, {
    globalRoot: home.root,
  });
  async function resolveRuntime(selection: {
    home?: string;
    projectRoot?: string;
  }) {
    return createLocalAppRequestRuntime(
      await requestResolver.resolve(selection),
    );
  }

  return {
    app: createNodeApp({
      runtime: createLocalAppRequestRuntime(runtime),
      resolveRuntime,
      requestShutdown: options.requestShutdown,
    }),
    home,
    runtime,
    registry,
  };
}
