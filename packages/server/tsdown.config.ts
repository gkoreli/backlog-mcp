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
  copy: [
    { from: '../viewer/dist/**', to: 'dist/viewer' },
  ],
});
