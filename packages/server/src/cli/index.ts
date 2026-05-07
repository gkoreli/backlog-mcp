#!/usr/bin/env node

import { Command } from 'commander';
import { paths } from '@/utils/paths.js';
import { isServerRunning, getServerVersion, shutdownServer } from './server-manager.js';
import { registerList } from './commands/list.js';
import { registerGet } from './commands/get.js';
import { registerCreate } from './commands/create.js';
import { registerUpdate } from './commands/update.js';
import { registerDelete } from './commands/delete.js';
import { registerSearch } from './commands/search.js';
import { registerContext } from './commands/context.js';
import { registerEdit } from './commands/edit.js';
import { registerWakeup } from './commands/wakeup.js';
import { registerRecall } from './commands/recall.js';

const program = new Command()
  .name('backlog-mcp')
  .description('Task management MCP server')
  .version(paths.getVersion())
  .option('--json', 'Output as JSON');

// --- Server management commands (existing behavior preserved) ---

program
  .command('serve')
  .description('Run as HTTP MCP server with viewer')
  .action(async () => { await import('../node-server.js'); });

program
  .command('status')
  .description('Check if server is running')
  .action(async () => {
    const port = parseInt(process.env.BACKLOG_VIEWER_PORT || '3030');
    const running = await isServerRunning(port);
    if (!running) { console.log('Server is not running'); process.exit(1); }
    try {
      const response = await fetch(`http://localhost:${port}/api/status`);
      const status = await response.json() as any;
      console.log(`Server is running on port ${status.port}`);
      console.log(`Version: ${status.version}`);
      console.log(`Data directory: ${status.dataDir}`);
      console.log(`Task count: ${status.taskCount}`);
      console.log(`Uptime: ${status.uptime}s`);
      console.log(`Viewer: http://localhost:${port}/`);
      console.log(`MCP endpoint: http://localhost:${port}/mcp`);
    } catch {
      const version = await getServerVersion(port);
      console.log(`Server is running on port ${port}`);
      console.log(`Version: ${version || 'unknown'}`);
      console.log(`Viewer: http://localhost:${port}/`);
      console.log(`MCP endpoint: http://localhost:${port}/mcp`);
    }
    process.exit(0);
  });

program
  .command('stop')
  .description('Stop the server')
  .action(async () => {
    const port = parseInt(process.env.BACKLOG_VIEWER_PORT || '3030');
    const running = await isServerRunning(port);
    if (!running) { console.log('Server is not running'); process.exit(0); }
    console.log(`Stopping server on port ${port}...`);
    await shutdownServer(port);
    console.log('Server stopped');
    process.exit(0);
  });

// --- Data commands (new) ---

registerList(program);
registerGet(program);
registerCreate(program);
registerUpdate(program);
registerDelete(program);
registerSearch(program);
registerContext(program);
registerEdit(program);
registerWakeup(program);
registerRecall(program);

// --- Aliases for common bare-word usage ---

program.command('version').description('Show version').action(() => {
  console.log(paths.getVersion());
});

program.command('help').description('Show help').action(() => {
  program.help();
});

// --- Default action: bridge mode (no subcommand) ---

program.action(async () => {
  await import('./bridge.js');
});

program.parse();
