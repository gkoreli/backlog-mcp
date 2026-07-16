import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { storage } from '../storage/local/backlog-service.js';
import { buildEntity } from '../storage/entity-factory.js';

describe('Viewer Routes - Copy Markdown', () => {
  const testTaskId = 'TASK-9999';

  beforeAll(async () => {
    const task = buildEntity({
      id: testTaskId,
      title: 'Test Copy Markdown',
      content: 'This is a test task for copy markdown functionality',
    });
    await storage.add(task);
  });

  afterAll(async () => {
    await storage.delete(testTaskId);
  });

  it('should include raw markdown in task response', async () => {
    const task = await storage.get(testTaskId);
    const raw = await storage.getMarkdown(testTaskId);

    expect(task).toBeDefined();
    expect(raw).toBeDefined();
    expect(typeof raw).toBe('string');

    // Verify raw contains YAML frontmatter
    expect(raw).toContain('---');
    expect(raw).toContain('id: TASK-9999');
    expect(raw).toContain('title: Test Copy Markdown');
    expect(raw).toContain('status: open');

    // Verify raw contains markdown body
    expect(raw).toContain('This is a test task for copy markdown functionality');

    // Simulate API response
    const apiResponse = { ...task, raw };
    expect(apiResponse.raw).toBe(raw);
  });
});
