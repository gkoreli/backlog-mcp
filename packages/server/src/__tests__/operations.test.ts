import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { extractTargetFilename } from '../operations/resource-id.js';
import { inferLegacyMutation } from '../operations/mutation.js';
import { OperationStorage } from '../operations/storage.js';

function createStorage(testName: string): OperationStorage {
  return new OperationStorage(
    join(tmpdir(), 'backlog-mcp-operations-tests', testName, 'operations.jsonl'),
  );
}

describe('Operations Module', () => {
  describe('legacy mutation inference', () => {
    it.each([
      ['backlog_create', 'create'],
      ['backlog_update', 'update'],
      ['backlog_delete', 'delete'],
      ['write_resource', 'resource-edit'],
    ] as const)('maps %s to %s', (tool, mutation) => {
      expect(inferLegacyMutation(tool)).toBe(mutation);
    });

    it('leaves unknown historical tools unclassified', () => {
      expect(inferLegacyMutation('unknown_tool')).toBeUndefined();
    });
  });

  describe('extractTargetFilename', () => {
    it('returns filename from old uri format', () => {
      expect(extractTargetFilename('resource-edit', { uri: 'mcp://backlog/tasks/TASK-0001.md' })).toBe('TASK-0001.md');
    });

    it('returns filename from new id format', () => {
      expect(extractTargetFilename('resource-edit', { id: 'TASK-0042' })).toBe('TASK-0042.md');
    });

    it('returns filename from id format for artifacts', () => {
      expect(extractTargetFilename('resource-edit', { id: 'ARTF-0178' })).toBe('ARTF-0178.md');
    });

    it('prefers uri over id when both present', () => {
      expect(extractTargetFilename('resource-edit', { uri: 'mcp://backlog/tasks/TASK-0001.md', id: 'TASK-0001' })).toBe('TASK-0001.md');
    });

    it('returns undefined for non-write_resource tools', () => {
      expect(extractTargetFilename('update', { id: 'TASK-0001' })).toBeUndefined();
      expect(extractTargetFilename('create', { title: 'test' })).toBeUndefined();
    });

    it('returns undefined for write_resource without id or uri', () => {
      expect(extractTargetFilename('resource-edit', {})).toBeUndefined();
    });
  });

  describe('OperationStorage compatibility', () => {
    it('round-trips new mutation entries and filters by direct resourceId', () => {
      const storage = createStorage('new-mutation');
      storage.append({
        ts: '2026-02-05T10:00:00.000Z',
        tool: 'backlog_complete_task',
        mutation: 'update',
        params: { id: 'TASK-0001' },
        result: { id: 'TASK-0001' },
        resourceId: 'TASK-0001',
        actor: { type: 'agent', name: 'test' },
      });

      expect(storage.query({ taskId: 'TASK-0001' })).toEqual([
        expect.objectContaining({
          tool: 'backlog_complete_task',
          mutation: 'update',
          resourceId: 'TASK-0001',
        }),
      ]);
    });

    it('normalizes known legacy entries while retaining their tool', () => {
      const storage = createStorage('legacy-mutation');
      storage.append({
        ts: '2026-02-05T10:00:00.000Z',
        tool: 'backlog_update',
        params: { id: 'TASK-0001' },
        result: {},
        resourceId: 'TASK-0001',
        actor: { type: 'user', name: 'test' },
      });

      expect(storage.query()[0]).toEqual(expect.objectContaining({
        tool: 'backlog_update',
        mutation: 'update',
      }));
    });

    it('filters operations by date', () => {
      const storage = createStorage('date-filter');

      // Manually append entries with specific dates for testing
      const entry1 = {
        ts: '2026-02-04T10:00:00.000Z',
        tool: 'backlog_update',
        params: { id: 'TASK-0001' },
        result: {},
        resourceId: 'TASK-0001',
        actor: { type: 'user' as const, name: 'test' },
      };
      const entry2 = {
        ts: '2026-02-05T10:00:00.000Z',
        tool: 'backlog_update',
        params: { id: 'TASK-0002' },
        result: {},
        resourceId: 'TASK-0002',
        actor: { type: 'user' as const, name: 'test' },
      };

      storage.append(entry1);
      storage.append(entry2);

      // Query by date
      const feb4Ops = storage.query({ date: '2026-02-04' });
      const feb5Ops = storage.query({ date: '2026-02-05' });

      expect(feb4Ops.length).toBe(1);
      expect(feb4Ops[0].resourceId).toBe('TASK-0001');

      expect(feb5Ops.length).toBe(1);
      expect(feb5Ops[0].resourceId).toBe('TASK-0002');
    });
  });
});
