/**
 * diff-block.ts — Nisli factory component for rendering unified diffs.
 *
 * Uses our own diff-parse algorithm (ported from pitlane) with inline
 * word-level highlighting. No diff2html, no React.
 *
 * Themed via Tsa CSS variables.
 */

import { component, html, computed } from '@nisli/core';
import { parseDiff, type RenderRow, type LineSegment } from './diff-parse.js';
import { operationToDiff, type OperationEntry } from '../components/activity-utils.js';
import type { EditOperation } from '@backlog-mcp/shared';

export type DiffBlockProps = {
  operation: OperationEntry;
};

export const DiffBlock = component<DiffBlockProps>('diff-block', (props) => {
  const rows = computed(() => {
    const op = props.operation.value;
    if (!op) return [];
    const unified = buildUnifiedDiff(op);
    return unified ? parseDiff(unified) : [];
  });

  const rendered = computed(() => {
    const r = rows.value;
    if (r.length === 0) return '';
    return renderTable(r);
  });

  return html`<div class="diff-block" html:inner=${rendered}></div>`;
});

function buildUnifiedDiff(op: OperationEntry): string | null {
  const mergedOps = op.params._mergedOps as OperationEntry[] | undefined;
  const filename = op.targetFilename ?? 'file';

  if (mergedOps && mergedOps.length > 1) {
    let combined = '';
    for (const mergedOp of [...mergedOps].reverse()) {
      const operation = mergedOp.params.operation as EditOperation;
      const diff = operationToDiff(operation, filename);
      if (diff) combined += diff + '\n';
    }
    return combined || null;
  } else if (op.params.operation) {
    return operationToDiff(op.params.operation as EditOperation, filename);
  }
  return null;
}

function renderTable(rows: RenderRow[]): string {
  let out = '<table class="diff-table"><tbody>';
  for (const row of rows) {
    out += renderRow(row);
  }
  out += '</tbody></table>';
  return out;
}

function renderRow(row: RenderRow): string {
  switch (row.type) {
    case 'context':
      return `<tr class="diff-row diff-context"><td class="diff-gutter">${row.oldLineNo}</td><td class="diff-gutter">${row.newLineNo}</td><td class="diff-code">${esc(row.content)}</td></tr>`;
    case 'add':
      return `<tr class="diff-row diff-add"><td class="diff-gutter"></td><td class="diff-gutter">${row.newLineNo}</td><td class="diff-code">${esc(row.content)}</td></tr>`;
    case 'del':
      return `<tr class="diff-row diff-del"><td class="diff-gutter">${row.oldLineNo}</td><td class="diff-gutter"></td><td class="diff-code">${esc(row.content)}</td></tr>`;
    case 'modified':
      return (
        `<tr class="diff-row diff-del"><td class="diff-gutter">${row.oldLineNo}</td><td class="diff-gutter"></td><td class="diff-code">${renderSegments(row.oldSegments)}</td></tr>` +
        `<tr class="diff-row diff-add"><td class="diff-gutter"></td><td class="diff-gutter">${row.newLineNo}</td><td class="diff-code">${renderSegments(row.newSegments)}</td></tr>`
      );
  }
}

function renderSegments(segments: LineSegment[]): string {
  return segments.map(s => {
    if (s.type === 'normal') return esc(s.value);
    return `<span class="diff-inline-${s.type}">${esc(s.value)}</span>`;
  }).join('');
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
