import { beforeEach, describe, expect, it } from 'vitest';
import { SplitPaneState } from './split-pane-state.js';

describe('SplitPaneState home persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('retains the selection captured when the pane opens', () => {
    const state = new SplitPaneState();
    state.openActivity('TASK-0001', {
      home: 'project',
      projectRoot: '/repo',
    });

    expect(state.homeSelection.value).toEqual({
      home: 'project',
      projectRoot: '/repo',
    });
  });

  it('restores content only into the same home', () => {
    const original = new SplitPaneState();
    original.openMcpResource('mcp://backlog/tasks/TASK-0001.md', {
      home: 'project',
      projectRoot: '/repo',
    });

    const sameHome = new SplitPaneState();
    sameHome.restore({ home: 'project', projectRoot: '/repo' });
    expect(sameHome.activePane.value).toBe('mcp');
    expect(sameHome.mcpUri.value).toBe('mcp://backlog/tasks/TASK-0001.md');
    expect(sameHome.homeSelection.value).toEqual({
      home: 'project',
      projectRoot: '/repo',
    });

    const otherHome = new SplitPaneState();
    otherHome.restore({ home: 'project', projectRoot: '/other' });
    expect(otherHome.activePane.value).toBeNull();
  });

  it('persists the collision-candidate queue only within its selected home', () => {
    const original = new SplitPaneState();
    original.openCollisionCandidates({ home: 'project', projectRoot: '/repo' });

    const sameHome = new SplitPaneState();
    sameHome.restore({ home: 'project', projectRoot: '/repo' });
    expect(sameHome.activePane.value).toBe('collision-candidates');

    const otherHome = new SplitPaneState();
    otherHome.restore({ home: 'global' });
    expect(otherHome.activePane.value).toBeNull();
  });
});
