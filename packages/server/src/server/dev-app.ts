import { resolveBacklogHome } from '../core/backlog-home.js';
import { resolveGitFamily } from '../storage/local/git-family.js';
import { createLocalRuntime } from '../storage/local/local-runtime.js';
import { LocalRuntimeRegistry } from '../storage/local/local-runtime-registry.js';
import { resolveLegacyDataRoot } from '../utils/legacy-data-root.js';
import type { AppRequestRuntimeSelection } from './app-request-runtime.types.js';
import { createLocalAppRequestRuntime } from './local-app-request-runtime.js';
import { LocalRuntimeRequestResolver } from './local-runtime-request-resolver.js';
import { createNodeApp } from './node-app.js';
import type { DevAppComposition } from './dev-app.types.js';

/** Construct the Vite dev app with one process-owned per-home registry. */
export async function createDevApp(
  env: Readonly<Record<string, string | undefined>> = process.env,
  registry = new LocalRuntimeRegistry(function createRuntime(home) {
    return createLocalRuntime(home, {
      ...(home.kind === 'global'
        ? { legacyRoot: resolveLegacyDataRoot(env) }
        : {}),
    });
  }),
  cwd = process.cwd(),
): Promise<DevAppComposition> {
  const defaultHome = resolveBacklogHome({
    cwd,
    env,
    deps: { resolveFamily: resolveGitFamily },
  });
  const defaultSelection: AppRequestRuntimeSelection = defaultHome.kind === 'global'
    ? { home: 'global' }
    : { home: 'project', projectRoot: defaultHome.root };
  const localResolver = new LocalRuntimeRequestResolver(registry);
  async function resolveRuntime(selection: AppRequestRuntimeSelection) {
    const selected = selection.home === undefined
      && selection.projectRoot === undefined
      ? defaultSelection
      : selection;
    return createLocalAppRequestRuntime(
      await localResolver.resolve(selected),
    );
  }
  const runtime = createLocalAppRequestRuntime(
    await registry.get(defaultHome),
  );
  return {
    app: createNodeApp({
      runtime,
      skipStatic: true,
      resolveRuntime,
    }),
    registry,
    close: function close(): Promise<void> {
      return registry.closeAll();
    },
  };
}
