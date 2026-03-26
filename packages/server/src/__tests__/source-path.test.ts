import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveSourcePath } from '../utils/resolve-source-path.js';

describe('source_path for backlog_create', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `backlog-source-path-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should read file content from absolute path', () => {
    const filePath = join(testDir, 'test.md');
    writeFileSync(filePath, '# Hello\n\nThis is test content.');
    expect(resolveSourcePath(filePath)).toBe('# Hello\n\nThis is test content.');
  });

  it('should throw for non-existent file', () => {
    expect(() => resolveSourcePath('/nonexistent/file.md')).toThrow('File not found');
  });

  it('should throw for directory path', () => {
    expect(() => resolveSourcePath(testDir)).toThrow('Not a file');
  });

  it('should handle tilde expansion', () => {
    // Verifies tilde expansion doesn't crash — actual home dir content varies
    expect(() => resolveSourcePath('~/nonexistent-backlog-test-file-xyz.md')).toThrow('File not found');
  });

  it('should read large file content without truncation', () => {
    const filePath = join(testDir, 'large.md');
    const largeContent = 'Line of content for testing.\n'.repeat(10000);
    writeFileSync(filePath, largeContent);
    expect(resolveSourcePath(filePath)).toBe(largeContent);
  });
});
