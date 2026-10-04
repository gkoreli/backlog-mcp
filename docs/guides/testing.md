# Testing

Read this when adding, changing, or running tests, or investigating test failures.
These are active contributor instructions, reached from [AGENTS.md](../../AGENTS.md).

## Testing

### Philosophy

**Unit tests only. No integration tests.**

- Unit tests mock external dependencies (filesystem, network, etc.)
- Tests should be fast, deterministic, and isolated
- If tests touch real filesystem, they're not unit tests. The one exception:
  tests whose subject *is* the repository, such as `architecture.test.ts`
  (it reads the source tree) and the git probes (`identity-resolution`,
  `git-law-freshness`), read real files through
  `vi.importActual('node:fs')` and never write.

### How It Works

All tests use **memfs** for in-memory filesystem mocking, with the exception above.

1. `vitest.config.ts` loads `src/__tests__/helpers/setup.ts` globally (server package)
2. `setup.ts` mocks `node:fs` with memfs before any test runs
3. Tests call real production code (e.g., `storage.add()`)
4. Production code calls `writeFileSync`/`readFileSync` → intercepted by memfs → stored in RAM
5. Filesystem resets between test files (not between individual tests)

### Test Locations

- **Server:** `packages/server/src/__tests__/*.test.ts` and co-located `*.test.ts`.
- **Viewer:** `packages/viewer/**/*.test.ts`.

Use the test runner's summary for current counts.

```bash
pnpm test                                # All workspace tests
pnpm --filter backlog-mcp test           # Server only
pnpm --filter @backlog-mcp/viewer test   # Viewer only
```

### Rules

**DO:**

- Write unit tests that use the mocked fs automatically
- Create test data using production APIs (`storage.add()`, etc.)
- Use `beforeAll`/`afterAll` for setup/teardown within a test file
- Mock external modules explicitly with `vi.mock()` when needed
- Use `tmpdir()` for path strings — only fs operations are mocked

**DON'T:**

- Don't write custom fs mocks — use the global memfs setup
- Don't use `beforeEach` to reset filesystem (breaks `beforeAll` patterns)
- Don't rewrite tests to fit mocks — fix the mock instead

### Correct Patterns

```typescript
// Test using production APIs — memfs handles I/O
it('should create a task', () => {
  const task = createTask({ id: 'TASK-0001', title: 'Test' });
  storage.add(task);
  const retrieved = storage.get('TASK-0001');
  expect(retrieved?.title).toBe('Test');
});

// Mock paths module when needed
beforeEach(() => {
  vi.spyOn(paths, 'backlogDataDir', 'get').mockReturnValue('/test/data');
});

// Mock specific modules for isolation
vi.mock('../storage/backlog.js', () => ({
  storage: { list: vi.fn(), get: vi.fn() },
}));
```

### Debugging Test Failures

- **ENOENT** — file wasn't created in virtual fs before reading. Check `storage.add()` was called.
- **Cannot read properties of undefined** — module loaded before mock. Move `vi.mock()` to top of file.
- **Tests pass individually but fail together** — shared state. Filesystem resets per file, not per test.
