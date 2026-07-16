/**
 * url-state.test.ts — Tests for UrlState URL↔signal sync.
 *
 * Key invariant (ADR 0015): readUrl() sets signals from URL params,
 * which triggers the pushUrl effect, but pushUrl's URL comparison
 * guard (`url.href !== window.location.href`) prevents echo writes.
 * No `pushing` flag needed.
 *
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushEffects } from '@nisli/core';
import { AppState } from './app-state.js';
import { UrlState } from './url-state.js';

// Stub window.location and history for JSDOM
function setLocation(search: string) {
  const url = new URL(`http://localhost${search}`);
  Object.defineProperty(window, 'location', {
    value: { href: url.href, search: url.search },
    writable: true,
    configurable: true,
  });
}

describe('UrlState', () => {
  let pushStateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setLocation('/');
    localStorage.clear();
    pushStateSpy = vi.spyOn(history, 'pushState').mockImplementation(() => {});
  });

  it('readUrl sets signals from URL params', () => {
    setLocation('/?filter=done&type=epic&id=TASK-0001&q=hello&home=project&project_root=%2Frepo');
    const state = new UrlState();
    flushEffects();

    expect(state.filter.value).toBe('done');
    expect(state.type.value).toBe('epic');
    expect(state.id.value).toBe('TASK-0001');
    expect(state.q.value).toBe('hello');
    expect(state.home.value).toBe('project');
    expect(state.projectRoot.value).toBe('/repo');
  });

  it('defaults when URL has no params', () => {
    setLocation('/');
    const state = new UrlState();
    flushEffects();

    expect(state.filter.value).toBe('all');
    expect(state.type.value).toBe('all');
    expect(state.id.value).toBeNull();
    expect(state.q.value).toBeNull();
  });

  it('readUrl does not cause echo pushState (URL comparison guard)', () => {
    setLocation('/?filter=done&id=TASK-0001');
    const state = new UrlState();
    flushEffects();

    // readUrl sets signals → effect fires pushUrl → URL matches → no pushState
    expect(pushStateSpy).not.toHaveBeenCalled();
  });

  it('signal write triggers pushState when URL differs', () => {
    setLocation('/');
    const state = new UrlState();
    flushEffects();
    pushStateSpy.mockClear();

    state.id.value = 'TASK-0042';
    flushEffects();

    expect(pushStateSpy).toHaveBeenCalledTimes(1);
    const pushedUrl = String(pushStateSpy.mock.calls[0][2]);
    expect(pushedUrl).toContain('id=TASK-0042');
  });

  it('writes home selection to URL params', () => {
    const state = new UrlState();
    flushEffects();
    pushStateSpy.mockClear();

    state.home.value = 'project';
    state.projectRoot.value = '/repo with spaces';
    flushEffects();

    const pushedUrl = new URL(String(pushStateSpy.mock.calls[0]?.[2]));
    expect(pushedUrl.searchParams.get('home')).toBe('project');
    expect(pushedUrl.searchParams.get('project_root')).toBe('/repo with spaces');
  });

  it('AppState exposes the active selection and deterministic home id', () => {
    setLocation('/?project_root=%2Frepo');
    const state = new AppState();
    flushEffects();

    expect(state.homeSelection.value).toEqual({
      home: 'project',
      projectRoot: '/repo',
    });
    expect(state.homeId.value).toBe('/repo');
    expect(state.requestHomeSelection.value).toEqual({
      projectRoot: '/repo',
    });

    state.setHomeSelection({ home: 'global' });
    flushEffects();
    expect(state.homeSelection.value).toEqual({ home: 'global' });
    expect(state.homeId.value).toBe('global');
  });

  it('preserves invalid URL selection for fail-closed requests', () => {
    setLocation('/?home=invalid&project_root=%2Frepo');
    const state = new AppState();
    flushEffects();

    expect(state.home.value).toBe('invalid');
    expect(state.requestHomeSelection.value).toEqual({
      home: 'invalid',
      projectRoot: '/repo',
    });
    expect(state.homeSelection.value).toBeUndefined();

    const pushedUrl = new URL(window.location.href);
    expect(pushedUrl.searchParams.get('home')).toBe('invalid');
    expect(pushedUrl.searchParams.get('project_root')).toBe('/repo');
  });

  it('isolates and restores sidebar scope by request home identity', () => {
    const state = new AppState();
    flushEffects();

    state.scopeId.value = 'EPIC-LEGACY';
    flushEffects();
    expect(localStorage.getItem(
      `backlog:sidebar-scope:${state.requestHomeId.value}`,
    )).toBe('EPIC-LEGACY');

    state.setHomeSelection({
      home: 'project',
      projectRoot: '/repo',
    });
    flushEffects();
    expect(state.scopeId.value).toBeNull();

    state.scopeId.value = 'EPIC-PROJECT';
    flushEffects();

    state.setHomeSelection(undefined);
    flushEffects();
    expect(state.scopeId.value).toBe('EPIC-LEGACY');

    state.setHomeSelection({
      home: 'project',
      projectRoot: '/repo',
    });
    flushEffects();
    expect(state.scopeId.value).toBe('EPIC-PROJECT');
  });

  it('default values are omitted from URL', () => {
    setLocation('/');
    const state = new UrlState();
    flushEffects();
    pushStateSpy.mockClear();

    // Set non-default id, but keep filter/type at defaults
    state.id.value = 'EPIC-0001';
    flushEffects();

    const pushedUrl = new URL(String(pushStateSpy.mock.calls[0][2]));
    expect(pushedUrl.searchParams.has('filter')).toBe(false); // default, omitted
    expect(pushedUrl.searchParams.has('type')).toBe(false);   // default, omitted
    expect(pushedUrl.searchParams.get('id')).toBe('EPIC-0001');
  });
});
