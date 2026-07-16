import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { extractResourceId, extractTargetFilename } from '../operations/resource-id.js';
import { OperationStorage } from '../operations/storage.js';
import { createOperationLogger, OperationLogger } from '../operations/logger.js';
import type { OperationEntry } from '../operations/types.js';

function operationLogPath(testName: string): string {
  return join(tmpdir(), 'backlog-mcp-operations-tests', testName, 'operations.jsonl');
}

function createStorage(testName: string): OperationStorage {
  return new OperationStorage(operationLogPath(testName));
}

function createLogger(testName: string): OperationLogger {
  return new OperationLogger(createStorage(testName));
}

function createEntry(ts: string, resourceId: string): OperationEntry {
  return {
    ts,
    tool: 'backlog_update',
    params: { id: resourceId },
    result: {},
    resourceId,
    actor: { type: 'user', name: 'test' },
  };
}

describe('Operations Module', () => {
  describe('extractResourceId', () => {
    it('extracts ID from backlog_create result', () => {
      const result = { content: [{ text: 'Created TASK-0042' }] };
      expect(extractResourceId('backlog_create', {}, result)).toBe('TASK-0042');
    });

    it('extracts EPIC ID from backlog_create result', () => {
      const result = { content: [{ text: 'Created EPIC-0005' }] };
      expect(extractResourceId('backlog_create', {}, result)).toBe('EPIC-0005');
    });

    it('extracts new entity type IDs from backlog_create result', () => {
      expect(extractResourceId('backlog_create', {}, { content: [{ text: 'Created FLDR-0001' }] })).toBe('FLDR-0001');
      expect(extractResourceId('backlog_create', {}, { content: [{ text: 'Created ARTF-0001' }] })).toBe('ARTF-0001');
      expect(extractResourceId('backlog_create', {}, { content: [{ text: 'Created MLST-0001' }] })).toBe('MLST-0001');
    });

    it('extracts ID from backlog_update params', () => {
      expect(extractResourceId('backlog_update', { id: 'TASK-0099' }, {})).toBe('TASK-0099');
    });

    it('extracts ID from backlog_delete params', () => {
      expect(extractResourceId('backlog_delete', { id: 'TASK-0001' }, {})).toBe('TASK-0001');
    });

    it('extracts ID from write_resource', () => {
      expect(extractResourceId('write_resource', { id: 'TASK-0055' }, {})).toBe('TASK-0055');
    });

    it('extracts EPIC ID from write_resource', () => {
      expect(extractResourceId('write_resource', { id: 'EPIC-0003' }, {})).toBe('EPIC-0003');
    });

    it('returns undefined for unknown tool', () => {
      expect(extractResourceId('unknown_tool', {}, {})).toBeUndefined();
    });

    it('returns undefined when no ID in result text', () => {
      const result = { content: [{ text: 'Something else' }] };
      expect(extractResourceId('backlog_create', {}, result)).toBeUndefined();
    });

    it('returns undefined for write_resource without id', () => {
      expect(extractResourceId('write_resource', {}, {})).toBeUndefined();
    });

    it('extracts ID from write_resource with old uri format', () => {
      expect(extractResourceId('write_resource', { uri: 'mcp://backlog/tasks/TASK-0177.md' }, {})).toBe('TASK-0177');
    });

    it('extracts EPIC ID from write_resource with old uri format', () => {
      expect(extractResourceId('write_resource', { uri: 'mcp://backlog/tasks/EPIC-0003.md' }, {})).toBe('EPIC-0003');
    });

    it('prefers id over uri for write_resource', () => {
      expect(extractResourceId('write_resource', { id: 'TASK-0001', uri: 'mcp://backlog/tasks/TASK-0002.md' }, {})).toBe('TASK-0001');
    });
  });

  describe('extractTargetFilename', () => {
    it('returns filename from old uri format', () => {
      expect(extractTargetFilename('write_resource', { uri: 'mcp://backlog/tasks/TASK-0001.md' })).toBe('TASK-0001.md');
    });

    it('returns filename from new id format', () => {
      expect(extractTargetFilename('write_resource', { id: 'TASK-0042' })).toBe('TASK-0042.md');
    });

    it('returns filename from id format for artifacts', () => {
      expect(extractTargetFilename('write_resource', { id: 'ARTF-0178' })).toBe('ARTF-0178.md');
    });

    it('prefers uri over id when both present', () => {
      expect(extractTargetFilename('write_resource', { uri: 'mcp://backlog/tasks/TASK-0001.md', id: 'TASK-0001' })).toBe('TASK-0001.md');
    });

    it('returns undefined for non-write_resource tools', () => {
      expect(extractTargetFilename('backlog_update', { id: 'TASK-0001' })).toBeUndefined();
      expect(extractTargetFilename('backlog_create', { title: 'test' })).toBeUndefined();
    });

    it('returns undefined for write_resource without id or uri', () => {
      expect(extractTargetFilename('write_resource', {})).toBeUndefined();
    });
  });

  describe('OperationStorage', () => {
    it('appends and reads operation entries', () => {
      const storage = createStorage('append-and-read');
      const entry = createEntry('2026-02-04T10:00:00.000Z', 'TASK-0001');

      storage.append(entry);

      expect(storage.readAll()).toEqual([entry]);
    });

    it('filters operations by date', () => {
      const storage = createStorage('date-filter');
      storage.append(createEntry('2026-02-04T10:00:00.000Z', 'TASK-0001'));
      storage.append(createEntry('2026-02-05T10:00:00.000Z', 'TASK-0002'));

      const feb4Ops = storage.query({ date: '2026-02-04' });
      const feb5Ops = storage.query({ date: '2026-02-05' });

      expect(feb4Ops).toHaveLength(1);
      expect(feb4Ops[0]?.resourceId).toBe('TASK-0001');
      expect(feb5Ops).toHaveLength(1);
      expect(feb5Ops[0]?.resourceId).toBe('TASK-0002');
    });
  });

  describe('OperationLogger', () => {
    it('uses the requested operation log path', () => {
      const logPath = operationLogPath('factory-path');
      const logger = createOperationLogger(logPath);

      logger.log('backlog_update', { id: 'TASK-0001' }, { success: true });

      expect(new OperationStorage(logPath).readAll()).toEqual([
        expect.objectContaining({
          tool: 'backlog_update',
          resourceId: 'TASK-0001',
        }),
      ]);
    });

    it('only logs write operations', () => {
      const logger = createLogger('write-operations-only');

      logger.log('backlog_list', { filter: 'active' }, { tasks: [] });
      expect(logger.read({ limit: 10 })).toEqual([]);

      logger.log('backlog_update', { id: 'TASK-0001' }, { success: true });
      expect(logger.read({ limit: 10 })).toEqual([
        expect.objectContaining({
          tool: 'backlog_update',
          resourceId: 'TASK-0001',
        }),
      ]);
    });

    it('includes actor info in logged operations', () => {
      vi.stubEnv('BACKLOG_ACTOR_TYPE', 'agent');
      vi.stubEnv('BACKLOG_ACTOR_NAME', 'test-agent');
      vi.stubEnv('BACKLOG_DELEGATED_BY', 'test-parent');
      vi.stubEnv('BACKLOG_TASK_CONTEXT', 'TASK-0001');

      try {
        const logger = createLogger('actor-info');
        logger.log('backlog_update', { id: 'TASK-0001' }, { success: true });

        expect(logger.read({ taskId: 'TASK-0001', limit: 1 })).toEqual([
          expect.objectContaining({
            actor: {
              type: 'agent',
              name: 'test-agent',
              delegatedBy: 'test-parent',
              taskContext: 'TASK-0001',
            },
          }),
        ]);
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });
});
