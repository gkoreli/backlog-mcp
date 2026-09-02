import { describe, expect, it } from 'vitest';
import { isDocumentAddress } from './document-address.js';

describe('isDocumentAddress (ADR 0129.1)', () => {
  it('accepts resource URIs and bare entity ids', () => {
    expect(isDocumentAddress('mcp://backlog/docs/adr/0001-x.md')).toBe(true);
    expect(isDocumentAddress('TASK-0092')).toBe(true);
    expect(isDocumentAddress('MEMO-0010')).toBe(true);
  });

  it('rejects plain paths and free text, which are not pane addresses', () => {
    expect(isDocumentAddress('docs/adr/0001-x.md')).toBe(false);
    expect(isDocumentAddress('activity:')).toBe(false);
    expect(isDocumentAddress('')).toBe(false);
  });
});
