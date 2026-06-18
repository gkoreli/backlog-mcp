import { request } from 'node:http';
import { spawn } from 'node:child_process';
import { openSync, closeSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from '@/utils/paths.js';
import { isOlderVersion, parseVersionResponse } from '@/utils/version.js';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function isServerRunning(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = request({ host: 'localhost', port, path: '/version', method: 'GET' }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.end();
  });
}

async function getServerVersion(port: number): Promise<string | null> {
  return new Promise((resolve) => {
    const req = request({ host: 'localhost', port, path: '/version', method: 'GET' }, (res) => {
      if (res.statusCode !== 200) {
        resolve(null);
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(parseVersionResponse(data)));
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

async function spawnServer(port: number): Promise<void> {
  const serverPath = join(paths.distRoot, 'node-server.mjs');
  // Capture the detached server's stdout/stderr instead of discarding them
  // (stdio:'ignore'). Native crash dumps and console.error bypass the
  // structured logger; without a real fd they vanish and the bridge only
  // reports a lost connection. Append so restarts accumulate history.
  const logDir = join(paths.backlogDataDir, 'logs');
  mkdirSync(logDir, { recursive: true });
  const out = openSync(join(logDir, 'server.log'), 'a');
  const child = spawn(process.execPath, [serverPath], {
    detached: true,
    stdio: ['ignore', out, out],
    env: { ...process.env, BACKLOG_VIEWER_PORT: String(port) }
  });
  child.unref();
  // The child has inherited its own dup of the fd; close the parent's copy
  // so repeated respawns don't leak descriptors.
  closeSync(out);
}

async function shutdownServer(port: number): Promise<void> {
  return new Promise((resolve) => {
    const req = request({ host: 'localhost', port, path: '/shutdown', method: 'POST' }, () => {
      resolve();
    });
    req.on('error', () => resolve());
    req.end();
  });
}

async function waitForServer(port: number, timeout: number): Promise<void> {
  const start = Date.now();
  let delay = 100;
  
  while (Date.now() - start < timeout) {
    if (await isServerRunning(port)) return;
    await sleep(delay);
    delay = Math.min(delay * 1.5, 1000);
  }
  
  throw new Error(`Server failed to start within ${timeout}ms`);
}

export async function ensureServer(port: number): Promise<void> {
  const running = await isServerRunning(port);
  
  if (!running) {
    await spawnServer(port);
    await waitForServer(port, 10000);
    return;
  }
  
  const serverVersion = await getServerVersion(port);
  const ourVersion = paths.getVersion();
  // Resilient, monotonic upgrade: only replace the incumbent when OURS is
  // strictly newer. Never downgrade and never restart an equal-or-newer
  // server. This breaks the multi-bridge "version ping-pong" where a stale
  // (older npx) bridge and a newer local bridge each kill the other's server
  // on every connect — the flapping was what corrupted the stdio stream.
  if (serverVersion && isOlderVersion(serverVersion, ourVersion)) {
    await shutdownServer(port);
    await sleep(1000);
    await spawnServer(port);
    await waitForServer(port, 10000);
  }
}

export { isServerRunning, getServerVersion, shutdownServer };

