import {
  BacklogHomeResolutionError,
  resolveBacklogHome,
} from '../core/backlog-home.js';
import type { BacklogHomeSelector } from '../core/backlog-home.types.js';
import { resolveGitFamily } from '../storage/local/git-family.js';
import { LocalRuntimeRegistry } from '../storage/local/local-runtime-registry.js';
import type { LocalRuntime } from '../storage/local/local-runtime.js';
import type {
  LocalRuntimeRequestResolverOptions,
  LocalRuntimeRequestSelection,
  ValidatedLocalRuntimeSelection,
} from './local-runtime-request-resolver.types.js';

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseHomeSelector(value: string | undefined): BacklogHomeSelector | undefined {
  const selected = clean(value);
  if (selected === undefined) return undefined;
  if (selected === 'global' || selected === 'project') return selected;
  throw new BacklogHomeResolutionError(
    `Invalid backlog home "${selected}"; expected "global" or "project"`,
  );
}

/**
 * Validate one transport request without consulting the detached server's cwd
 * or process environment. A missing request selection safely means global.
 */
export function validateLocalRuntimeSelection(
  selection: LocalRuntimeRequestSelection = {},
): ValidatedLocalRuntimeSelection {
  const selectedHome = parseHomeSelector(selection.home);
  const projectRoot = clean(selection.projectRoot);

  if (selectedHome === 'global' && projectRoot !== undefined) {
    throw new BacklogHomeResolutionError(
      'Project root cannot be combined with home "global"',
    );
  }
  if (selectedHome === 'project' && projectRoot === undefined) {
    throw new BacklogHomeResolutionError(
      'Project home requires an explicit project root',
    );
  }

  return {
    home: selectedHome ?? (projectRoot === undefined ? 'global' : 'project'),
    ...(projectRoot === undefined ? {} : { projectRoot }),
  };
}

/**
 * Resolve and lazily start the per-home runtime selected by one request.
 *
 * The detached server process is deliberately not a source of caller context:
 * request headers/query parameters must carry project selection explicitly.
 */
export class LocalRuntimeRequestResolver {
  constructor(
    private readonly registry: LocalRuntimeRegistry,
    private readonly options: LocalRuntimeRequestResolverOptions = {},
  ) {}

  async resolve(
    selection: LocalRuntimeRequestSelection = {},
  ): Promise<LocalRuntime> {
    const validated = validateLocalRuntimeSelection(selection);
    const home = resolveBacklogHome({
      home: validated.home,
      projectRoot: validated.projectRoot,
      globalRoot: this.options.globalRoot,
      env: {},
      // Family awareness (LATTICE W1): a request selecting a linked-
      // worktree project root resolves a family-aware home; everyone
      // else is unchanged.
      deps: { resolveFamily: resolveGitFamily },
    });
    return this.registry.get(home);
  }
}
