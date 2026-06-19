import { defineConfig } from 'vite';

/**
 * Viewer build/dev config (ADR 0110).
 *
 * - DEV: Vite's unbundled native-ESM dev server with granular HMR. The viewer is
 *   served by Vite on its own port; backend routes are proxied to the backlog
 *   Hono server (dev default :3040). The page origin is Vite's, and
 *   `utils/api.ts` falls back to `window.location.origin`, so same-origin
 *   fetch/SSE works through the proxy with no client change.
 * - PROD: `vite build` (Rollup) emits content-hashed assets under `assets/` plus
 *   a rewritten `index.html`, copied into the server package and served by Hono
 *   (ADR 0108 cache policy: hashed assets immutable, index.html revalidated).
 *   Vite tree-shakes `import.meta.hot`, so zero HMR bytes reach prod.
 *
 * Vite is a build/dev-time devDependency only — never a runtime dependency of
 * the published `backlog-mcp` package.
 */

/** Backend (Hono) origin for the dev proxy. Dev server default port is 3040. */
const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3040';

/**
 * Backend HTTP route prefixes (enumerated from the Hono app) that the Vite dev
 * server must forward to the backlog server. Everything else (the SPA, source
 * modules, HMR) is served by Vite itself.
 */
const BACKEND_ROUTES = [
  '/tasks',
  '/operations',
  '/events', // SSE — http-proxy streams this; do not buffer
  '/search',
  '/resource',
  '/mcp',
  '/health',
  '/version',
  '/api',
  '/memory',
  '/open',
  '/shutdown',
  '/authorize',
  '/oauth',
  '/.well-known',
];

const proxy = Object.fromEntries(
  BACKEND_ROUTES.map((route) => [route, { target: BACKEND_URL, changeOrigin: true }]),
);

export default defineConfig({
  root: __dirname,
  // Mirror the esbuild `__API_URL__` define. Empty string ⇒ api.ts falls back to
  // window.location.origin (correct for both proxied dev and same-origin prod).
  define: {
    __API_URL__: JSON.stringify(process.env.API_URL ?? ''),
  },
  server: {
    port: Number(process.env.VITE_PORT) || 5173,
    strictPort: false,
    proxy,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    // All content-hashed bundle output lives under assets/; index.html stays at
    // the root as the single stable, revalidated entry (ADR 0108). The server's
    // cache classifier keys on the assets/ directory, so the hash alphabet is
    // irrelevant.
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
