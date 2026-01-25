#!/usr/bin/env node

import { request } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf-8'));

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
      res.on('end', () => resolve(data.trim()));
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

async function spawnServer(port: number): Promise<void> {
  const serverPath = join(__dirname, '..', 'http-server.js');
  const child = spawn(process.execPath, [serverPath], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, BACKLOG_VIEWER_PORT: String(port) }
  });
  child.unref();
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

async function ensureServer(port: number): Promise<void> {
  const running = await isServerRunning(port);
  
  if (!running) {
    await spawnServer(port);
    await waitForServer(port, 10000);
    return;
  }
  
  const serverVersion = await getServerVersion(port);
  if (serverVersion !== pkg.version) {
    await shutdownServer(port);
    await sleep(1000);
    await spawnServer(port);
    await waitForServer(port, 10000);
  }
}

async function runBridge(port: number): Promise<void> {
  await ensureServer(port);
  
  const transport = new SSEClientTransport(new URL(`http://localhost:${port}/mcp`));
  const client = new Client({ name: 'backlog-mcp-bridge', version: pkg.version });
  
  await client.connect(transport);
  
  process.stdin.setEncoding('utf-8');
  let buffer = '';
  
  process.stdin.on('data', async (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const message = JSON.parse(line);
        
        // Route to appropriate client method based on JSON-RPC method
        let result;
        if (message.method === 'tools/list') {
          result = await client.listTools(message.params);
        } else if (message.method === 'tools/call') {
          result = await client.callTool(message.params);
        } else if (message.method === 'resources/list') {
          result = await client.listResources(message.params);
        } else if (message.method === 'resources/read') {
          result = await client.readResource(message.params);
        } else if (message.method === 'prompts/list') {
          result = await client.listPrompts(message.params);
        } else if (message.method === 'prompts/get') {
          result = await client.getPrompt(message.params);
        } else {
          // Unknown method - return error
          const errorResponse = {
            jsonrpc: '2.0',
            id: message.id,
            error: { code: -32601, message: `Method not found: ${message.method}` }
          };
          process.stdout.write(JSON.stringify(errorResponse) + '\n');
          continue;
        }
        
        const response = { jsonrpc: '2.0', id: message.id, result };
        process.stdout.write(JSON.stringify(response) + '\n');
      } catch (error: any) {
        const errorResponse = {
          jsonrpc: '2.0',
          error: { code: -32603, message: error.message || 'Internal error' },
          id: null
        };
        process.stdout.write(JSON.stringify(errorResponse) + '\n');
      }
    }
  });
}

const port = parseInt(process.env.BACKLOG_VIEWER_PORT || '3030');
runBridge(port).catch((error) => {
  console.error('Bridge error:', error);
  process.exit(1);
});
