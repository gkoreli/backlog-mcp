/**
 * Vite dev entry (ADR 0110).
 *
 * Loaded via Vite's ssrLoadModule. Exports a Connect-compatible handler so the
 * vite.config plugin can mount it directly — no @hono imports needed at root.
 */
import { getRequestListener } from '@hono/node-server';
import { createDevApp } from './server/dev-app.js';

const composition = await createDevApp();
const hot = (
  import.meta as ImportMeta & {
    hot?: { dispose(callback: () => void): void };
  }
).hot;
hot?.dispose(function closeDevRuntimes() {
  void composition.close();
});
export const handler = getRequestListener(composition.app.fetch);
