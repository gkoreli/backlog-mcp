import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    // Vitest externalizes CJS by default; transform Zod to preserve named exports in Bun.
    server: { deps: { inline: ['zod'] } },
    setupFiles: ['./src/__tests__/helpers/setup.ts'],
  },
});
