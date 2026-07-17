import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushEffects, provide, QueryClient, resetInjector } from '@nisli/core';
import { AppState } from '../services/app-state.js';
import { SplitPaneState } from '../services/split-pane-state.js';
import { deskDocumentUri } from './desk-page.js';
import type { DeskBriefing } from '../utils/api.js';

const briefing: DeskBriefing = {
  home: 'project',
  home_id: '/repo',
  items: [
    {
      id: 'REQ-0001',
      title: 'Store boundary holds',
      class: 'health',
      why_surfaced: 'Compliance "violated" with 2 violations, checked 2 days ago.',
      instruction: 'Restore requirement REQ-0001 ("Store boundary holds"): resolve TASK-0009, TASK-0010, then update its compliance and checked_at frontmatter.',
      age_days: 2,
    },
    {
      id: '["MEMO-0004","MEMO-0007"]',
      title: 'MEMO-0004 ↔ MEMO-0007: Deploy gate / Deploy gate',
      class: 'review',
      why_surfaced: 'Collision priority 0.912 clears the 0.772159 review threshold.',
      instruction: 'Adjudicate collision MEMO-0004 ↔ MEMO-0007: supersede one, merge them under a shared state_key, or mark distinct_from with a one-line rationale.',
    },
    {
      id: 'docs/adr/0107-history-truth.md',
      title: 'ADR 0107 — history vs truth',
      class: 'judge',
      why_surfaced: 'Status "Proposed" has awaited a ruling for 16 days.',
      instruction: 'Adjudicate docs/adr/0107-history-truth.md ("ADR 0107 — history vs truth"): rule on it and update its status frontmatter with the ruling and a one-line rationale.',
      age_days: 16,
      path: 'docs/adr/0107-history-truth.md',
      agent: 'granite',
    },
  ],
  omitted: { judge: 5, review: 0, read: 2, health: 0 },
  metadata: {
    generated_at: '2026-07-17T12:00:00.000Z',
    budget: 7,
    worktree: 'backlog-mcp @ feat/desk-v1, 2 behind main',
  },
};

let app: AppState;
let splitState: SplitPaneState;

function mount(): HTMLElement {
  const element = document.createElement('desk-page');
  document.body.appendChild(element);
  flushEffects();
  return element;
}

beforeEach(() => {
  resetInjector();
  document.body.innerHTML = '';
  history.replaceState(null, '', '/?view=desk&home=project&project_root=%2Frepo');
  app = new AppState();
  splitState = new SplitPaneState();
  provide(AppState, () => app);
  provide(SplitPaneState, () => splitState);
  provide(QueryClient, () => new QueryClient());
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => briefing })));
});

describe('the Desk page', () => {
  it('renders the server fold verbatim: class grouping, why-surfaced, chips, honest omission', async () => {
    const element = mount();

    await vi.waitFor(() => {
      expect(element.querySelectorAll('.desk-item')).toHaveLength(3);
    });
    // Fetch is home-scoped like every page.
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toContain('/api/desk');
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toContain('home=project');
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toContain('project_root=%2Frepo');

    // Class sections in the four-question order; items stay in server order.
    const sectionTitles = [...element.querySelectorAll('.desk-section-title')]
      .map((node) => node.textContent?.trim().split('\n')[0]?.trim());
    expect(sectionTitles?.[0]).toContain('Judge');
    expect(sectionTitles?.[1]).toContain('Review');
    expect(sectionTitles?.[2]).toContain('Read');
    expect(sectionTitles?.[3]).toContain('Health');

    // Every item carries its why-surfaced sentence.
    expect(element.textContent).toContain('Status "Proposed" has awaited a ruling for 16 days.');
    expect(element.textContent).toContain('Collision priority 0.912 clears the 0.772159 review threshold.');
    expect(element.textContent).toContain('Compliance "violated" with 2 violations, checked 2 days ago.');

    // Provenance chips: home on every item; agent and worktree when present.
    expect(element.querySelectorAll('.desk-chip--home')).toHaveLength(3);
    expect([...element.querySelectorAll('.desk-chip--home')][0]?.textContent).toBe('repo');
    expect(element.textContent).toContain('by granite');
    expect(element.textContent).toContain('backlog-mcp @ feat/desk-v1, 2 behind main');

    // Honest omission lines with counts; empty classes carry none.
    expect(element.textContent).toContain('5 more judge items not shown');
    expect(element.textContent).toContain('2 more read items not shown');
    expect(element.textContent).not.toContain('more review items');
    expect(element.textContent).not.toContain('more health items');

    // The budget line states the whole truth.
    expect(element.textContent).toContain('3 of ≤7 above the fold');
    expect(element.textContent).toContain('7 more waiting below');
  });

  it('offers exactly one copy-ready instruction per item and zero mutation affordances', async () => {
    const element = mount();

    await vi.waitFor(() => {
      expect(element.querySelectorAll('copy-button')).toHaveLength(3);
    });
    // Read-only law: the only interactive elements are copy buttons and
    // navigation links — nothing that writes.
    const buttons = [...element.querySelectorAll('button')];
    expect(buttons.every((button) => button.closest('copy-button') !== null || button.textContent?.includes('Copy'))).toBe(true);
    expect(element.querySelector('form')).toBeNull();
    expect(element.querySelector('input')).toBeNull();
    expect(element.querySelector('textarea')).toBeNull();
    // Only the one GET composed the page.
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('opens document items through the existing MCP deep-link grammar', async () => {
    const element = mount();

    await vi.waitFor(() => {
      expect(element.querySelectorAll('.desk-item-title')).toHaveLength(3);
    });
    const links = [...element.querySelectorAll<HTMLAnchorElement>('.desk-item-title')];
    const judgeLink = links.find((link) => link.textContent?.includes('ADR 0107'));
    judgeLink?.click();

    expect(splitState.mcpUri.value).toBe('mcp://backlog/docs/adr/0107-history-truth.md');
    expect(splitState.homeSelection.value).toEqual({ home: 'project', projectRoot: '/repo' });
    expect(app.view.value).toBeNull();
    expect(deskDocumentUri('docs/adr/0107-history-truth.md'))
      .toBe('mcp://backlog/docs/adr/0107-history-truth.md');
  });

  it('fails closed for a malformed home selection without fetching another home', () => {
    history.replaceState(null, '', '/?view=desk&home=global&project_root=%2Frepo');
    resetInjector();
    app = new AppState();
    splitState = new SplitPaneState();
    provide(AppState, () => app);
    provide(SplitPaneState, () => splitState);
    const element = mount();

    expect(element.textContent).toContain('home selection is invalid');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows the clear state proudly and reports unavailability honestly', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ...briefing,
        items: [],
        omitted: { judge: 0, review: 0, read: 0, health: 0 },
      }),
    })));
    const empty = mount();
    await vi.waitFor(() => {
      expect(empty.textContent).toContain('The Desk is clear');
    });

    empty.remove();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      json: async () => ({ error: 'desk offline' }),
    })));
    const unavailable = mount();
    await vi.waitFor(() => {
      expect(unavailable.textContent).toContain('The Desk is unavailable: desk offline');
    });
  });
});
