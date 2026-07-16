import { beforeEach, describe, expect, it } from 'vitest';
import { RecentSearchesService } from './recent-searches-service.js';

describe('RecentSearchesService home isolation', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('deduplicates by home id and entity id', () => {
    const service = new RecentSearchesService();

    service.add({
      id: 'TASK-0001',
      title: 'Global task',
      type: 'task',
      selection: { home: 'global' },
    });
    service.add({
      id: 'TASK-0001',
      title: 'Project task',
      type: 'task',
      selection: { home: 'project', projectRoot: '/repo' },
    });
    service.add({
      id: 'TASK-0001',
      title: 'Updated project task',
      type: 'task',
      selection: { home: 'project', projectRoot: '/repo' },
    });

    expect(service.getAll()).toMatchObject([
      {
        id: 'TASK-0001',
        title: 'Updated project task',
        home_id: '/repo',
        selection: { home: 'project', projectRoot: '/repo' },
      },
      {
        id: 'TASK-0001',
        title: 'Global task',
        home_id: 'global',
        selection: { home: 'global' },
      },
    ]);
  });

  it('reloads persisted home selection', () => {
    const service = new RecentSearchesService();
    service.add({
      id: 'mcp://backlog/resources/docs%2Fguide.md',
      title: 'Guide',
      type: 'resource',
      selection: { home: 'project', projectRoot: '/repo' },
    });

    expect(new RecentSearchesService().getAll()[0]).toMatchObject({
      home_id: '/repo',
      selection: { home: 'project', projectRoot: '/repo' },
    });
  });
});
