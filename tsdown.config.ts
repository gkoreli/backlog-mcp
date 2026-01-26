import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/**/*.ts', '!src/**/*.test.ts', '!src/__tests__/**'],
  format: ['esm'],
  platform: 'node',
  target: 'node18',
  unbundle: true,
  skipNodeModulesBundle: true,
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  logLevel: 'info', // Show build progress
  report: false, // Hide detailed file size report
});
