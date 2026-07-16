import { afterEach, describe, expect, it } from 'vitest';
import { RuntimeEnvironment } from '../utils/paths.js';
import {
  LOCAL_SERVER_HOSTNAME,
  resolveViewerPort,
} from '../utils/ports.js';

describe('resolveViewerPort', () => {
  const originalPort = process.env.BACKLOG_VIEWER_PORT;

  afterEach(() => {
    if (originalPort === undefined) delete process.env.BACKLOG_VIEWER_PORT;
    else process.env.BACKLOG_VIEWER_PORT = originalPort;
  });

  it('defaults development servers to 3040', () => {
    delete process.env.BACKLOG_VIEWER_PORT;

    expect(resolveViewerPort(RuntimeEnvironment.Development)).toBe(3040);
  });

  it('defaults production servers to 3030', () => {
    delete process.env.BACKLOG_VIEWER_PORT;

    expect(resolveViewerPort(RuntimeEnvironment.Production)).toBe(3030);
  });

  it('lets BACKLOG_VIEWER_PORT override either default', () => {
    process.env.BACKLOG_VIEWER_PORT = '3050';

    expect(resolveViewerPort(RuntimeEnvironment.Development)).toBe(3050);
    expect(resolveViewerPort(RuntimeEnvironment.Production)).toBe(3050);
  });
});

describe('local server listener', function describeLocalListener() {
  it('binds only to loopback while project-root selection is trusted', function bindsLoopback() {
    expect(LOCAL_SERVER_HOSTNAME).toBe('127.0.0.1');
  });
});
