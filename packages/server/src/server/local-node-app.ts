import { resolveBacklogHome } from '../core/backlog-home.js';
import { createLocalRuntime } from '../storage/local/local-runtime.js';
import { LocalRuntimeRegistry } from '../storage/local/local-runtime-registry.js';
import { resolveLegacyDataRoot } from '../utils/legacy-data-root.js';
import { envActor } from '../operations/logger.js';
import { ambientAgentIdentity } from '../storage/local/agent-identity.js';
import {
  RecentHomesStore,
  defaultHomeLabel,
  recentHomesManifestPath,
} from '../storage/local/recent-homes-store.js';
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
  const bootDirectory = process.cwd();
  const bootIdentity = ambientAgentIdentity({ cwd: bootDirectory });
  const bootAppRuntime = {
    ...createLocalAppRequestRuntime(runtime),
    actor: envActor({ cwd: bootDirectory }),
    ...(bootIdentity === undefined ? {} : { agentIdentity: bootIdentity }),
  };
  const requestResolver = new LocalRuntimeRequestResolver(registry, {
    globalRoot: home.root,
  });
  // Recent-homes registry (ADR 0128): lives under the global home's gitignored
  // state dir. Recording is a side-effect of use at this composition boundary —
  // the same seam the CLI uses — so MCP and the viewer both populate it.
  const recentHomes = options.recentHomes
    ?? new RecentHomesStore(recentHomesManifestPath(home.controlDir));
  async function resolveRuntime(selection: {
    home?: string;
    projectRoot?: string;
  }) {
    if (selection.home === undefined && selection.projectRoot === undefined) {
      return bootAppRuntime;
    }
    const selectedRuntime = await requestResolver.resolve(selection);
    const selectedHome = selectedRuntime.home;
    // ADR 0128 R3: a resolved project home is "opened for work" — record it.
    // Global is the implicit always-present entry and is never recorded.
    if (selectedHome.kind === 'project') {
      recentHomes.recordProjectHome(
        selectedHome.root,
        defaultHomeLabel(selectedHome.root),
      );
    }
    const identityDirectory = selectedHome.root;
    const agentIdentity = ambientAgentIdentity({ cwd: identityDirectory });
    return {
      ...createLocalAppRequestRuntime(selectedRuntime),
      actor: envActor({ cwd: identityDirectory }),
      ...(agentIdentity === undefined ? {} : { agentIdentity }),
    };
  }

  return {
    app: createNodeApp({
      runtime: bootAppRuntime,
      resolveRuntime,
      requestShutdown: options.requestShutdown,
      recentHomes,
    }),
    home,
    runtime,
    registry,
  };
}
