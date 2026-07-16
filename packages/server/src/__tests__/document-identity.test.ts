import { describe, expect, it } from 'vitest';
import {
  normalizeDocumentSourcePath,
  parseDocumentIdentity,
} from '../core/document-identity.js';

describe('parseDocumentIdentity', () => {
  it('parses aime numeric, threaded, and prefixed document identities', () => {
    expect(parseDocumentIdentity({
      sourcePath: 'prompts/0001-tasks-and-vision.md',
    })).toEqual({
      sourcePath: 'prompts/0001-tasks-and-vision.md',
      pathKey: '0001',
      slug: 'tasks-and-vision',
    });

    expect(parseDocumentIdentity({
      sourcePath: 'adr/0023.1-uplift-driven-exploration-map.md',
    })).toEqual({
      sourcePath: 'adr/0023.1-uplift-driven-exploration-map.md',
      pathKey: '0023.1',
      slug: 'uplift-driven-exploration-map',
      threadRootKey: '0023',
      threadParentKey: '0023',
    });

    expect(parseDocumentIdentity({
      sourcePath: 'requirements/REQ-0001-identity-in-system-prompt.md',
    })).toEqual({
      sourcePath: 'requirements/REQ-0001-identity-in-system-prompt.md',
      pathKey: 'REQ-0001',
      slug: 'identity-in-system-prompt',
    });
  });

  it('derives deeper thread roots and immediate parents without number conversion', () => {
    expect(parseDocumentIdentity({
      sourcePath: 'adr/0092.03.001-derived-memory.md',
    })).toMatchObject({
      pathKey: '0092.03.001',
      threadRootKey: '0092',
      threadParentKey: '0092.03',
    });
  });

  it('derives thread structure for prefixed-number identities', () => {
    expect(parseDocumentIdentity({
      sourcePath: 'requirements/REQ-0001.02.003-threaded-requirement.md',
    })).toMatchObject({
      pathKey: 'REQ-0001.02.003',
      slug: 'threaded-requirement',
      threadRootKey: 'REQ-0001',
      threadParentKey: 'REQ-0001.02',
    });
  });

  it('preserves numeric and prefixed path keys when the descriptive slug is absent', () => {
    expect(parseDocumentIdentity({
      sourcePath: 'prompts/0001.md',
    })).toEqual({
      sourcePath: 'prompts/0001.md',
      pathKey: '0001',
    });
    expect(parseDocumentIdentity({
      sourcePath: 'requirements/REQ-0001.md',
    })).toEqual({
      sourcePath: 'requirements/REQ-0001.md',
      pathKey: 'REQ-0001',
    });
  });

  it('recognizes .markdown documents alongside .md documents', () => {
    expect(parseDocumentIdentity({
      sourcePath: 'adr/0023.1-uplift-map.markdown',
    })).toEqual({
      sourcePath: 'adr/0023.1-uplift-map.markdown',
      pathKey: '0023.1',
      slug: 'uplift-map',
      threadRootKey: '0023',
      threadParentKey: '0023',
    });
    expect(parseDocumentIdentity({
      sourcePath: 'requirements/REQ-0001.markdown',
    })).toEqual({
      sourcePath: 'requirements/REQ-0001.markdown',
      pathKey: 'REQ-0001',
    });
  });

  it('normalizes Windows separators before parsing and preserves the source path', () => {
    expect(parseDocumentIdentity({
      sourcePath: String.raw`adr\threads\0023.1-uplift-map.md`,
    })).toEqual({
      sourcePath: 'adr/threads/0023.1-uplift-map.md',
      pathKey: '0023.1',
      slug: 'uplift-map',
      threadRootKey: '0023',
      threadParentKey: '0023',
    });
    expect(normalizeDocumentSourcePath(String.raw`docs\\adr\..\prompts\0001-test.md`))
      .toBe('docs/prompts/0001-test.md');
  });

  it('keeps README and arbitrary files path-identified without a path key', () => {
    expect(parseDocumentIdentity({
      sourcePath: 'requirements/README.md',
    })).toEqual({
      sourcePath: 'requirements/README.md',
    });
    expect(parseDocumentIdentity({
      sourcePath: 'proposals/herdr-event-stream-continuity-v1.md',
    })).toEqual({
      sourcePath: 'proposals/herdr-event-stream-continuity-v1.md',
    });
    expect(parseDocumentIdentity({
      sourcePath: 'herdr-schema.json',
    })).toEqual({
      sourcePath: 'herdr-schema.json',
    });
  });

  it('retains only nonblank string frontmatter ids', () => {
    expect(parseDocumentIdentity({
      sourcePath: 'adr/0001-decision.md',
      declaredId: '  ADR 0001  ',
    })).toMatchObject({
      declaredId: 'ADR 0001',
    });
    expect(parseDocumentIdentity({
      sourcePath: 'adr/0001-decision.md',
      declaredId: '   ',
    })).not.toHaveProperty('declaredId');
    expect(parseDocumentIdentity({
      sourcePath: 'adr/0001-decision.md',
      declaredId: 1,
    })).not.toHaveProperty('declaredId');
  });

  it('propagates non-authoritative discovery chronology with provenance', () => {
    expect(parseDocumentIdentity({
      sourcePath: 'adr/0001-decision.md',
      observedDate: '2026-07-16T12:30:00.000Z',
      dateSource: 'git-first-add',
    })).toMatchObject({
      observedDate: '2026-07-16T12:30:00.000Z',
      dateSource: 'git-first-add',
    });
  });

  it('does not validate a declared id mismatch against the physical path key', () => {
    expect(parseDocumentIdentity({
      sourcePath: 'requirements/REQ-0001-identity.md',
      declaredId: 'REQ-9999',
    })).toMatchObject({
      pathKey: 'REQ-0001',
      declaredId: 'REQ-9999',
    });
  });
});
