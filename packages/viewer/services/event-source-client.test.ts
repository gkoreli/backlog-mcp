import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  backlogEvents,
  type BacklogEvent,
} from './event-source-client.js';

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly url: string;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  closed = false;

  constructor(url: string | URL) {
    this.url = String(url);
    FakeEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }
}

describe('BacklogEvents home connection', () => {
  beforeEach(() => {
    backlogEvents.disconnect();
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
  });

  it('reconnects for a different home without losing listeners', () => {
    const received: BacklogEvent[] = [];
    const listener = (event: BacklogEvent) => received.push(event);
    backlogEvents.onChange(listener);

    backlogEvents.connect({ home: 'project', projectRoot: '/repo' });
    const projectSource = FakeEventSource.instances[0];
    expect(projectSource).toBeDefined();
    expect(new URL(projectSource?.url ?? '').searchParams.get('project_root')).toBe('/repo');

    backlogEvents.connect({ home: 'global' });
    const globalSource = FakeEventSource.instances[1];
    expect(projectSource?.closed).toBe(true);
    expect(new URL(globalSource?.url ?? '').searchParams.get('home')).toBe('global');

    globalSource?.onmessage?.({
      data: JSON.stringify({
        seq: 1,
        type: 'task_changed',
        id: 'TASK-0001',
        tool: 'backlog_update',
        actor: 'user',
        ts: '2026-07-16T00:00:00.000Z',
      }),
    } as MessageEvent<string>);
    expect(received).toHaveLength(1);

    backlogEvents.offChange(listener);
  });

  it('does not reconnect when the home identity is unchanged', () => {
    backlogEvents.connect({ home: 'project', projectRoot: '/repo' });
    backlogEvents.connect({ home: 'project', projectRoot: '/repo' });

    expect(FakeEventSource.instances).toHaveLength(1);
  });
});
