import { describe, it, expect } from 'vitest';
import {
  findConfigDir,
  loadRepoConfig,
  resolveScope,
  CONFIG_DIR,
  type ConfigFsDeps,
} from '../core/config.js';

/**
 * Build an injectable fs from a flat map of absolute path → contents.
 * A path "exists" if it's a key, or a prefix of a key (so directories resolve).
 */
function fakeFs(files: Record<string, string>): ConfigFsDeps {
  const keys = Object.keys(files);
  return {
    exists: (p) => keys.some((k) => k === p || k.startsWith(p + '/')),
    read: (p) => {
      if (!(p in files)) throw new Error(`ENOENT: ${p}`);
      return files[p]!;
    },
  };
}

describe('findConfigDir', () => {
  it('finds .backlog-mcp in the start dir', () => {
    const fs = fakeFs({ [`/repo/${CONFIG_DIR}/config.json`]: '{}' });
    expect(findConfigDir('/repo', fs)).toBe(`/repo/${CONFIG_DIR}`);
  });

  it('walks up to a parent directory', () => {
    const fs = fakeFs({ [`/repo/${CONFIG_DIR}/config.json`]: '{}' });
    expect(findConfigDir('/repo/packages/server/src', fs)).toBe(`/repo/${CONFIG_DIR}`);
  });

  it('returns undefined when no config dir exists up to root', () => {
    const fs = fakeFs({ '/some/other/file.txt': 'x' });
    expect(findConfigDir('/repo/deep/nested', fs)).toBeUndefined();
  });
});

describe('loadRepoConfig', () => {
  it('returns {} when no config dir', () => {
    expect(loadRepoConfig('/repo', fakeFs({}))).toEqual({});
  });

  it('reads scope from config.json', () => {
    const fs = fakeFs({ [`/repo/${CONFIG_DIR}/config.json`]: '{"scope":"FLDR-0001"}' });
    expect(loadRepoConfig('/repo', fs).scope).toBe('FLDR-0001');
  });

  it('config.local.json overrides config.json', () => {
    const fs = fakeFs({
      [`/repo/${CONFIG_DIR}/config.json`]: '{"scope":"FLDR-0001"}',
      [`/repo/${CONFIG_DIR}/config.local.json`]: '{"scope":"FLDR-9999"}',
    });
    expect(loadRepoConfig('/repo', fs).scope).toBe('FLDR-9999');
  });

  it('preserves unknown keys (forward compatibility)', () => {
    const fs = fakeFs({ [`/repo/${CONFIG_DIR}/config.json`]: '{"scope":"FLDR-0001","future":42}' });
    expect(loadRepoConfig('/repo', fs)).toMatchObject({ scope: 'FLDR-0001', future: 42 });
  });

  it('degrades gracefully on malformed JSON → {}', () => {
    const fs = fakeFs({ [`/repo/${CONFIG_DIR}/config.json`]: '{not json' });
    expect(loadRepoConfig('/repo', fs)).toEqual({});
  });

  it('degrades gracefully on wrong-typed scope → {}', () => {
    const fs = fakeFs({ [`/repo/${CONFIG_DIR}/config.json`]: '{"scope":123}' });
    expect(loadRepoConfig('/repo', fs)).toEqual({});
  });
});

describe('resolveScope precedence', () => {
  const fsWithConfig = fakeFs({ [`/repo/${CONFIG_DIR}/config.json`]: '{"scope":"FLDR-CONFIG"}' });

  it('explicit wins over everything', () => {
    expect(resolveScope({
      explicit: 'FLDR-EXPLICIT',
      env: { BACKLOG_SCOPE: 'FLDR-ENV' },
      cwd: '/repo',
      deps: fsWithConfig,
    })).toBe('FLDR-EXPLICIT');
  });

  it('env wins over config file', () => {
    expect(resolveScope({
      env: { BACKLOG_SCOPE: 'FLDR-ENV' },
      cwd: '/repo',
      deps: fsWithConfig,
    })).toBe('FLDR-ENV');
  });

  it('config file used when no explicit/env', () => {
    expect(resolveScope({ env: {}, cwd: '/repo', deps: fsWithConfig })).toBe('FLDR-CONFIG');
  });

  it('returns undefined when nothing is set (whole-backlog default)', () => {
    expect(resolveScope({ env: {}, cwd: '/repo', deps: fakeFs({}) })).toBeUndefined();
  });

  it('treats blank/whitespace values as absent and falls through', () => {
    expect(resolveScope({
      explicit: '   ',
      env: { BACKLOG_SCOPE: '' },
      cwd: '/repo',
      deps: fsWithConfig,
    })).toBe('FLDR-CONFIG');
  });
});
