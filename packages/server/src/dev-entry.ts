/**
 * Vite dev entry (ADR 0110).
 *
 * Loaded via Vite's ssrLoadModule. Exports a Connect-compatible handler so the
 * vite.config plugin can mount it directly — no @hono imports needed at root.
 */
import { getRequestListener } from '@hono/node-server';
import { createNodeApp } from './server/node-app.js';

const app = createNodeApp({ skipStatic: true });
export const handler = getRequestListener(app.fetch);
