import { describe, expect, it } from 'vitest';
import { createBacklogHome } from '../core/backlog-home.js';
import {
  describeDocumentLocation,
  projectHomeProvenance,
} from '../core/home-provenance.js';
import { createWriteProvenance } from '../composition/write-provenance.js';
import { formatWrite } from '../cli/commands/write-output.js';

const home = createBacklogHome({ kind: 'project', root: '/Users/me/code/app' });
const paths: Record<string, string> = {
  'TASK-0001': 'tasks/TASK-0001-first.md',
  'TASK-0002': 'tasks/TASK-0002-second.md',
};
function getSourcePath(id: string): string | undefined {
  return paths[id];
}

describe('createWriteProvenance (ADR 0134.1 R4.2)', function describeWriteProvenance() {
  const provenance = createWriteProvenance({ home, getSourcePath }, '/Users/me');

  it('gives one document flat provenance, like HTTP entity responses', function oneDocument() {
    expect(provenance.document('TASK-0001')).toEqual(
      projectHomeProvenance(home, '/Users/me', 'tasks/TASK-0001-first.md'),
    );
  });

  it('gives several documents the home once, then each file', function severalDocuments() {
    const result = provenance.documents(['TASK-0001', 'TASK-0002', 'TASK-0404']);
    expect(result).toMatchObject({ home: 'project', label: 'app', display_path: '~/code/app' });
    expect(result).not.toHaveProperty('source_path');
    expect(result.documents).toEqual([
      { id: 'TASK-0001', source_path: 'tasks/TASK-0001-first.md' },
      { id: 'TASK-0002', source_path: 'tasks/TASK-0002-second.md' },
      { id: 'TASK-0404' },
    ]);
  });

  it('adds nothing for a runtime without a home', function noHome() {
    const legacy = createWriteProvenance({}, '/Users/me');
    expect(legacy.document('TASK-0001')).toEqual({});
    expect(legacy.documents(['TASK-0001'])).toEqual({});
  });
});

describe('describeDocumentLocation (ADR 0134 R3.5)', function describeLocation() {
  it('names the project home and the file from the home root', function projectFile() {
    expect(describeDocumentLocation(
      projectHomeProvenance(home, '/Users/me', 'tasks/TASK-0001-first.md'),
    )).toBe('project home ~/code/app: docs/tasks/TASK-0001-first.md');
  });

  it('names the home alone when the file is unknown', function homeOnly() {
    expect(describeDocumentLocation(projectHomeProvenance(home, '/Users/me')))
      .toBe('project home ~/code/app');
  });

  it('names the global home', function globalHome() {
    const global = createBacklogHome({ kind: 'global', root: '/Users/me/.backlog' });
    expect(describeDocumentLocation(
      projectHomeProvenance(global, '/Users/me', 'memories/MEMO-0001.md'),
    )).toBe('global home: docs/memories/MEMO-0001.md');
  });

  it('says nothing without a home', function noHome() {
    expect(describeDocumentLocation({})).toBeUndefined();
  });
});

describe('formatWrite (CLI write output)', function describeFormatWrite() {
  it('keeps the first line and adds the location', function withLocation() {
    const text = formatWrite(
      'Updated TASK-0001',
      projectHomeProvenance(home, '/Users/me', 'tasks/TASK-0001-first.md'),
    );
    expect(text.split('\n')).toEqual([
      'Updated TASK-0001',
      '  project home ~/code/app: docs/tasks/TASK-0001-first.md',
    ]);
  });

  it('prints only the first line without provenance', function withoutLocation() {
    expect(formatWrite('Deleted TASK-0001', {})).toBe('Deleted TASK-0001');
  });
});
