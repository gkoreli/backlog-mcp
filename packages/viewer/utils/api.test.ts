import { describe, expect, it, vi } from 'vitest';
import {
  buildApiUrl,
  getHomeId,
  getHomeRequestId,
  getHomeRequestSelection,
  getHomeSelection,
  getProvenanceSelection,
  fetchCollisionCandidates,
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
    expect(getHomeRequestId({ home: 'global' })).toBe('global');
    expect(getHomeRequestId({
      home: 'project',
      projectRoot: '/repo',
    })).toBe('/repo');
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

  it('forwards malformed request selections unchanged with distinct cache identities', () => {
    const missingRoot = getHomeRequestSelection('project', null);
    const contradictory = getHomeRequestSelection('global', '/repo');
    const invalid = getHomeRequestSelection('invalid', '/repo');

    const missingRootUrl = new URL(buildApiUrl('/tasks', {}, missingRoot));
    expect(missingRootUrl.searchParams.get('home')).toBe('project');
    expect(missingRootUrl.searchParams.has('project_root')).toBe(false);

    const contradictoryUrl = new URL(buildApiUrl('/tasks', {}, contradictory));
    expect(contradictoryUrl.searchParams.get('home')).toBe('global');
    expect(contradictoryUrl.searchParams.get('project_root')).toBe('/repo');

    const invalidUrl = new URL(buildApiUrl('/tasks', {}, invalid));
    expect(invalidUrl.searchParams.get('home')).toBe('invalid');
    expect(invalidUrl.searchParams.get('project_root')).toBe('/repo');

    expect(new Set([
      getHomeRequestId(missingRoot),
      getHomeRequestId(contradictory),
      getHomeRequestId(invalid),
    ]).size).toBe(3);
  });

  it('requests the candidate queue in the selected home without changing server order', async () => {
    const payload = {
      pairs: [{ pair_id: 'worst-first' }, { pair_id: 'second' }],
      total_live_memories: 2,
      focal_count: 2,
      candidate_count: 2,
    };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => payload })));

    const result = await fetchCollisionCandidates({ home: 'project', projectRoot: '/repo' });

    expect(result.pairs.map((pair) => pair.pair_id)).toEqual(['worst-first', 'second']);
    const url = new URL(vi.mocked(fetch).mock.calls[0]?.[0] as string);
    expect(url.pathname).toBe('/memory/contradictions');
    expect(url.searchParams.get('candidates')).toBe('true');
    expect(url.searchParams.get('home')).toBe('project');
    expect(url.searchParams.get('project_root')).toBe('/repo');
  });
});
