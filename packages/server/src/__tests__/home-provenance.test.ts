import { describe, expect, it } from 'vitest';
import { createBacklogHome } from '../storage/local/backlog-home.js';
import { projectHomeProvenance } from '../core/home-provenance.js';

describe('projectHomeProvenance', function describeProjection() {
  it('projects a project home with presentation and source path', function projectsProject() {
    const home = createBacklogHome({ kind: 'project', root: '/Users/me/code/app' });
    expect(projectHomeProvenance(home, '/Users/me', 'tasks/TASK-0001-x.md')).toEqual({
      home: 'project',
      home_id: home.id,
      root: home.root,
      documents_dir: home.documentsDir,
      label: 'app',
      display_path: '~/code/app',
      source_path: 'tasks/TASK-0001-x.md',
    });
  });

  it('labels the global home and omits an absent source path', function projectsGlobal() {
    const home = createBacklogHome({ kind: 'global', root: '/Users/me/.backlog' });
    const provenance = projectHomeProvenance(home, '/Users/me');
    expect(provenance).toMatchObject({ home: 'global', label: 'global', display_path: '~/.backlog' });
    expect(provenance).not.toHaveProperty('source_path');
  });
});
