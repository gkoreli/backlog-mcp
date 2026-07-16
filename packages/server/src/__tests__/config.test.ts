import { mkdirSync, writeFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  CONFIG_DIR,
  findConfigDir,
  loadHomeConfig,
  loadRepoConfig,
  resolveContext,
} from '../core/config.js';
import { createBacklogHome } from '../core/backlog-home.js';

function writeConfig(
  root: string,
  fileName: 'config.json' | 'config.local.json',
  contents: string,
): void {
  const configDir = `${root}/${CONFIG_DIR}`;
  mkdirSync(configDir, { recursive: true });
  writeFileSync(`${configDir}/${fileName}`, contents);
}

describe('findConfigDir', () => {
  it('finds .backlog in the start dir', () => {
    writeConfig('/config/start', 'config.json', '{}');
    expect(findConfigDir('/config/start')).toBe(`/config/start/${CONFIG_DIR}`);
  });

  it('walks up to a parent directory', () => {
    writeConfig('/config/parent', 'config.json', '{}');
    mkdirSync('/config/parent/packages/server/src', { recursive: true });

    expect(findConfigDir('/config/parent/packages/server/src'))
      .toBe(`/config/parent/${CONFIG_DIR}`);
  });

  it('does not cross a nested VCS boundary', () => {
    writeConfig('/config/outer', 'config.json', '{}');
    mkdirSync('/config/outer/nested/.git', { recursive: true });
    mkdirSync('/config/outer/nested/src', { recursive: true });

    expect(findConfigDir('/config/outer/nested/src')).toBeUndefined();
  });

  it('prefers config when config and VCS markers share a directory', () => {
    writeConfig('/config/same-boundary', 'config.json', '{}');
    mkdirSync('/config/same-boundary/.git', { recursive: true });

    expect(findConfigDir('/config/same-boundary'))
      .toBe(`/config/same-boundary/${CONFIG_DIR}`);
  });

  it('does not walk above an explicit stop directory', () => {
    writeConfig('/config/stopped', 'config.json', '{}');
    mkdirSync('/config/stopped/packages/app/src', { recursive: true });

    expect(findConfigDir(
      '/config/stopped/packages/app/src',
      undefined,
      '/config/stopped/packages/app',
    )).toBeUndefined();
  });
});

describe('loadRepoConfig', () => {
  it('returns {} when no config directory exists', () => {
    expect(loadRepoConfig('/config/missing')).toEqual({});
  });

  it('reads docs-native home configuration and context', () => {
    writeConfig(
      '/config/read',
      'config.json',
      JSON.stringify({
        home: 'project',
        documentsDir: 'handbook',
        context: 'FLDR-0001',
      }),
    );

    expect(loadRepoConfig('/config/read')).toMatchObject({
      home: 'project',
      documentsDir: 'handbook',
      context: 'FLDR-0001',
    });
  });

  it('config.local.json overrides committed home defaults', () => {
    writeConfig(
      '/config/local',
      'config.json',
      JSON.stringify({
        home: 'global',
        documentsDir: 'docs',
        context: 'FLDR-0001',
      }),
    );
    writeConfig(
      '/config/local',
      'config.local.json',
      JSON.stringify({
        home: 'project',
        documentsDir: 'notes',
        context: 'FLDR-9999',
      }),
    );

    expect(loadRepoConfig('/config/local')).toMatchObject({
      home: 'project',
      documentsDir: 'notes',
      context: 'FLDR-9999',
    });
  });

  it('preserves unknown keys', () => {
    writeConfig(
      '/config/unknown',
      'config.json',
      '{"context":"FLDR-0001","future":42}',
    );

    expect(loadRepoConfig('/config/unknown'))
      .toMatchObject({ context: 'FLDR-0001', future: 42 });
  });

  it('degrades gracefully on malformed JSON', () => {
    writeConfig('/config/malformed', 'config.json', '{not json');
    expect(loadRepoConfig('/config/malformed')).toEqual({});
  });

  it('degrades gracefully on invalid home configuration', () => {
    writeConfig('/config/invalid', 'config.json', '{"home":"all"}');
    expect(loadRepoConfig('/config/invalid')).toEqual({});
  });
});

describe('loadHomeConfig', () => {
  it('loads one flat global config without applying config.local.json', () => {
    const home = createBacklogHome({
      kind: 'global',
      root: '/config/global-home',
      controlDir: '/config/global-home',
    });
    mkdirSync(home.root, { recursive: true });
    writeFileSync(
      '/config/global-home/config.json',
      '{"context":"FLDR-GLOBAL"}',
    );
    writeFileSync(
      '/config/global-home/config.local.json',
      '{"context":"FLDR-LOCAL"}',
    );

    expect(loadHomeConfig(home)).toMatchObject({
      context: 'FLDR-GLOBAL',
    });
  });
});

describe('resolveContext precedence', () => {
  beforeAll(() => {
    writeConfig(
      '/config/scope',
      'config.json',
      '{"context":"FLDR-CONFIG","home":"project"}',
    );
  });

  it('keeps explicit entity context distinct from home configuration', () => {
    expect(resolveContext({
      explicit: 'FLDR-EXPLICIT',
      env: { BACKLOG_CONTEXT: 'FLDR-ENV' },
      cwd: '/config/scope',
    })).toBe('FLDR-EXPLICIT');
  });

  it('uses caller environment before config context', () => {
    expect(resolveContext({
      env: { BACKLOG_CONTEXT: 'FLDR-ENV' },
      cwd: '/config/scope',
    })).toBe('FLDR-ENV');
  });

  it('uses config context when caller defaults are absent', () => {
    expect(resolveContext({
      env: {},
      cwd: '/config/scope',
    })).toBe('FLDR-CONFIG');
  });

  it('returns undefined when no context is configured', () => {
    expect(resolveContext({
      env: {},
      cwd: '/config/no-scope',
    })).toBeUndefined();
  });

  it('treats blank values as absent and falls through', () => {
    expect(resolveContext({
      explicit: '   ',
      env: { BACKLOG_CONTEXT: '' },
      cwd: '/config/scope',
    })).toBe('FLDR-CONFIG');
  });
});
