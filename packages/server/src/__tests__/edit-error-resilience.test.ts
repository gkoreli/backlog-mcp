import { describe, it, expect, vi } from 'vitest';
import { applyOperation } from '../resources/operations.js';
import { editItem } from '../core/edit.js';
import { NotFoundError } from '../core/types.js';
import type { Entity } from '@backlog-mcp/shared';
import type { IBacklogService } from '../storage/service-types.js';

function mockService(entities: Entity[] = []): IBacklogService {
  const store = new Map(entities.map(e => [e.id, { ...e }]));
  return {
    get: vi.fn(async (id: string) => store.get(id)),
    save: vi.fn(async (entity: Entity) => { store.set(entity.id, entity); }),
  } as unknown as IBacklogService;
}

/**
 * Invariant tests for the edit command improvements (2026-04-20):
 * 1. Rich error messages with fuzzy hints and content preview
 * 2. editItem returns { success: false } with rich error (core contract)
 * 3. isError signaling — transports check result.success to signal failure
 */
describe('edit error resilience invariants', () => {
  // ── Rich error messages from applyOperation ──

  describe('str_replace error includes actionable context', () => {
    const content = 'Line 1: Hello world\nLine 2: foo bar\nLine 3: baz qux';

    it('includes "First 10 lines of actual content" on mismatch', () => {
      expect(() => applyOperation(content, { type: 'str_replace', old_str: 'MISSING', new_str: 'x' }))
        .toThrow('First 10 lines of actual content:');
    });

    it('includes fuzzy hint when old_str partially matches a line', () => {
      // "foo bar baz" shares 2/3 words with "foo bar" (line 2)
      const multiLineContent = 'First line here\nfoo bar content\nThird line here';
      try {
        applyOperation(multiLineContent, { type: 'str_replace', old_str: 'foo bar baz', new_str: 'x' });
        expect.unreachable();
      } catch (e: any) {
        expect(e.message).toContain('Did you mean this line?');
        expect(e.message).toContain('foo bar');
      }
    });

    it('shows actual content lines so agent can copy correct text', () => {
      try {
        applyOperation(content, { type: 'str_replace', old_str: 'wrong', new_str: 'x' });
        expect.unreachable();
      } catch (e: any) {
        expect(e.message).toContain('Line 1: Hello world');
        expect(e.message).toContain('Line 2: foo bar');
      }
    });
  });

  // ── Core editItem propagates rich errors ──

  describe('editItem surfaces rich error in result.error', () => {
    it('returns success: false with full error message on str_replace failure', async () => {
      const svc = mockService([{ id: 'TASK-0001', title: 'T', description: 'actual content here', status: 'open', created_at: '', updated_at: '' } as Entity]);
      const result = await editItem(svc, { id: 'TASK-0001', operation: { type: 'str_replace', old_str: 'wrong text', new_str: 'x' } });

      expect(result.success).toBe(false);
      expect(result.error).toContain('old_str not found');
      expect(result.error).toContain('First 10 lines of actual content:');
      expect(result.error).toContain('actual content here');
    });

    it('result.error is a string transports can pass directly to users', async () => {
      const svc = mockService([{ id: 'TASK-0001', title: 'T', description: 'hello', status: 'open', created_at: '', updated_at: '' } as Entity]);
      const result = await editItem(svc, { id: 'TASK-0001', operation: { type: 'str_replace', old_str: 'goodbye', new_str: 'x' } });

      // Transport contract: result.error is a ready-to-display string
      expect(typeof result.error).toBe('string');
      expect(result.error!.length).toBeGreaterThan(50); // Rich, not just "not found"
    });
  });

  // ── isError transport contract ──

  describe('transport isError contract', () => {
    it('success: false means transport MUST signal error to client', async () => {
      const svc = mockService([{ id: 'TASK-0001', title: 'T', description: 'content', status: 'open', created_at: '', updated_at: '' } as Entity]);
      const result = await editItem(svc, { id: 'TASK-0001', operation: { type: 'str_replace', old_str: 'MISSING', new_str: 'x' } });

      // This is the invariant all transports must respect:
      // MCP: return { content: [...], isError: true }
      // CLI: process.exit(1)
      // HTTP: 4xx status code
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('success: true means transport signals success', async () => {
      const svc = mockService([{ id: 'TASK-0001', title: 'T', description: 'hello world', status: 'open', created_at: '', updated_at: '' } as Entity]);
      const result = await editItem(svc, { id: 'TASK-0001', operation: { type: 'str_replace', old_str: 'hello', new_str: 'goodbye' } });

      expect(result.success).toBe(true);
      expect(result.message).toBeDefined();
      expect(result.error).toBeUndefined();
    });
  });
});
