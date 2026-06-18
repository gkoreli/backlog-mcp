import { describe, it, expect } from 'vitest';
import { isOlderVersion } from '../utils/version.js';

/**
 * The comparator behind the monotonic upgrade rule: ensureServer (CLI bridge)
 * and the server's port-collision resolver both replace an incumbent only when
 * OURS is strictly newer. These cases lock the comparator that prevents the
 * multi-bridge "version ping-pong" (a stale older bridge must NOT restart a
 * newer server).
 */
describe('isOlderVersion', () => {
  it('returns true when a is strictly older than b', () => {
    expect(isOlderVersion('0.50.3', '0.51.0')).toBe(true);
    expect(isOlderVersion('0.51.0', '0.51.1')).toBe(true);
    expect(isOlderVersion('0.51.0', '1.0.0')).toBe(true);
    expect(isOlderVersion('1.2.3', '1.10.0')).toBe(true); // numeric, not lexical
  });

  it('returns false when versions are equal', () => {
    expect(isOlderVersion('0.51.0', '0.51.0')).toBe(false);
  });

  it('returns false when a is newer than b (never downgrade)', () => {
    expect(isOlderVersion('0.51.0', '0.50.3')).toBe(false);
    expect(isOlderVersion('1.0.0', '0.99.99')).toBe(false);
    expect(isOlderVersion('1.10.0', '1.2.3')).toBe(false);
  });

  it('tolerates differing segment counts', () => {
    expect(isOlderVersion('0.51', '0.51.1')).toBe(true);
    expect(isOlderVersion('0.51.0', '0.51')).toBe(false);
  });

  it('treats malformed segments as 0 rather than triggering a spurious downgrade', () => {
    expect(isOlderVersion('garbage', '0.51.0')).toBe(true);
    expect(isOlderVersion('0.51.0', 'garbage')).toBe(false);
  });

  it('compares on the numeric core, ignoring pre-release tags', () => {
    expect(isOlderVersion('0.51.0-beta', '0.51.0')).toBe(false);
  });
});
