/**
 * Vite dev entry (ADR 0110).
 *
 * Loaded via Vite's ssrLoadModule. Exports a Connect-compatible handler so the
 * vite.config plugin can mount it directly — no @hono imports needed at root.
 */
import { getRequestListener } from '@hono/node-server';
import { createDocsNativeDevRuntimeResolver } from './server/docs-native-dev-runtime.js';
import { createNodeApp } from './server/node-app.js';
import { LocalRuntimeRegistry } from './storage/local/local-runtime-registry.js';

/** Construct the Vite dev app with an injectable per-home runtime registry. */
export function createDevApp(
  env: Readonly<Record<string, string | undefined>> = process.env,
  registry = new LocalRuntimeRegistry(),
) {
  return createNodeApp({
    skipStatic: true,
    resolveRuntime: createDocsNativeDevRuntimeResolver(env, registry),
  });
}

const app = createDevApp();
export const handler = getRequestListener(app.fetch);
