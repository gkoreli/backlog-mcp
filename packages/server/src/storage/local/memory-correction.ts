/** Recoverable local execution; called only inside the docs-native home lock. */
import { readFileSync } from 'node:fs';
import type { AnyEntity, Memory } from '@backlog-mcp/shared';
import { MemoryCorrectionError } from '../../core/memory-correction.contract.js';
import { writeMarkdownFile } from './markdown-write.js';

export interface PreparedDocumentWrite {
  entity: AnyEntity;
  absolutePath: string;
  markdown: string;
  exclusive: boolean;
}

export interface PreparedMemoryCorrection {
  successor: PreparedDocumentWrite & { entity: Memory };
  closures: Array<{ beforeMarkdown: string; after: PreparedDocumentWrite }>;
}

/** Restore exact original bytes only when they still equal the bytes this plan wrote. */
export function executeMemoryCorrection(plan: PreparedMemoryCorrection): Memory[] {
  const completed: PreparedMemoryCorrection['closures'] = [];
  try {
    for (const closure of plan.closures) {
      publish(closure.after);
      completed.push(closure);
    }
    publish(plan.successor);
    return [...completed.map(function changed(closure) { return closure.after.entity as Memory; }), plan.successor.entity];
  } catch (cause) {
    const unrecoveredIds: string[] = [];
    for (const closure of [...completed].reverse()) {
      try {
        if (readFileSync(closure.after.absolutePath, 'utf8') !== closure.after.markdown) {
          throw new Error('Document changed during correction recovery');
        }
        writeMarkdownFile(closure.after.absolutePath, closure.beforeMarkdown, false);
      } catch { unrecoveredIds.push(closure.after.entity.id); }
    }
    throw new MemoryCorrectionError(unrecoveredIds.length === 0 ? 'rolled_back' : 'partial_failure',
      [...plan.closures.map(function id(closure) { return closure.after.entity.id; }), plan.successor.entity.id], unrecoveredIds, cause);
  }
}

function publish(write: PreparedDocumentWrite): void {
  writeMarkdownFile(write.absolutePath, write.markdown, write.exclusive);
}
