import { describe, expect, it } from 'vitest';
import {
  parseDocumentAddress,
  resolveDocumentUri,
} from '../core/document-address.js';

describe('parseDocumentAddress (ADR 0129.1)', () => {
  it('keeps resource URIs as they are', () => {
    expect(parseDocumentAddress('mcp://backlog/docs/adr/0001-x.md'))
      .toEqual({ kind: 'resource', uri: 'mcp://backlog/docs/adr/0001-x.md' });
  });

  it('aliases root-relative paths to their resource URI', () => {
    expect(parseDocumentAddress('README.md'))
      .toEqual({ kind: 'resource', uri: 'mcp://backlog/README.md' });
    expect(parseDocumentAddress('./docs/adr/0001-x.md'))
      .toEqual({ kind: 'resource', uri: 'mcp://backlog/docs/adr/0001-x.md' });
    expect(parseDocumentAddress('/docs/notes/file.markdown'))
      .toEqual({ kind: 'resource', uri: 'mcp://backlog/docs/notes/file.markdown' });
  });

  it('keeps entity ids on the entity lane, including threaded ids', () => {
    expect(parseDocumentAddress('TASK-0092')).toEqual({ kind: 'entity', id: 'TASK-0092' });
    expect(parseDocumentAddress(' MEMO-0010 ')).toEqual({ kind: 'entity', id: 'MEMO-0010' });
    expect(parseDocumentAddress('ADR 0113.1')).toEqual({ kind: 'entity', id: 'ADR 0113.1' });
  });
});

describe('resolveDocumentUri (ADR 0129.1)', () => {
  it('returns resource URIs unchanged and never consults the service', () => {
    const service = { getResourceUri: () => { throw new Error('must not be called'); } };
    expect(resolveDocumentUri(service, { kind: 'resource', uri: 'mcp://backlog/README.md' }))
      .toBe('mcp://backlog/README.md');
  });

  it('follows an entity to its real document through the service', () => {
    const service = {
      getResourceUri: (id: string) => id === 'TASK-0092'
        ? 'mcp://backlog/docs/tasks/archive/TASK-0092-human-name.md'
        : null,
    };
    expect(resolveDocumentUri(service, { kind: 'entity', id: 'TASK-0092' }))
      .toBe('mcp://backlog/docs/tasks/archive/TASK-0092-human-name.md');
    expect(resolveDocumentUri(service, { kind: 'entity', id: 'TASK-9999' })).toBeNull();
  });

  it('fails closed when the service cannot resolve entities at all', () => {
    expect(resolveDocumentUri({}, { kind: 'entity', id: 'TASK-0092' })).toBeNull();
  });
});
