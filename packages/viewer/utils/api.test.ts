import { describe, expect, it } from 'vitest';
import {
  buildApiUrl,
  getHomeId,
  getHomeSelection,
  getProvenanceSelection,
} from './api.js';

describe('viewer home API helpers', () => {
  it('preserves legacy URLs when no home is selected', () => {
    const url = new URL(buildApiUrl('/tasks', { filter: 'all' }));

    expect(url.pathname).toBe('/tasks');
    expect(url.searchParams.get('filter')).toBe('all');
    expect(url.searchParams.has('home')).toBe(false);
    expect(url.searchParams.has('project_root')).toBe(false);
  });

  it('adds global and project request selection params', () => {
    const globalUrl = new URL(buildApiUrl('/events', {}, { home: 'global' }));
    expect(globalUrl.searchParams.get('home')).toBe('global');
    expect(globalUrl.searchParams.has('project_root')).toBe(false);

    const projectUrl = new URL(buildApiUrl('/search', { q: 'docs native' }, {
      home: 'project',
      projectRoot: '/repo with spaces',
    }));
    expect(projectUrl.searchParams.get('home')).toBe('project');
    expect(projectUrl.searchParams.get('project_root')).toBe('/repo with spaces');
    expect(projectUrl.searchParams.get('q')).toBe('docs native');
  });

  it('uses one stable identity for URLs, query keys, and provenance', () => {
    expect(getHomeId(undefined)).toBe('legacy');
    expect(getHomeId({ home: 'global' })).toBe('global');
    expect(getHomeSelection(null, '/repo')).toEqual({
      home: 'project',
      projectRoot: '/repo',
    });
    expect(getProvenanceSelection({
      home: 'project',
      home_id: '/repo',
    })).toEqual({
      home: 'project',
      projectRoot: '/repo',
    });
  });
});
