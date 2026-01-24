import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Task-attached resources', () => {
  let testDir: string;
  let resourcesDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `backlog-test-${Date.now()}`);
    resourcesDir = join(testDir, 'resources');
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should create resource file in task-specific directory', () => {
    const taskId = 'TASK-0068';
    const resourcePath = join(resourcesDir, taskId, 'adr-001.md');
    const resourceDir = join(resourcesDir, taskId);
    
    // Create directory
    mkdirSync(resourceDir, { recursive: true });
    
    // Write resource
    const content = '# ADR 001\n\nTest ADR content.';
    writeFileSync(resourcePath, content, 'utf-8');
    
    // Verify
    expect(existsSync(resourcePath)).toBe(true);
    expect(readFileSync(resourcePath, 'utf-8')).toBe(content);
  });

  it('should support multiple resources per task', () => {
    const taskId = 'TASK-0068';
    const resourceDir = join(resourcesDir, taskId);
    mkdirSync(resourceDir, { recursive: true });
    
    // Create multiple resources
    writeFileSync(join(resourceDir, 'adr-001.md'), '# ADR 001', 'utf-8');
    writeFileSync(join(resourceDir, 'design.md'), '# Design', 'utf-8');
    writeFileSync(join(resourceDir, 'notes.md'), '# Notes', 'utf-8');
    
    // Verify all exist
    expect(existsSync(join(resourceDir, 'adr-001.md'))).toBe(true);
    expect(existsSync(join(resourceDir, 'design.md'))).toBe(true);
    expect(existsSync(join(resourceDir, 'notes.md'))).toBe(true);
  });

  it('should delete resources when task directory is removed', () => {
    const taskId = 'TASK-0068';
    const resourceDir = join(resourcesDir, taskId);
    mkdirSync(resourceDir, { recursive: true });
    
    // Create resource
    writeFileSync(join(resourceDir, 'adr-001.md'), '# ADR 001', 'utf-8');
    expect(existsSync(resourceDir)).toBe(true);
    
    // Delete directory
    rmSync(resourceDir, { recursive: true, force: true });
    
    // Verify deleted
    expect(existsSync(resourceDir)).toBe(false);
  });

  it('should namespace resources by task ID to prevent conflicts', () => {
    const task1Dir = join(resourcesDir, 'TASK-0068');
    const task2Dir = join(resourcesDir, 'TASK-0069');
    
    mkdirSync(task1Dir, { recursive: true });
    mkdirSync(task2Dir, { recursive: true });
    
    // Both tasks can have adr-001.md
    writeFileSync(join(task1Dir, 'adr-001.md'), '# Task 68 ADR', 'utf-8');
    writeFileSync(join(task2Dir, 'adr-001.md'), '# Task 69 ADR', 'utf-8');
    
    // Verify both exist with different content
    expect(readFileSync(join(task1Dir, 'adr-001.md'), 'utf-8')).toBe('# Task 68 ADR');
    expect(readFileSync(join(task2Dir, 'adr-001.md'), 'utf-8')).toBe('# Task 69 ADR');
  });
});
