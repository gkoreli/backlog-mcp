#!/usr/bin/env node

try { await import('dotenv/config'); } catch {}

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import { nextTaskId } from './schema.js';
import { createTask, STATUSES, TASK_TYPES, type Task } from './schema.js';
import { storage } from './backlog.js';
import { writeResource, type Operation } from './resources/index.js';
import { readMcpResource } from './resource-reader.js';
import { resolveMcpUri, filePathToMcpUri } from './uri-resolver.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

// Session management
const sessions = new Map<string, SSEServerTransport>();

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'backlog-mcp',
    version: pkg.version,
  });

  // Register tools
  server.registerTool(
    'backlog_list',
    {
      description: 'List tasks from backlog. Returns most recently updated items first. Default: shows only active work (open/in_progress/blocked), limited to 20 items. Use counts=true to check if more items exist beyond the limit.',
      inputSchema: z.object({
        status: z.array(z.enum(STATUSES)).optional().describe('Filter by status. Options: open, in_progress, blocked, done, cancelled. Default: [open, in_progress, blocked]. Pass ["done"] to see completed work.'),
        type: z.enum(TASK_TYPES).optional().describe('Filter by type. Options: task, epic. Default: returns both. Use type="epic" to list only epics.'),
        epic_id: z.string().optional().describe('Filter tasks belonging to a specific epic. Example: epic_id="EPIC-0001"'),
        counts: z.boolean().optional().describe('Include global counts { total_tasks, total_epics, by_status } alongside results. Use this to detect if more items exist beyond the limit. Default: false'),
        limit: z.number().optional().describe('Max items to return. Default: 20. Increase if you need to see more items (e.g., limit=100 to list all epics).'),
      }),
    },
    async ({ status, type, epic_id, counts, limit }) => {
      const tasks = storage.list({ status, type, epic_id, limit });
      const list = tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, type: t.type ?? 'task', epic_id: t.epic_id }));
      const result: any = { tasks: list };
      if (counts) result.counts = storage.counts();
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    'backlog_get',
    {
      description: 'Get full task details by ID. Works for any task regardless of status.',
      inputSchema: z.object({
        id: z.union([z.string(), z.array(z.string())]).describe('Task ID like TASK-0001, or array for batch fetch'),
      }),
    },
    async ({ id }) => {
      const taskIds = Array.isArray(id) ? id : [id];
      if (taskIds.length === 0) {
        return { content: [{ type: 'text', text: 'Required: id' }], isError: true };
      }
      const results = taskIds.map((tid) => storage.getMarkdown(tid) || `Not found: ${tid}`);
      return { content: [{ type: 'text', text: results.join('\n\n---\n\n') }] };
    }
  );

  server.registerTool(
    'backlog_create',
    {
      description: 'Create a new task in the backlog.',
      inputSchema: z.object({
        title: z.string().describe('Task title'),
        description: z.string().optional().describe('Task description in markdown'),
        type: z.enum(TASK_TYPES).optional().describe('Type: task (default) or epic'),
        epic_id: z.string().optional().describe('Parent epic ID to link this task to'),
        references: z.array(z.object({ url: z.string(), title: z.string().optional() })).optional().describe('Reference links with optional titles'),
      }),
    },
    async ({ title, description, type, epic_id, references }) => {
      const id = nextTaskId(storage.getMaxId(type), type);
      const task = createTask({ id, title, description, type, epic_id, references });
      storage.add(task);
      return { content: [{ type: 'text', text: `Created ${task.id}` }] };
    }
  );

  server.registerTool(
    'backlog_update',
    {
      description: 'Update an existing task.',
      inputSchema: z.object({
        id: z.string().describe('Task ID to update'),
        title: z.string().optional().describe('New title'),
        description: z.string().optional().describe('New description'),
        status: z.enum(STATUSES).optional().describe('New status'),
        epic_id: z.union([z.string(), z.null()]).optional().describe('Parent epic ID (null to unlink)'),
        blocked_reason: z.array(z.string()).optional().describe('Reason if status is blocked'),
        evidence: z.array(z.string()).optional().describe('Proof of completion when marking done - links to PRs, docs, or notes'),
        references: z.array(z.object({ url: z.string(), title: z.string().optional() })).optional().describe('Reference links with optional titles'),
      }),
    },
    async ({ id, ...updates }) => {
      const task = storage.get(id);
      if (!task) return { content: [{ type: 'text', text: `Task ${id} not found` }], isError: true };
      Object.assign(task, updates, { updated_at: new Date().toISOString() });
      storage.save(task);
      return { content: [{ type: 'text', text: `Updated ${id}` }] };
    }
  );

  server.registerTool(
    'backlog_delete',
    {
      description: 'Permanently delete a task from the backlog.',
      inputSchema: z.object({
        id: z.string().describe('Task ID to delete'),
      }),
    },
    async ({ id }) => {
      storage.delete(id);
      return { content: [{ type: 'text', text: `Task ${id} deleted` }] };
    }
  );

  // Register resources
  server.registerResource(
    'Task File',
    'mcp://backlog/tasks/{taskId}/file',
    { mimeType: 'text/markdown', description: 'Task markdown file' },
    async (uri: URL) => {
      const { content, mimeType } = readMcpResource(uri.toString());
      return { contents: [{ uri: uri.toString(), mimeType, text: content }] };
    }
  );

  server.registerResource(
    'Task-Attached Resource',
    'mcp://backlog/resources/{taskId}/{filename}',
    { description: 'Task-attached resources (ADRs, design docs, etc.)' },
    async (uri: URL) => {
      const { content, mimeType } = readMcpResource(uri.toString());
      return { contents: [{ uri: uri.toString(), mimeType, text: content }] };
    }
  );

  server.registerResource(
    'Repository Resource',
    'mcp://backlog/resources/{path}',
    { description: 'Repository files (ADRs, source code, etc.)' },
    async (uri: URL) => {
      const { content, mimeType } = readMcpResource(uri.toString());
      return { contents: [{ uri: uri.toString(), mimeType, text: content }] };
    }
  );

  return server;
}

