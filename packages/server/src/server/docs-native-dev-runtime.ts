import type { LocalRuntime } from '../storage/local/local-runtime.js';
import { LocalRuntimeRegistry } from '../storage/local/local-runtime-registry.js';
import type {
  LocalRuntimeRequestSelection,
} from './local-runtime-request-resolver.types.js';
import { LocalRuntimeRequestResolver } from './local-runtime-request-resolver.js';
import { createLocalAppRequestRuntime } from './local-app-request-runtime.js';
import type {
  AppRequestRuntimeResolver,
} from './app-request-runtime.types.js';

export const BACKLOG_DOCS_NATIVE_ENV_VAR = 'BACKLOG_DOCS_NATIVE';

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Apply explicit process defaults only for the temporary Vite dev scaffold.
 * Request headers/query parameters always win and remain caller-scoped.
 */
export function applyDocsNativeDevDefaults(
  selection: LocalRuntimeRequestSelection,
  env: Readonly<Record<string, string | undefined>>,
): LocalRuntimeRequestSelection {
  if (selection.home !== undefined || selection.projectRoot !== undefined) {
    return selection;
  }

  const selectedHome = clean(env.BACKLOG_HOME);
  const projectRoot = clean(env.BACKLOG_PROJECT_ROOT);
  if (selectedHome !== undefined) {
    return {
      home: selectedHome,
      ...(projectRoot === undefined ? {} : { projectRoot }),
    };
  }
  if (projectRoot !== undefined) {
    return { home: 'project', projectRoot };
  }
  return {};
}

/**
 * Build the temporary docs-native resolver used only by the Vite dev entry.
 *
 * Phase E deletes this flag when migration and the default cutover ship
 * together; it is intentionally not a supported configuration surface.
 */
export function createDocsNativeDevRuntimeResolver(
  env: Readonly<Record<string, string | undefined>>,
  registry = new LocalRuntimeRegistry(),
): AppRequestRuntimeResolver | undefined {
  if (env[BACKLOG_DOCS_NATIVE_ENV_VAR] !== '1') return undefined;

  const localResolver = new LocalRuntimeRequestResolver(registry);
  return async function resolveRuntime(selection) {
    const runtime: LocalRuntime = await localResolver.resolve(
      applyDocsNativeDevDefaults(selection, env),
    );
    return createLocalAppRequestRuntime(runtime);
  };
}
