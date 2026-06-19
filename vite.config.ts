import { defineConfig, loadEnv, searchForWorkspaceRoot } from 'vite';
import { resolve } from 'node:path';
import tsconfigPaths from 'vite-tsconfig-paths';
import { nisliHmr } from '@nisli/core/vite-hmr';

const viewerRoot = resolve(__dirname, 'packages/viewer');
const serverTsconfig = resolve(__dirname, 'packages/server/tsconfig.json');
const devEntry = resolve(__dirname, 'packages/server/src/dev-entry.ts');

export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, __dirname, ''));

  return {
    root: viewerRoot,
    appType: 'custom',
    plugins: [
      tsconfigPaths({ projects: [serverTsconfig] }),
      nisliHmr(),
      {
        name: 'hono-dev-backend',
        configureServer(server) {
          return () => {
            // Serve the SPA shell for / (with optional query string for viewer routing)
            server.middlewares.use(async (req, res, next) => {
              const url = req.url ?? '';
              if (url === '/' || url.startsWith('/?')) {
                const html = await server.transformIndexHtml(url,
                  (await import('fs')).readFileSync(resolve(viewerRoot, 'index.html'), 'utf-8'));
                res.setHeader('content-type', 'text/html');
                res.end(html);
              } else {
                next();
              }
            });
            // Everything else (API/SSE/MCP) → Hono
            server.middlewares.use(async (req, res) => {
              const { handler } = await server.ssrLoadModule(devEntry);
              handler(req, res);
            });
          };
        },
      },
    ],
    define: {
      __API_URL__: JSON.stringify(process.env.API_URL ?? ''),
    },
    server: {
      port: Number(process.env.VITE_PORT) || 5173,
      strictPort: false,
      fs: { allow: [searchForWorkspaceRoot(__dirname)] },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: true,
      assetsInlineLimit: 0,
      assetsDir: 'assets',
      rollupOptions: {
        output: {
          entryFileNames: 'assets/[name]-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
    },
  };
});
