#!/usr/bin/env node

try { await import('dotenv/config'); } catch {}

import { startHttpServer } from './http-server.js';

const args = process.argv.slice(2);
const command = args[0];

if (command === 'serve') {
  // HTTP server mode
  const port = parseInt(process.env.BACKLOG_VIEWER_PORT || '3030');
  await startHttpServer(port);
} else if (command === '--help' || command === '-h') {
  console.log(`
backlog-mcp - Task management MCP server

Usage:
  backlog-mcp              Run as stdio MCP server (default, for kiro-cli)
  backlog-mcp serve        Run as HTTP MCP server with viewer
  backlog-mcp --help       Show this help

Environment variables:
  BACKLOG_DATA_DIR         Data directory path (default: ./data)
  BACKLOG_VIEWER_PORT      HTTP server port (default: 3030)
  `);
  process.exit(0);
} else {
  // Default: stdio mode (existing behavior)
  await import('./server.js');
}
