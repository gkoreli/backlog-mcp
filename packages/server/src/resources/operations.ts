// Apply operations to text content

import type { Operation } from './types.js';

/** Find the most similar line in content to the first line of old_str */
function findFuzzyHint(content: string, old_str: string): string {
  const firstLine = old_str.split('\n')[0];
  const targetLine = firstLine ? firstLine.trim() : '';
  if (!targetLine) return '';
  const lines = content.split('\n');
  let best = '';
  let bestScore = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Count shared words
    const targetWords = new Set(targetLine.toLowerCase().split(/\s+/));
    const lineWords = trimmed.toLowerCase().split(/\s+/);
    const shared = lineWords.filter(w => targetWords.has(w)).length;
    const score = shared / Math.max(targetWords.size, lineWords.length);
    if (score > bestScore) { bestScore = score; best = trimmed; }
  }
  return bestScore > 0.3 ? best : '';
}

export function applyOperation(content: string, operation: Operation): string {
  switch (operation.type) {
    case 'str_replace': {
      const { old_str, new_str } = operation;
      if (!content.includes(old_str)) {
        const hint = findFuzzyHint(content, old_str);
        const lines = content.split('\n').slice(0, 10).map(l => `  ${l}`).join('\n');
        let msg = `str_replace failed: old_str not found in content.`;
        if (hint) msg += `\n\nDid you mean this line?\n  "${hint}"`;
        msg += `\n\nFirst 10 lines of actual content:\n${lines}`;
        throw new Error(msg);
      }
      // Check uniqueness - fail if old_str appears more than once
      const firstIndex = content.indexOf(old_str);
      const secondIndex = content.indexOf(old_str, firstIndex + 1);
      if (secondIndex !== -1) {
        throw new Error(`str_replace failed: old_str is not unique in file. Include more context to make it unique.`);
      }
      return content.replace(old_str, new_str);
    }

    case 'insert': {
      // insert_line: insert AFTER this line (1-based, like fs_write)
      const lines = content.split('\n');
      const lineNum = operation.insert_line;
      if (lineNum < 0 || lineNum > lines.length) {
        throw new Error(`insert failed: line ${lineNum} out of range (0-${lines.length})`);
      }
      lines.splice(lineNum, 0, operation.new_str);
      return lines.join('\n');
    }

    case 'append': {
      // Add newline if file doesn't end with one (like fs_write)
      const needsNewline = content.length > 0 && !content.endsWith('\n');
      return content + (needsNewline ? '\n' : '') + operation.new_str;
    }

    default:
      throw new Error(`Unknown operation type: ${(operation as any).type}`);
  }
}
