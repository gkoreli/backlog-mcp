import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { globalStatePath } from '../utils/global-home-paths.js';

describe('global home operational paths', function describeGlobalPaths() {
  it('ignores retired storage selection for process logs', function ignoresLegacyRoot() {
    const previous = process.env.BACKLOG_DATA_DIR;
    process.env.BACKLOG_DATA_DIR = '/retired/custom-root';
    try {
      expect(globalStatePath('logs', 'runtime')).toBe(
        join(homedir(), '.backlog', 'state', 'logs', 'runtime'),
      );
    } finally {
      if (previous === undefined) delete process.env.BACKLOG_DATA_DIR;
      else process.env.BACKLOG_DATA_DIR = previous;
    }
  });
});