export async function startHttpServer(port: number = 3030): Promise<void> {
  const dataDir = process.env.BACKLOG_DATA_DIR ?? 'data';
  storage.init(dataDir);

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Version endpoint
    if (req.url === '/version' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(pkg.version);
      return;
    }

    // Shutdown endpoint
    if (req.url === '/shutdown' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Shutting down...');
      httpServer.close(() => {
        setTimeout(() => process.exit(0), 500);
      });
      return;
    }

    // MCP SSE endpoint
    if (req.url === '/mcp' && req.method === 'GET') {
      const transport = new SSEServerTransport('/mcp/message', res);
      const mcpServer = createMcpServer();
      sessions.set(transport.sessionId, transport);
      
      transport.onclose = () => {
        sessions.delete(transport.sessionId);
      };

      // Note: connect() calls transport.start() automatically
      await mcpServer.connect(transport);
      return;
    }

    // MCP message endpoint (POST)
    if (req.url?.startsWith('/mcp/message') && req.method === 'POST') {
      const sessionId = new URL(req.url, `http://${req.headers.host}`).searchParams.get('sessionId');
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Missing sessionId');
        return;
      }

      const transport = sessions.get(sessionId);
      if (!transport) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Session not found');
        return;
      }

      const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB
      let body = '';
      let size = 0;
      
      req.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_BODY_SIZE) {
          req.destroy();
          res.writeHead(413, { 'Content-Type': 'text/plain' });
          res.end('Payload too large');
          return;
        }
        body += chunk;
      });
      
      req.on('end', async () => {
        try {
          const message = JSON.parse(body);
          await transport.handlePostMessage(req, res, message);
        } catch (error) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Invalid JSON');
        }
      });
      return;
    }

    // Viewer endpoints
    if (req.url === '/' || req.url === '/index.html' || req.url?.startsWith('/?')) {
      const htmlPath = join(__dirname, '..', 'viewer', 'index.html');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(readFileSync(htmlPath));
      return;
    }

    // Static files
    const staticPaths: Record<string, string> = {
      '/main.js': join(__dirname, 'viewer', 'main.js'),
      '/styles.css': join(__dirname, '..', 'viewer', 'styles.css'),
      '/gradient-icons.svg': join(__dirname, '..', 'viewer', 'gradient-icons.svg'),
    };

    const filePath = staticPaths[req.url || ''];
    if (filePath && existsSync(filePath)) {
      const contentType = req.url?.endsWith('.js') ? 'application/javascript' :
                         req.url?.endsWith('.css') ? 'text/css' :
                         req.url?.endsWith('.svg') ? 'image/svg+xml' : 'text/plain';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(readFileSync(filePath));
      return;
    }

    // Task API
    if (req.url?.startsWith('/tasks')) {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const pathParts = url.pathname.split('/').filter(Boolean);

      if (pathParts.length === 1) {
        const filter = url.searchParams.get('filter') || 'active';
        const limit = parseInt(url.searchParams.get('limit') || '100');
        const status = filter === 'active' ? ['open', 'in_progress', 'blocked'] :
                      filter === 'done' ? ['done'] :
                      filter === 'all' ? undefined : undefined;
        const tasks = storage.list({ status: status as any, limit });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(tasks));
        return;
      }

      if (pathParts.length === 2 && pathParts[1]) {
        const taskId = pathParts[1];
        const task = storage.get(taskId);
        if (task) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(task));
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Task not found');
        }
        return;
      }
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  httpServer.listen(port, () => {
    console.error(`Backlog MCP HTTP server running on http://localhost:${port}`);
    console.error(`- Viewer: http://localhost:${port}/`);
    console.error(`- MCP endpoint: http://localhost:${port}/mcp`);
    console.error(`- Version: ${pkg.version}`);
  });
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = parseInt(process.env.BACKLOG_VIEWER_PORT || '3030');
  startHttpServer(port);
}
