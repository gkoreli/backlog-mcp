/**
 * diff-parse.ts — Unified diff parser + line-pairing algorithm.
 *
 * Simplified port from pitlane's diff-parse (which was adapted from
 * Fredrika's 4-layer algorithm). We only implement layers 1-2 since
 * our diffs are small str_replace operations — non-adjacent matching
 * (layer 3) and char-edit refinement (layer 4) aren't needed.
 *
 * Framework-agnostic — pure functions, no DOM.
 */

import { diffWords } from 'diff';

// ── Types ───────────────────────────────────────────────────────────

export interface LineSegment {
  value: string;
  type: 'add' | 'del' | 'normal';
}

export type RenderRow =
  | { type: 'context'; content: string; oldLineNo: number; newLineNo: number }
  | { type: 'add'; content: string; newLineNo: number }
  | { type: 'del'; content: string; oldLineNo: number }
  | { type: 'modified'; oldLineNo: number; newLineNo: number; oldSegments: LineSegment[]; newSegments: LineSegment[] };

interface ParsedLine {
  type: 'context' | 'add' | 'del';
  content: string;
  oldLineNo: number | null;
  newLineNo: number | null;
}

// ── Parsing ─────────────────────────────────────────────────────────

/** Parse a unified diff string into render rows. */
export function parseDiff(unified: string): RenderRow[] {
  const lines = unified.split('\n');
  const parsed: ParsedLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    // Skip diff headers
    if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('diff ')) continue;

    // Hunk header
    const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      oldLine = parseInt(hunkMatch[1] ?? '0', 10);
      newLine = parseInt(hunkMatch[2] ?? '0', 10);
      continue;
    }

    if (line.startsWith('+')) {
      parsed.push({ type: 'add', content: line.slice(1), oldLineNo: null, newLineNo: newLine });
      newLine++;
    } else if (line.startsWith('-')) {
      parsed.push({ type: 'del', content: line.slice(1), oldLineNo: oldLine, newLineNo: null });
      oldLine++;
    } else if (line.startsWith(' ') || line === '') {
      parsed.push({ type: 'context', content: line.slice(1), oldLineNo: oldLine, newLineNo: newLine });
      oldLine++;
      newLine++;
    }
  }

  return mergeAdjacentLines(parsed);
}

// ── Layer 1+2: Adjacent pairing with similarity gate ────────────────

const MAX_CHANGE_RATIO = 0.6;

function calculateChangeRatio(a: string, b: string): number {
  if (a === b) return 0;
  const total = a.length + b.length;
  if (total === 0) return 0;
  const tokens = diffWords(a, b);
  let changed = 0;
  for (const t of tokens) {
    if (t.added || t.removed) changed += t.value.length;
  }
  return changed / total;
}

function buildSegments(oldText: string, newText: string): { oldSegments: LineSegment[]; newSegments: LineSegment[] } {
  const tokens = diffWords(oldText, newText);
  const oldSegs: LineSegment[] = [];
  const newSegs: LineSegment[] = [];

  for (const t of tokens) {
    if (t.added) {
      newSegs.push({ value: t.value, type: 'add' });
    } else if (t.removed) {
      oldSegs.push({ value: t.value, type: 'del' });
    } else {
      oldSegs.push({ value: t.value, type: 'normal' });
      newSegs.push({ value: t.value, type: 'normal' });
    }
  }
  return { oldSegments: oldSegs, newSegments: newSegs };
}

function mergeAdjacentLines(lines: ParsedLine[]): RenderRow[] {
  const out: RenderRow[] = [];
  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i]!;
    const next = lines[i + 1];

    if (cur.type === 'del' && next?.type === 'add' &&
        calculateChangeRatio(cur.content, next.content) <= MAX_CHANGE_RATIO) {
      const { oldSegments, newSegments } = buildSegments(cur.content, next.content);
      out.push({
        type: 'modified',
        oldLineNo: cur.oldLineNo!,
        newLineNo: next.newLineNo!,
        oldSegments,
        newSegments,
      });
      i++; // skip next
    } else if (cur.type === 'context') {
      out.push({ type: 'context', content: cur.content, oldLineNo: cur.oldLineNo!, newLineNo: cur.newLineNo! });
    } else if (cur.type === 'add') {
      out.push({ type: 'add', content: cur.content, newLineNo: cur.newLineNo! });
    } else {
      out.push({ type: 'del', content: cur.content, oldLineNo: cur.oldLineNo! });
    }
  }
  return out;
}
