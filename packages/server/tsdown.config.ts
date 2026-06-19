import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/**/*.ts', '!src/**/*.test.ts', '!src/__tests__/**'],
  format: ['esm'],
  platform: 'node',
  target: 'node18',
  unbundle: true,
  deps: {
    alwaysBundle: ['@backlog-mcp/shared', '@backlog-mcp/memory'],
  },
  dts: false,
  clean: true,
  sourcemap: true,
  treeshake: true,
  logLevel: 'info',
  report: false,
  // Copy the built viewer into the server's dist for packaging. `from` is a
  // plain directory (NOT a glob) so tsdown's fsCopy does a recursive
  // structure-preserving cp — Vite emits hashed bundles under assets/ and the
  // emitted index.html references /assets/* (ADR 0110). `rename` sets the
  // destination folder name, so this lands at <outDir>/viewer (= dist/viewer).
  // (A `/**` glob would flatten subdirs — tsdown's flatten defaults to true —
  // dropping assets/ and 404'ing every /assets/* URL in prod.)
  copy: [{ from: '../viewer/dist', rename: 'viewer' }],
});
