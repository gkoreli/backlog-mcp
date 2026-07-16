import {
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BacklogHomeResolutionError,
  createBacklogHome,
  discoverProjectRoot,
  isPathWithin,
  resolveBacklogHome,
} from '../core/backlog-home.js';
import type { BacklogHomeDeps } from '../core/backlog-home.types.js';

function pathDeps(homeDir = '/users/quartz'): BacklogHomeDeps {
  return {
    exists: existsSync,
    read: (path) => readFileSync(path, 'utf-8'),
    canonicalize: resolve,
    homeDir: () => homeDir,
  };
}

function writeRepoConfig(
  root: string,
  config: Record<string, unknown>,
): void {
  mkdirSync(`${root}/.backlog-mcp`, { recursive: true });
  writeFileSync(
    `${root}/.backlog-mcp/config.json`,
    JSON.stringify(config),
  );
}

describe('backlog home construction', () => {
  it('creates the default global home shape', () => {
    expect(resolveBacklogHome({
      cwd: '/outside-project',
      env: {},
      deps: pathDeps(),
    })).toEqual({
      kind: 'global',
      id: 'global',
      root: '/users/quartz/.backlog',
      documentsDir: '/users/quartz/.backlog/docs',
      controlDir: '/users/quartz/.backlog/.backlog-mcp',
    });
  });

  it('uses the canonical project root as project identity', () => {
    const deps: BacklogHomeDeps = {
      ...pathDeps(),
      canonicalize(path) {
        return resolve(path).replace('/project-link', '/physical/project');
      },
    };

    expect(createBacklogHome({
      kind: 'project',
      root: '/project-link',
    }, deps)).toEqual({
      kind: 'project',
      id: '/physical/project',
      root: '/physical/project',
      documentsDir: '/physical/project/docs',
      controlDir: '/physical/project/.backlog-mcp',
    });
  });

  it('rejects a canonical documents path that escapes the home root', () => {
    mkdirSync('/containment/repo/docs', { recursive: true });
    mkdirSync('/containment/external', { recursive: true });
    symlinkSync('/containment/external', '/containment/repo/escaped-docs');

    expect(() => createBacklogHome({
      kind: 'project',
      root: '/containment/repo',
      documentsDir: 'escaped-docs',
    })).toThrow(BacklogHomeResolutionError);
  });
});

describe('isPathWithin', () => {
  it('accepts the root and descendants but rejects siblings', () => {
    expect(isPathWithin('/repo', '/repo')).toBe(true);
    expect(isPathWithin('/repo', '/repo/docs/adr')).toBe(true);
    expect(isPathWithin('/repo', '/repo-other/docs')).toBe(false);
    expect(isPathWithin('/repo', '/repo/../outside')).toBe(false);
  });

  it('does not mistake a child beginning with two dots for traversal', () => {
    expect(isPathWithin('/repo', '/repo/..notes')).toBe(true);
  });
});

describe('discoverProjectRoot', () => {
  it('returns the nearest config marker', () => {
    mkdirSync('/discovery/config-root/.backlog-mcp', { recursive: true });
    mkdirSync('/discovery/config-root/packages/app/.backlog-mcp', { recursive: true });
    mkdirSync('/discovery/config-root/packages/app/src', { recursive: true });

    expect(discoverProjectRoot({
      startDir: '/discovery/config-root/packages/app/src',
      deps: pathDeps(),
    })).toBe('/discovery/config-root/packages/app');
  });

  it('does not cross the nearest VCS boundary for enclosing config', () => {
    mkdirSync('/discovery/config-priority/.backlog-mcp', { recursive: true });
    mkdirSync('/discovery/config-priority/packages/app/.git', { recursive: true });
    mkdirSync('/discovery/config-priority/packages/app/src', { recursive: true });

    expect(discoverProjectRoot({
      startDir: '/discovery/config-priority/packages/app/src',
      deps: pathDeps(),
    })).toBe('/discovery/config-priority/packages/app');
  });

  it('falls back to the nearest VCS marker', () => {
    mkdirSync('/discovery/vcs-root/.git', { recursive: true });
    mkdirSync('/discovery/vcs-root/packages/app/src', { recursive: true });

    expect(discoverProjectRoot({
      startDir: '/discovery/vcs-root/packages/app/src',
      deps: pathDeps(),
    })).toBe('/discovery/vcs-root');
  });

  it('includes stopDir but never walks above it', () => {
    mkdirSync('/discovery/bounded/.git', { recursive: true });
    mkdirSync('/discovery/bounded/apps/inside/.backlog-mcp', { recursive: true });
    mkdirSync('/discovery/bounded/apps/inside/src', { recursive: true });
    mkdirSync('/discovery/bounded/apps/outside/src', { recursive: true });

    expect(discoverProjectRoot({
      startDir: '/discovery/bounded/apps/inside/src',
      stopDir: '/discovery/bounded/apps/inside',
      deps: pathDeps(),
    })).toBe('/discovery/bounded/apps/inside');

    expect(discoverProjectRoot({
      startDir: '/discovery/bounded/apps/outside/src',
      stopDir: '/discovery/bounded/apps',
      deps: pathDeps(),
    })).toBeUndefined();
  });

  it('returns no boundary when the start is outside stopDir', () => {
    mkdirSync('/discovery/outside/.git', { recursive: true });

    expect(discoverProjectRoot({
      startDir: '/discovery/outside',
      stopDir: '/different-boundary',
      deps: pathDeps(),
    })).toBeUndefined();
  });
});

