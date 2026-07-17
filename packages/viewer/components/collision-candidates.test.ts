import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushEffects, provide, resetInjector } from '@nisli/core';
import { AppState } from '../services/app-state.js';
import {
  backlogEvents,
  type BacklogEvent,
  type ChangeCallback,
} from '../services/event-source-client.js';
import { SplitPaneState } from '../services/split-pane-state.js';
import { collisionCandidateUri } from './collision-candidates.js';

const queue = {
  pairs: [
    {
      pair_id: '["MEMO-0002","MEMO-0003"]',
      pair_priority: 0.91,
      signals: { neighbor_rank: 1, lexical_overlap: 0.7, scope: 1, epistemic_shape: 1 },
      members: [
        { id: 'MEMO-0002', title: 'Second', digest: 'second digest', entity_refs: [], tags: [] },
        { id: 'MEMO-0003', title: 'Third', digest: 'third digest', entity_refs: [], tags: [] },
      ],
    },
    {
      pair_id: '["MEMO-0001","MEMO-0004"]',
      pair_priority: 0.12,
      signals: { neighbor_rank: 0.5, lexical_overlap: 0.2, scope: 0.2, epistemic_shape: 0.5 },
      members: [
        { id: 'MEMO-0001', title: 'First', digest: 'first digest', entity_refs: [], tags: [] },
        { id: 'MEMO-0004', title: 'Fourth', digest: 'fourth digest', entity_refs: [], tags: [] },
      ],
    },
  ],
  total_live_memories: 4,
  focal_count: 4,
  candidate_count: 2,
};

let app: AppState;
let splitState: SplitPaneState;

beforeEach(() => {
  resetInjector();
  document.body.innerHTML = '';
  history.replaceState(null, '', '/?home=project&project_root=%2Frepo');
  app = new AppState();
  splitState = new SplitPaneState();
  provide(AppState, () => app);
  provide(SplitPaneState, () => splitState);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => queue })));
});

describe('collision candidate queue', () => {
  it('preserves server pair order and opens member deep links in the selected home', async () => {
    const element = document.createElement('collision-candidates');
    document.body.appendChild(element);
    flushEffects();

    await vi.waitFor(() => {
      expect([...element.querySelectorAll('.collision-priority')].map((el) => el.textContent))
        .toEqual(['review priority 0.910', 'review priority 0.120']);
    });
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toContain('home=project');
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toContain('project_root=%2Frepo');

    (element.querySelector('.collision-member-link') as HTMLAnchorElement).click();
    expect(splitState.mcpUri.value).toBe('mcp://backlog/tasks/MEMO-0002.md');
    expect(splitState.homeSelection.value).toEqual({ home: 'project', projectRoot: '/repo' });
  });

  it('fails closed for a malformed home selection without fetching another home', () => {
    history.replaceState(null, '', '/?home=global&project_root=%2Frepo');
    resetInjector();
    app = new AppState();
    splitState = new SplitPaneState();
    provide(AppState, () => app);
    provide(SplitPaneState, () => splitState);
    const element = document.createElement('collision-candidates');
    document.body.appendChild(element);
    flushEffects();

    expect(element.textContent).toContain('home selection is invalid');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses the existing MCP URL form for memory links', () => {
    expect(collisionCandidateUri('MEMO-0001')).toBe('mcp://backlog/tasks/MEMO-0001.md');
  });

  it('reports empty and unavailable queues honestly', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ ...queue, pairs: [], candidate_count: 0 }),
    })));
    const empty = document.createElement('collision-candidates');
    document.body.appendChild(empty);
    flushEffects();
    await vi.waitFor(() => {
      expect(empty.textContent).toContain('No collision candidates are currently queued');
    });

    empty.remove();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      json: async () => ({ error: 'search offline' }),
    })));
    const unavailable = document.createElement('collision-candidates');
    document.body.appendChild(unavailable);
    flushEffects();
    await vi.waitFor(() => {
      expect(unavailable.textContent).toContain('Collision candidates are unavailable: search offline');
    });
  });

  it('refetches the active home queue after an entity change event', async () => {
    let changeHandler: ChangeCallback | undefined;
    vi.spyOn(backlogEvents, 'onChange').mockImplementation(function captureChange(handler) {
      changeHandler = handler;
    });
    splitState.openCollisionCandidates({ home: 'project', projectRoot: '/repo' });
    const element = document.createElement('collision-candidates');
    document.body.appendChild(element);
    flushEffects();
    await vi.waitFor(() => {
      expect(element.querySelectorAll('.collision-priority')).toHaveLength(2);
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(splitState.activePane.value).toBe('collision-candidates');

    const event: BacklogEvent = {
      seq: 1,
      type: 'task_changed',
      id: 'MEMO-0001',
      tool: 'backlog_update',
      actor: 'user',
      ts: '2026-07-16T00:00:00.000Z',
    };
    expect(changeHandler).toBeDefined();
    changeHandler?.(event);
    flushEffects();

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });
});
