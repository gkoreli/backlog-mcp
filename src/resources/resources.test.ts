import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveMcpUri } from '../uri-resolver.js';

describe('URI Resolver - Task-Attached Resources', () => {
  let testDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    testDir = join(tmpdir(), `backlog-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    originalEnv = process.env.BACKLOG_DATA_DIR;
    process.env.BACKLOG_DATA_DIR = testDir;
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    if (originalEnv) {
      process.env.BACKLOG_DATA_DIR = originalEnv;
    } else {
      delete process.env.BACKLOG_DATA_DIR;
    }
  });

  it('should resolve task-attached resource URI to correct path', () => {
    const uri = 'mcp://backlog/resources/TASK-0068/test-adr.md';
    const resolved = resolveMcpUri(uri);
    
    expect(resolved).toBe(join(testDir, 'resources', 'TASK-0068', 'test-adr.md'));
  });

  it('should resolve epic-attached resource URI', () => {
    const uri = 'mcp://backlog/resources/EPIC-0002/adr-001.md';
    const resolved = resolveMcpUri(uri);
    
    expect(resolved).toBe(join(testDir, 'resources', 'EPIC-0002', 'adr-001.md'));
  });

  it('should distinguish task-attached from repository resources', () => {
    const taskResource = 'mcp://backlog/resources/TASK-0068/adr.md';
    const repoResource = 'mcp://backlog/resources/src/server.ts';
    
    const taskPath = resolveMcpUri(taskResource);
    const repoPath = resolveMcpUri(repoResource);
    
    // Task resource should go to BACKLOG_DATA_DIR/resources
    expect(taskPath).toContain(testDir);
    expect(taskPath).toContain('resources/TASK-0068');
    
    // Repo resource should go to repository root
    expect(repoPath).not.toContain(testDir);
    expect(repoPath).toContain('src/server.ts');
  });

  it('should handle nested paths in task resources', () => {
    const uri = 'mcp://backlog/resources/TASK-0068/docs/adr-001.md';
    const resolved = resolveMcpUri(uri);
    
    expect(resolved).toBe(join(testDir, 'resources', 'TASK-0068', 'docs', 'adr-001.md'));
  });
});

describe('Resource Reader - Task-Attached Resources', () => {
  let testDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    testDir = join(tmpdir(), `backlog-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    originalEnv = process.env.BACKLOG_DATA_DIR;
    process.env.BACKLOG_DATA_DIR = testDir;
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    if (originalEnv) {
      process.env.BACKLOG_DATA_DIR = originalEnv;
    } else {
      delete process.env.BACKLOG_DATA_DIR;
    }
  });

  it('should read task-attached markdown resource', async () => {
    const { readMcpResource } = await import('../resource-reader.js');
    
    // Create test resource
    const resourceDir = join(testDir, 'resources', 'TASK-0068');
    mkdirSync(resourceDir, { recursive: true });
    writeFileSync(
      join(resourceDir, 'test.md'),
      '# Test ADR\n\nContent here.',
      'utf-8'
    );
    
    const uri = 'mcp://backlog/resources/TASK-0068/test.md';
    const result = readMcpResource(uri);
    
    expect(result.content).toBe('# Test ADR\n\nContent here.');
    expect(result.mimeType).toBe('text/markdown');
  });

  it('should parse frontmatter in markdown resources', async () => {
    const { readMcpResource } = await import('../resource-reader.js');
    
    const resourceDir = join(testDir, 'resources', 'TASK-0068');
    mkdirSync(resourceDir, { recursive: true });
    writeFileSync(
      join(resourceDir, 'adr.md'),
      '---\ntitle: Test ADR\nstatus: Accepted\n---\n\n# Content',
      'utf-8'
    );
    
    const uri = 'mcp://backlog/resources/TASK-0068/adr.md';
    const result = readMcpResource(uri);
    
    expect(result.content).toBe('\n# Content');
    expect(result.frontmatter).toEqual({ title: 'Test ADR', status: 'Accepted' });
    expect(result.mimeType).toBe('text/markdown');
  });

  it('should throw error for non-existent resource', async () => {
    const { readMcpResource } = await import('../resource-reader.js');
    
    const uri = 'mcp://backlog/resources/TASK-9999/missing.md';
    
    expect(() => readMcpResource(uri)).toThrow('Resource not found');
  });

  it('should handle different file types', async () => {
    const { readMcpResource } = await import('../resource-reader.js');
    
    const resourceDir = join(testDir, 'resources', 'TASK-0068');
    mkdirSync(resourceDir, { recursive: true });
    
    // JSON file
    writeFileSync(join(resourceDir, 'data.json'), '{"key": "value"}', 'utf-8');
    const jsonResult = readMcpResource('mcp://backlog/resources/TASK-0068/data.json');
    expect(jsonResult.mimeType).toBe('application/json');
    
    // Text file
    writeFileSync(join(resourceDir, 'notes.txt'), 'Plain text', 'utf-8');
    const txtResult = readMcpResource('mcp://backlog/resources/TASK-0068/notes.txt');
    expect(txtResult.mimeType).toBe('text/plain');
  });
});
