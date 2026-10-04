import { describe, expect, it, vi } from 'vitest';
import { recordGetUsage } from '../core/get-usage.js';
import { listContextGroups } from '../core/get-context/index.js';
import type { GetItem } from '../core/types.js';

describe('retrieval usage policy', function retrievalUsagePolicy() {
  const items: GetItem[] = [
    { id: 'MEMO-0001', content: '' },
    { id: 'MEMO-0002', content: null },
    { id: 'TASK-0001', content: 'task' },
    { id: 'README.md', content: 'resource', resource: { content: 'resource', mimeType: 'text/markdown' } },
  ];

  it('counts successful memory bodies and excludes resources and misses from context acts', async function successfulReadsOnly() {
    const usage = { recordExpand: vi.fn().mockResolvedValue(undefined), recordContextExpand: vi.fn() };
    await recordGetUsage(items, true, usage);
    expect(usage.recordExpand.mock.calls).toEqual([['MEMO-0001']]);
    expect(usage.recordContextExpand).toHaveBeenCalledWith(['MEMO-0001', 'TASK-0001']);
  });

  it('plain reads never become context acts', async function plainReads() {
    const usage = { recordExpand: vi.fn().mockResolvedValue(undefined), recordContextExpand: vi.fn() };
    await recordGetUsage(items, undefined, usage);
    expect(usage.recordExpand).toHaveBeenCalledOnce();
    expect(usage.recordContextExpand).not.toHaveBeenCalled();
  });

  it('keeps declared relation names and order even when they overlap a builtin role', function relationOrdering() {
    const stub = { id: 'REQ-0001', title: 'Constraint', type: 'requirement', compliance: 'violated', graph_depth: 2 };
    expect(listContextGroups({
      parent: stub,
      siblings: [],
      descendants: [stub],
      children: [stub],
      relations: { respects: [stub], children: [stub], empty: [] },
    })).toEqual([['children', [stub]], ['descendants', [stub]], ['respects', [stub]], ['children', [stub]]]);
  });
});
