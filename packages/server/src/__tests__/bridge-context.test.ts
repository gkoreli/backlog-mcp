import {
  existsSync,
  mkdirSync,
  readFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BACKLOG_HOME_HEADER,
  BACKLOG_PROJECT_ROOT_HEADER,
  buildMcpRemoteArgs,
  resolveBridgeHomeContext,
} from '../cli/bridge-context.js';
import type { BacklogHomeDeps } from '../core/backlog-home.types.js';

function pathDeps(homeDir = '/users/quartz'): BacklogHomeDeps {
  return {
    exists: existsSync,
    read: (path) => readFileSync(path, 'utf-8'),
    canonicalize: resolve,
    homeDir: () => homeDir,
  };
}

describe('resolveBridgeHomeContext', () => {
  it('honors an explicit global selection over caller environment', () => {
    expect(resolveBridgeHomeContext({
      cwd: '/workspace',
      env: {
        BACKLOG_HOME: 'project',
        BACKLOG_PROJECT_ROOT: '/environment/project',
      },
      home: 'global',
      deps: pathDeps(),
    })).toEqual({ home: 'global' });
  });

  it('honors an explicit project selection and root', () => {
    expect(resolveBridgeHomeContext({
      cwd: '/workspace',
      env: { BACKLOG_HOME: 'global' },
      home: 'project',
      projectRoot: '/explicit/project',
      deps: pathDeps(),
    })).toEqual({
      home: 'project',
      projectRoot: '/explicit/project',
    });
  });

  it('uses caller environment to select the project home', () => {
    expect(resolveBridgeHomeContext({
      cwd: '/workspace',
      env: {
        BACKLOG_HOME: 'project',
        BACKLOG_PROJECT_ROOT: '/environment/project',
      },
      deps: pathDeps(),
    })).toEqual({
      home: 'project',
      projectRoot: '/environment/project',
    });
  });

  it('uses caller environment to select the global home', () => {
    mkdirSync('/workspace/project/.git', { recursive: true });
    mkdirSync('/workspace/project/docs', { recursive: true });

    expect(resolveBridgeHomeContext({
      cwd: '/workspace/project',
      env: { BACKLOG_HOME: 'global' },
      deps: pathDeps(),
    })).toEqual({ home: 'global' });
  });

  it('discovers a project home from the caller cwd', () => {
    mkdirSync('/workspace/discovered/.git', { recursive: true });
    mkdirSync('/workspace/discovered/docs', { recursive: true });
    mkdirSync('/workspace/discovered/packages/app', { recursive: true });

    expect(resolveBridgeHomeContext({
      cwd: '/workspace/discovered/packages/app',
      env: {},
      deps: pathDeps(),
    })).toEqual({
      home: 'project',
      projectRoot: '/workspace/discovered',
    });
  });

  it('forwards the canonical project root from the home resolver', () => {
    const deps: BacklogHomeDeps = {
      ...pathDeps(),
      canonicalize(path) {
        return resolve(path).replace(
          '/linked/project',
          '/physical/project',
        );
      },
    };

    expect(resolveBridgeHomeContext({
      cwd: '/workspace',
      env: {},
      home: 'project',
      projectRoot: '/linked/project',
      deps,
    })).toEqual({
      home: 'project',
      projectRoot: '/physical/project',
    });
  });
});

describe('buildMcpRemoteArgs', () => {
  it('exports the canonical bridge header names', () => {
    expect(BACKLOG_HOME_HEADER).toBe('X-Backlog-Home');
    expect(BACKLOG_PROJECT_ROOT_HEADER).toBe('X-Backlog-Project-Root');
  });

  it('emits the global home header and omits project root', () => {
    expect(buildMcpRemoteArgs(
      'http://localhost:6420/mcp',
      { home: 'global' },
    )).toEqual([
      'http://localhost:6420/mcp',
      '--allow-http',
      '--transport',
      'http-only',
      '--header',
      'X-Backlog-Home:global',
    ]);
  });

  it('emits project headers in deterministic order', () => {
    expect(buildMcpRemoteArgs(
      'http://localhost:6420/mcp',
      { home: 'project', projectRoot: '/workspace/project' },
    )).toEqual([
      'http://localhost:6420/mcp',
      '--allow-http',
      '--transport',
      'http-only',
      '--header',
      'X-Backlog-Home:project',
      '--header',
      'X-Backlog-Project-Root:/workspace/project',
    ]);
  });

  it('keeps a project root containing spaces in one spawn argument', () => {
    const args = buildMcpRemoteArgs(
      'http://localhost:6420/mcp',
      { home: 'project', projectRoot: '/workspace/Project Notes' },
    );

    expect(args.at(-1))
      .toBe('X-Backlog-Project-Root:/workspace/Project Notes');
    expect(args).toHaveLength(8);
  });
});
