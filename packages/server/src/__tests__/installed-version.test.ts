import { describe, expect, it } from 'vitest';
import { readInstalledVersion, releaseStatus } from '../core/installed-version.js';

describe('readInstalledVersion (ADR 0131 R1)', () => {
  it('reads the version from the install package.json on every call', () => {
    let contents = '{"version":"0.73.0"}';
    const deps = { packageJsonPath: '/pkg/package.json', readFile: () => contents };
    expect(readInstalledVersion(deps)).toBe('0.73.0');
    contents = '{"version":"0.74.0"}';
    expect(readInstalledVersion(deps)).toBe('0.74.0');
  });

  it('fails open to null on unreadable or malformed files', () => {
    expect(readInstalledVersion({ packageJsonPath: '/x', readFile: () => { throw new Error('ENOENT'); } })).toBeNull();
    expect(readInstalledVersion({ packageJsonPath: '/x', readFile: () => '{not json' })).toBeNull();
    expect(readInstalledVersion({ packageJsonPath: '/x', readFile: () => '{"version":7}' })).toBeNull();
  });
});

describe('releaseStatus (ADR 0131 R1)', () => {
  it('flags an update only when the disk install is strictly newer', () => {
    expect(releaseStatus('0.73.0', '0.74.0')).toEqual({ running: '0.73.0', installed: '0.74.0', updateAvailable: true });
    expect(releaseStatus('0.73.0', '0.73.0')).toMatchObject({ updateAvailable: false });
    expect(releaseStatus('0.74.0', '0.73.0')).toMatchObject({ updateAvailable: false });
    expect(releaseStatus('0.73.0', null)).toEqual({ running: '0.73.0', installed: null, updateAvailable: false });
  });
});
