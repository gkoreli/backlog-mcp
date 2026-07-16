import {
  appendFileSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { demandCounts } from '../core/consolidation.js';
import { usageSeries } from '../core/usage-series.js';
import { MemoryUsageOverlay } from '../memory/memory-usage-overlay.js';

const NOW_ISO = '2026-07-16T12:00:00.000Z';
const NOW = Date.parse(NOW_ISO);

function controlDir(name: string): string {
  return join(tmpdir(), 'memory-usage-overlay', name, '.backlog-mcp');
}

function usageLogPath(projectControlDir: string): string {
  return join(projectControlDir, 'state', 'memory-usage.jsonl');
}

function appendRawLines(projectControlDir: string, lines: string[]): void {
  const logPath = usageLogPath(projectControlDir);
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, `${lines.join('\n')}\n`, 'utf-8');
}

describe('MemoryUsageOverlay', function describeMemoryUsageOverlay() {
  it('folds the latest valid summary per memory and ignores malformed checkpoints', function foldsValidSummaries() {
    const projectControlDir = controlDir('fold');
    appendRawLines(projectControlDir, [
      JSON.stringify({
        ts: '2026-07-15T12:00:00.000Z',
        type: 'usage_summary',
        memory_id: 'MEMO-0001',
        usage_count: 1,
      }),
      '{not json',
      JSON.stringify({
        ts: NOW_ISO,
        type: 'usage_summary',
        memory_id: 1,
        usage_count: 2,
      }),
      JSON.stringify({
        ts: NOW_ISO,
        type: 'usage_summary',
        memory_id: '',
        usage_count: 2,
      }),
      JSON.stringify({
        ts: NOW_ISO,
        type: 'usage_summary',
        memory_id: 'MEMO-0001',
        usage_count: -1,
      }),
      JSON.stringify({
        ts: NOW_ISO,
        type: 'usage_summary',
        memory_id: 'MEMO-0001',
        usage_count: 1.5,
      }),
      JSON.stringify({
        ts: NOW_ISO,
        type: 'usage_summary',
        memory_id: 'MEMO-0001',
        usage_count: 256,
      }),
      JSON.stringify({
        ts: NOW_ISO,
        type: 'usage_summary',
        memory_id: 'MEMO-0001',
        usage_count: 2,
      }),
      JSON.stringify({
        ts: 'not-a-date',
        type: 'usage_summary',
        memory_id: 'MEMO-0001',
        usage_count: 3,
      }),
      JSON.stringify({
        ts: NOW_ISO,
        type: 'usage_summary',
        memory_id: 'MEMO-0255',
        usage_count: 255,
      }),
      JSON.stringify({
        ts: NOW_ISO,
        type: 'usage_summary',
        memory_id: 'MEMO-0000',
        usage_count: 0,
      }),
    ]);

    const overlay = new MemoryUsageOverlay(projectControlDir);

    expect(overlay.get('MEMO-0001')).toEqual({
      usageCount: 2,
      lastUsedAt: NOW_ISO,
    });
    expect(overlay.get('MEMO-0255')).toEqual({
      usageCount: 255,
      lastUsedAt: NOW_ISO,
    });
    expect(overlay.get('MEMO-0000')).toEqual({
      usageCount: 0,
      lastUsedAt: NOW_ISO,
    });
    expect(overlay.get('MEMO-9999')).toBeUndefined();
  });

  it('appends the exact checkpoint shape and updates its folded cache', function appendsCheckpoint() {
    const projectControlDir = controlDir('set');
    const overlay = new MemoryUsageOverlay(projectControlDir);

    overlay.set('MEMO-0007', {
      usageCount: 5,
      lastUsedAt: NOW_ISO,
    });

    const lines = overlay.readLines();
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '{}')).toEqual({
      ts: NOW_ISO,
      type: 'usage_summary',
      memory_id: 'MEMO-0007',
      usage_count: 5,
    });
    expect(overlay.get('MEMO-0007')).toEqual({
      usageCount: 5,
      lastUsedAt: NOW_ISO,
    });
  });

  it('notices a checkpoint appended by another overlay process', function noticesExternalAppend() {
    const projectControlDir = controlDir('external-append');
    const overlay = new MemoryUsageOverlay(projectControlDir);
    overlay.set('MEMO-0001', {
      usageCount: 1,
      lastUsedAt: '2026-07-15T12:00:00.000Z',
    });
    expect(overlay.get('MEMO-0001')?.usageCount).toBe(1);

    appendRawLines(projectControlDir, [
      JSON.stringify({
        ts: NOW_ISO,
        type: 'usage_summary',
        memory_id: 'MEMO-0001',
        usage_count: 2,
      }),
    ]);

    expect(overlay.get('MEMO-0001')).toEqual({
      usageCount: 2,
      lastUsedAt: NOW_ISO,
    });
  });

  it('keeps audit lines unchanged and summary checkpoints structural-only', function preservesUsageFolds() {
    const projectControlDir = controlDir('structural-lines');
    const overlay = new MemoryUsageOverlay(projectControlDir);
    const recallLine = JSON.stringify({
      ts: NOW_ISO,
      type: 'recall',
      query: 'usage overlay',
      ids: ['MEMO-0001'],
    });
    const expandLine = JSON.stringify({
      ts: NOW_ISO,
      type: 'expand',
      id: 'MEMO-0001',
    });

    overlay.appendLine(recallLine);
    overlay.appendLine(expandLine);
    overlay.set('MEMO-0001', {
      usageCount: 1,
      lastUsedAt: NOW_ISO,
    });

    const lines = overlay.readLines();
    lines.push(JSON.stringify({
      ts: NOW_ISO,
      type: 'usage_summary',
      id: 'MEMO-0001',
      memory_id: 'MEMO-0001',
      usage_count: 1,
    }));
    expect(lines.slice(0, 2)).toEqual([recallLine, expandLine]);
    expect(demandCounts(lines, { windowDays: 1, now: NOW }).get('MEMO-0001'))
      .toBe(1);
    expect(usageSeries(lines, 'MEMO-0001', { windowDays: 1, now: NOW }))
      .toEqual([2]);
  });
});