describe('resolveBacklogHome precedence', () => {
  it('lets an explicit project root beat caller environment and discovery', () => {
    mkdirSync('/resolution/discovered/.git', { recursive: true });
    mkdirSync('/resolution/discovered/docs', { recursive: true });
    mkdirSync('/resolution/discovered/packages/app', { recursive: true });
    writeRepoConfig('/resolution/explicit', {
      documentsDir: 'explicit-docs',
    });

    const home = resolveBacklogHome({
      projectRoot: '/resolution/explicit',
      cwd: '/resolution/discovered/packages/app',
      env: {
        BACKLOG_HOME: 'global',
        BACKLOG_PROJECT_ROOT: '/resolution/environment',
      },
      deps: pathDeps(),
    });

    expect(home.kind).toBe('project');
    expect(home.root).toBe('/resolution/explicit');
    expect(home.documentsDir).toBe('/resolution/explicit/explicit-docs');
  });

  it('lets an explicit home selection beat caller environment', () => {
    const home = resolveBacklogHome({
      home: 'global',
      env: { BACKLOG_PROJECT_ROOT: '/resolution/environment' },
      deps: pathDeps(),
    });

    expect(home.kind).toBe('global');
  });

  it('uses the environment project root before discovery', () => {
    mkdirSync('/resolution/env-discovered/.git', { recursive: true });
    mkdirSync('/resolution/env-discovered/docs', { recursive: true });
    writeRepoConfig('/resolution/environment', {
      documentsDir: 'configured-docs',
    });

    const configuredHome = resolveBacklogHome({
      cwd: '/resolution/env-discovered',
      env: { BACKLOG_PROJECT_ROOT: '/resolution/environment' },
      deps: pathDeps(),
    });
    const overriddenHome = resolveBacklogHome({
      cwd: '/resolution/env-discovered',
      env: { BACKLOG_PROJECT_ROOT: '/resolution/environment' },
      documentsDir: 'caller-docs',
      deps: pathDeps(),
    });

    expect(configuredHome.kind).toBe('project');
    expect(configuredHome.root).toBe('/resolution/environment');
    expect(configuredHome.documentsDir)
      .toBe('/resolution/environment/configured-docs');
    expect(overriddenHome.documentsDir)
      .toBe('/resolution/environment/caller-docs');
  });

  it('uses an environment root to satisfy explicit project selection', () => {
    const home = resolveBacklogHome({
      home: 'project',
      env: { BACKLOG_PROJECT_ROOT: '/resolution/environment-selected' },
      deps: pathDeps(),
    });

    expect(home.kind).toBe('project');
    expect(home.root).toBe('/resolution/environment-selected');
  });

  it('allows an explicitly selected project before docs exists', () => {
    mkdirSync('/resolution/explicit-project/.git', { recursive: true });
    mkdirSync('/resolution/explicit-project/packages/app', { recursive: true });

    const home = resolveBacklogHome({
      home: 'project',
      cwd: '/resolution/explicit-project/packages/app',
      env: {},
      deps: pathDeps(),
    });

    expect(home.kind).toBe('project');
    expect(home.documentsDir).toBe('/resolution/explicit-project/docs');
    expect(existsSync(home.documentsDir)).toBe(false);
  });

  it('uses repo config after caller environment and before conventional docs', () => {
    writeRepoConfig('/resolution/config-selected', {
      home: 'global',
    });
    mkdirSync('/resolution/config-selected/docs', { recursive: true });

    const home = resolveBacklogHome({
      cwd: '/resolution/config-selected',
      env: {},
      deps: pathDeps(),
    });

    expect(home.kind).toBe('global');
  });

  it('lets caller environment override repo config', () => {
    writeRepoConfig('/resolution/config-overridden', {
      home: 'project',
      documentsDir: 'handbook',
    });

    const home = resolveBacklogHome({
      cwd: '/resolution/config-overridden',
      env: { BACKLOG_HOME: 'global' },
      deps: pathDeps(),
    });

    expect(home.kind).toBe('global');
  });

  it('resolves configured project documents relative to the project root', () => {
    writeRepoConfig('/resolution/config-documents', {
      home: 'project',
      documentsDir: 'handbook/decisions',
    });

    const home = resolveBacklogHome({
      cwd: '/resolution/config-documents',
      env: {},
      deps: pathDeps(),
    });

    expect(home.kind).toBe('project');
    expect(home.documentsDir)
      .toBe('/resolution/config-documents/handbook/decisions');
    expect(existsSync(home.documentsDir)).toBe(false);
  });

  it('treats configured documentsDir as a project declaration', () => {
    writeRepoConfig('/resolution/config-documents-only', {
      documentsDir: 'knowledge',
    });

    const home = resolveBacklogHome({
      cwd: '/resolution/config-documents-only',
      env: {},
      deps: pathDeps(),
    });

    expect(home.kind).toBe('project');
    expect(home.documentsDir)
      .toBe('/resolution/config-documents-only/knowledge');
  });

  it('rejects a configured documents directory outside the project root', () => {
    writeRepoConfig('/resolution/config-escape', {
      home: 'project',
      documentsDir: '../outside',
    });

    expect(() => resolveBacklogHome({
      cwd: '/resolution/config-escape',
      env: {},
      deps: pathDeps(),
    })).toThrow(BacklogHomeResolutionError);
  });

  it('does not read project config above a nested VCS boundary', () => {
    writeRepoConfig('/resolution/config-boundary', {
      home: 'project',
      documentsDir: 'outer-docs',
    });
    mkdirSync('/resolution/config-boundary/nested/.git', { recursive: true });
    mkdirSync('/resolution/config-boundary/nested/src', { recursive: true });

    const home = resolveBacklogHome({
      cwd: '/resolution/config-boundary/nested/src',
      env: {},
      deps: pathDeps(),
    });

    expect(home.kind).toBe('global');
  });

  it('selects a discovered project only when its documents directory exists', () => {
    mkdirSync('/resolution/project/.git', { recursive: true });
    mkdirSync('/resolution/project/docs', { recursive: true });
    mkdirSync('/resolution/project/packages/app', { recursive: true });

    const home = resolveBacklogHome({
      cwd: '/resolution/project/packages/app',
      env: {},
      deps: pathDeps(),
    });

    expect(home.kind).toBe('project');
    expect(home.root).toBe('/resolution/project');
  });

  it('falls back to global when a discovered boundary has no documents home', () => {
    mkdirSync('/resolution/no-docs/.git', { recursive: true });
    mkdirSync('/resolution/no-docs/packages/app', { recursive: true });

    const home = resolveBacklogHome({
      cwd: '/resolution/no-docs/packages/app',
      env: {},
      deps: pathDeps(),
    });

    expect(home.kind).toBe('global');
  });

  it('errors instead of falling back when project is explicitly selected', () => {
    expect(() => resolveBacklogHome({
      home: 'project',
      cwd: '/resolution/missing-project',
      env: {},
      deps: pathDeps(),
    })).toThrow(BacklogHomeResolutionError);
  });

  it('rejects invalid environment home selectors', () => {
    expect(() => resolveBacklogHome({
      env: { BACKLOG_HOME: '/ambiguous/path' },
      deps: pathDeps(),
    })).toThrow(/expected "global" or "project"/);
  });
});
