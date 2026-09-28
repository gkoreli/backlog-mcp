/**
 * ADR 0134 R1 layer rules as pure predicates over import edges, plus the
 * ratcheted allowlist of known violations (ADR 0134.1 R1). The allowlist may
 * only shrink: a fixed violation leaves the list in the same change.
 */
import type { ImportEdge, Layer } from './import-graph.js';

/** One enforceable rule. */
export interface LayerRule {
  id: string;
  description: string;
  violates: (edge: ImportEdge) => boolean;
}

/** Node modules that perform IO. `node:path`, `node:crypto`, `node:util` are pure (0134.1 R1.2). */
const IO_MODULE = /^(node:)?(fs|fs\/promises|os|child_process|net|http|https|worker_threads)$/u;
const ADAPTERS: ReadonlySet<Layer> = new Set(['cli', 'tools', 'server']);
const OUTSIDE_CORE: ReadonlySet<Layer> = new Set([
  'infrastructure', 'cli', 'tools', 'server', 'composition', 'utils',
]);
const OUTSIDE_INFRASTRUCTURE: ReadonlySet<Layer> = new Set(['cli', 'tools', 'server', 'composition']);

/** The HTTP app serves the MCP transport, so it mounts the MCP adapter (0134.1 R1.5). */
function isDeclaredAdapterDependency(from: Layer, to: Layer): boolean {
  return from === 'server' && to === 'tools';
}

export const LAYER_RULES: readonly LayerRule[] = [
  {
    id: 'core-io',
    description: 'ADR 0134 R1.1: core performs no IO',
    violates: function coreImportsIo(edge) {
      return edge.fromLayer === 'core' && IO_MODULE.test(edge.specifier);
    },
  },
  {
    id: 'core-outward',
    description: 'ADR 0134 R1.1/R1.2: core depends only on core, shared packages, and its own ports',
    violates: function coreImportsOutward(edge) {
      return edge.fromLayer === 'core' && OUTSIDE_CORE.has(edge.toLayer);
    },
  },
  {
    id: 'infrastructure-adapter',
    description: 'ADR 0134 R1: infrastructure never depends on adapters or composition',
    violates: function infrastructureImportsAdapter(edge) {
      return edge.fromLayer === 'infrastructure' && OUTSIDE_INFRASTRUCTURE.has(edge.toLayer);
    },
  },
  {
    id: 'adapter-adapter',
    description: 'ADR 0134 R1.3: adapters are peers and never import each other',
    violates: function adapterImportsAdapter(edge) {
      return ADAPTERS.has(edge.fromLayer)
        && ADAPTERS.has(edge.toLayer)
        && edge.fromLayer !== edge.toLayer
        && !isDeclaredAdapterDependency(edge.fromLayer, edge.toLayer);
    },
  },
];

/**
 * `utils/` is frozen (ADR 0134 R4.3): nothing new goes in, files leave as they
 * are touched. Removing a file from `utils/` removes it here.
 */
export const FROZEN_UTILS: readonly string[] = [
  'utils/date.ts',
  'utils/global-home-paths.ts',
  'utils/legacy-data-root.ts',
  'utils/logger.ts',
  'utils/paths.ts',
  'utils/ports.ts',
  'utils/process-exit.ts',
  'utils/viewer-cache.ts',
];

/**
 * Known violations at the start of enforcement, keyed `from -> specifier`.
 * ADR 0134.1 §Audit explains each group. Shrink only.
 */
export const KNOWN_VIOLATIONS: Readonly<Record<string, readonly string[]>> = {
  'core-io': [
    'core/backlog-home.ts -> node:fs',
    'core/backlog-home.ts -> node:os',
    'core/config.ts -> node:fs',
    'core/document-discovery.ts -> node:fs',
    'core/migrate-docs-native.ts -> node:fs',
  ],
  'core-outward': [
    'core/agent-attribution.ts -> ../storage/backlog-service.contract.js',
    'core/collision-candidates.ts -> ../storage/backlog-service.contract.js',
    'core/consolidation.ts -> ../storage/backlog-service.contract.js',
    'core/contradictions.ts -> ../storage/backlog-service.contract.js',
    'core/create.ts -> ../storage/backlog-service.contract.js',
    'core/delete.ts -> ../storage/backlog-service.contract.js',
    'core/desk.ts -> ../storage/backlog-service.contract.js',
    'core/document-address.ts -> ../storage/backlog-service.contract.js',
    'core/edit.ts -> ../storage/backlog-service.contract.js',
    'core/get.ts -> ../storage/backlog-service.contract.js',
    'core/home-read-coordinator.types.ts -> ../storage/backlog-service.contract.js',
    'core/identity-resolution.ts -> ../storage/local/git-runner.js',
    'core/list.ts -> ../storage/backlog-service.contract.js',
    'core/persist-new-entity.ts -> ../storage/backlog-service.contract.js',
    'core/search.ts -> ../storage/backlog-service.contract.js',
    'core/substrates/execute-substrate-intent.types.ts -> ../../storage/backlog-service.contract.js',
    'core/types.ts -> ../resources/manager.js',
    'core/update.ts -> ../storage/backlog-service.contract.js',
    'core/wakeup.ts -> ../memory/backlog-memory-store.js',
    'core/wakeup.ts -> ../storage/backlog-service.contract.js',
  ],
  'infrastructure-adapter': [
  ],
  'adapter-adapter': [
    'cli/runner.ts -> ../server/local-app-request-runtime.js',
    'cli/runner.ts -> ../server/local-runtime-request-resolver.js',
    'cli/runner.types.ts -> ../server/app-request-runtime.types.js',
  ],
};
