import { describe, expect, it } from 'vitest';
import {
  applyDocsNativeDevDefaults,
  BACKLOG_DOCS_NATIVE_ENV_VAR,
  createDocsNativeDevRuntimeResolver,
} from '../server/docs-native-dev-runtime.js';

describe('docs-native dev runtime scaffolding', function describeDevScaffold() {
  it('is disabled unless the temporary flag is exactly one', function requiresFlag() {
    expect(BACKLOG_DOCS_NATIVE_ENV_VAR).toBe('BACKLOG_DOCS_NATIVE');
    expect(createDocsNativeDevRuntimeResolver({})).toBeUndefined();
    expect(createDocsNativeDevRuntimeResolver({
      BACKLOG_DOCS_NATIVE: 'true',
    })).toBeUndefined();
  });

  it('keeps explicit request selection ahead of process defaults', function prefersRequest() {
    expect(applyDocsNativeDevDefaults(
      { home: 'global' },
      {
        BACKLOG_HOME: 'project',
        BACKLOG_PROJECT_ROOT: '/workspace/default',
      },
    )).toEqual({ home: 'global' });
  });

  it('uses an explicit dev project root only for unscoped requests', function appliesProjectDefault() {
    expect(applyDocsNativeDevDefaults({}, {
      BACKLOG_PROJECT_ROOT: '/workspace/default',
    })).toEqual({
      home: 'project',
      projectRoot: '/workspace/default',
    });
  });

  it('preserves invalid defaults for the request validator to reject', function preservesInvalidDefault() {
    expect(applyDocsNativeDevDefaults({}, {
      BACKLOG_HOME: 'elsewhere',
    })).toEqual({ home: 'elsewhere' });
  });
});
