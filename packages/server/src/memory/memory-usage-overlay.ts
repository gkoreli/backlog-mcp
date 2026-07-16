import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  MemoryUsageSummary,
  MemoryUsageSummaryStore,
} from './memory-usage.contract.js';

const MAX_USAGE_COUNT = 255;
const USAGE_LOG_NAME = 'memory-usage.jsonl';

interface FoldedUsageSummary {
  id: string;
  summary: MemoryUsageSummary;
}

function isValidId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidUsageCount(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 0
    && value <= MAX_USAGE_COUNT;
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function parseUsageSummary(line: string): FoldedUsageSummary | undefined {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;

  const checkpoint = value as Record<string, unknown>;
  if (checkpoint.type !== 'usage_summary') return undefined;
  if (!isValidId(checkpoint.memory_id)) return undefined;
  if (!isValidUsageCount(checkpoint.usage_count)) return undefined;
  if (!isValidTimestamp(checkpoint.ts)) return undefined;

  return {
    id: checkpoint.memory_id,
    summary: {
      usageCount: checkpoint.usage_count,
      lastUsedAt: checkpoint.ts,
    },
  };
}

/**
 * Path-owned usage audit and summary overlay for one project home.
 *
 * Summary checkpoints share the existing audit JSONL. The latest valid
 * checkpoint for each memory wins; malformed and non-summary lines are
 * ignored by the summary fold.
 */
export class MemoryUsageOverlay implements MemoryUsageSummaryStore {
  private readonly logPath: string;
  private summaries = new Map<string, MemoryUsageSummary>();
  private observedFileSize: number | undefined;
  private cacheInitialized = false;

  constructor(controlDir: string) {
    this.logPath = join(controlDir, 'state', USAGE_LOG_NAME);
  }

  get(id: string): MemoryUsageSummary | undefined {
    this.refreshSummaries();
    const summary = this.summaries.get(id);
    return summary === undefined ? undefined : { ...summary };
  }

  set(id: string, summary: MemoryUsageSummary): void {
    if (!isValidId(id)) {
      throw new TypeError('Memory usage summary id must be a non-empty string');
    }
    if (!isValidUsageCount(summary.usageCount)) {
      throw new RangeError('Memory usage count must be an integer from 0 to 255');
    }

    const ts = summary.lastUsedAt ?? new Date().toISOString();
    if (!isValidTimestamp(ts)) {
      throw new TypeError('Memory usage timestamp must be parseable');
    }

    this.appendLine(JSON.stringify({
      ts,
      type: 'usage_summary',
      memory_id: id,
      usage_count: summary.usageCount,
    }));
  }

  /** Append one existing audit/checkpoint line without changing its shape. */
  appendLine(line: string): void {
    const cacheWasCurrent = this.refreshSummaries();
    const previousSize = this.observedFileSize ?? 0;
    const storedLine = `${line}\n`;

    mkdirSync(dirname(this.logPath), { recursive: true });
    appendFileSync(this.logPath, storedLine, 'utf-8');

    if (!cacheWasCurrent) return;
    const folded = parseUsageSummary(line);
    if (folded !== undefined) {
      this.summaries.set(folded.id, folded.summary);
    }
    this.observedFileSize = previousSize + Buffer.byteLength(storedLine);
  }

  /** Read raw non-empty JSONL lines for consolidation and usage series. */
  readLines(): string[] {
    try {
      return readFileSync(this.logPath, 'utf-8')
        .split('\n')
        .filter(function isNonEmpty(line) {
          return line.trim().length > 0;
        });
    } catch {
      return [];
    }
  }

  /**
   * Refresh only when the observed file size changes.
   *
   * The size is sampled before reading so an append racing with the read
   * leaves an older observed size and is noticed on the next access.
   */
  private refreshSummaries(): boolean {
    const fileSize = this.readFileSize();
    if (this.cacheInitialized && fileSize === this.observedFileSize) return true;
    if (fileSize === undefined) {
      this.summaries = new Map();
      this.observedFileSize = undefined;
      this.cacheInitialized = true;
      return true;
    }

    let lines: string[];
    try {
      lines = readFileSync(this.logPath, 'utf-8').split('\n');
    } catch {
      return false;
    }

    const summaries = new Map<string, MemoryUsageSummary>();
    for (const line of lines) {
      const folded = parseUsageSummary(line);
      if (folded !== undefined) {
        summaries.set(folded.id, folded.summary);
      }
    }
    this.summaries = summaries;
    this.observedFileSize = fileSize;
    this.cacheInitialized = true;
    return true;
  }

  private readFileSize(): number | undefined {
    try {
      return statSync(this.logPath).size;
    } catch {
      return undefined;
    }
  }
}
