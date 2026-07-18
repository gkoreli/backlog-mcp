import {
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs';
import {
  isAbsolute,
  join,
  resolve,
} from 'node:path';
import { isPathWithin } from '../core/backlog-home.js';
import { resolveContext } from '../core/config.js';
import { REQUIREMENT_TYPE } from '../core/requirements/constraint-stub.js';
import type { LocalRuntime } from '../storage/local/local-runtime.js';
import type { AppRequestRuntime } from './app-request-runtime.types.js';
import {
  createObservedRecencyReader,
  createWakeupGroundingReader,
} from './wakeup-grounding.js';
import {
  createDeskDocumentsReader,
  createEvaluationCandidatesReader,
} from './desk-grounding.js';

function containedFile(
  root: string,
  requestedPath: string,
): string | undefined {
  try {
    const candidate = isAbsolute(requestedPath)
      ? resolve(requestedPath)
      : resolve(root, requestedPath);
    if (!isPathWithin(root, candidate)) return undefined;

    const canonicalRoot = realpathSync(root);
    const canonicalFile = realpathSync(candidate);
    if (!isPathWithin(canonicalRoot, canonicalFile)) return undefined;
    return statSync(canonicalFile).isFile() ? canonicalFile : undefined;
  } catch {
    return undefined;
  }
}

function createReadLocalFile(runtime: LocalRuntime) {
  return function readLocalFile(filePath: string): string | null {
    const contained = containedFile(runtime.home.documentsDir, filePath);
    return contained === undefined ? null : readFileSync(contained, 'utf-8');
  };
}

function createResolveSourcePath(runtime: LocalRuntime) {
  return function resolveSourcePath(sourcePath: string): string {
    const contained = containedFile(runtime.home.root, sourcePath);
    if (contained === undefined) {
      throw new Error(
        `Source path must be a file inside backlog home ${runtime.home.root}: ${sourcePath}`,
      );
    }
    return readFileSync(contained, 'utf-8');
  };
}

/** Adapt one started local runtime to the dependencies consumed by Hono. */
export function createLocalAppRequestRuntime(
  runtime: LocalRuntime,
): AppRequestRuntime {
  const scopeRoot = resolveContext({ home: runtime.home, env: {} });
  return {
    home: runtime.home,
    service: runtime.service,
    operationLog: runtime.operationLogger,
    operationLogger: runtime.operationLogger,
    substrateRegistry: runtime.substrateRegistry,
    ...(scopeRoot === undefined ? {} : { scopeRoot }),
    eventBus: runtime.eventBus,
    memoryComposer: runtime.memoryComposer,
    mintMemoryEntry: function mintMemoryEntry(memory) {
      return runtime.memoryStore.toMemoryEntry(memory);
    },
    usageTracker: runtime.usageTracker,
    resourceManager: runtime.resourceManager,
    readLocalFile: createReadLocalFile(runtime),
    resolveSourcePath: createResolveSourcePath(runtime),
    getSourcePath: function getSourcePath(id) {
      return runtime.storage.getDocumentById(id)?.sourcePath;
    },
    readUsageLines: runtime.readUsageLines,
    identityPath: join(runtime.home.documentsDir, 'identity.md'),
    visionPath: join(runtime.home.documentsDir, 'NORTH-STAR.md'),
    readGrounding: createWakeupGroundingReader({
      home: runtime.home,
      countIndexedDocuments: function countIndexedDocuments() {
        return runtime.resourceManager.list().length;
      },
      observedRecency: createObservedRecencyReader(
        runtime.storage,
        runtime.home.documentsDir,
      ),
      // Law-shaped constraint sources (LATTICE W2): every requirement
      // document's path — compiled AND quarantined (a broken local copy
      // of the family's law is still the family's law diverging).
      listConstraintSourcePaths: function listConstraintSourcePaths() {
        const paths: string[] = [];
        for (const document of runtime.storage.iterateDocuments()) {
          if (document.entity.type === REQUIREMENT_TYPE) {
            paths.push(document.sourcePath);
          }
        }
        for (const quarantine of runtime.storage.listClaimQuarantines?.() ?? []) {
          if (quarantine.type === REQUIREMENT_TYPE) {
            paths.push(quarantine.sourcePath);
          }
        }
        return paths;
      },
    }),
    readDeskDocuments: createDeskDocumentsReader({
      home: runtime.home,
      listResources: function listResources() {
        return runtime.resourceManager.list();
      },
    }),
    readEvaluationCandidates: createEvaluationCandidatesReader(runtime.home),
    intentRegistrationMode: 'required',
    intentRegistry: runtime.substrateRegistry,
    intentWriteValidator: runtime.substrateRegistry,
  };
}
