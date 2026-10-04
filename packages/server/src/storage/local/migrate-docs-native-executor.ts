/** Execute trusted planner-produced operation data; this is not a serialized-plan input API.
 * TypeScript readonly does not freeze data. Callers own the plan between planning and execution.
 */
import { dirname, join, relative, resolve } from 'node:path';
import { isPathWithin } from '../../core/path-containment.js';
import { DocsNativeMigrationError, LEGACY_PROJECT_CONTROL_DIR } from '../../core/migrate-docs-native.js';
import { normalizedConfig, configSourceAbsolute } from '../../core/migrate-docs-native-config.js';
import { migrationSourceDigest } from '../../core/migrate-docs-native-source.js';
import type { DocsNativeMigrationConfig, DocsNativeMigrationMove, DocsNativeMigrationPlan, DocsNativeMigrationReport, DocsNativeMigrationFileSystem, DocsNativeMigrationDirectoryEntry } from '../../core/migrate-docs-native.types.js';

function missingDirectories(
  path: string,
  stopAt: string,
  fs: DocsNativeMigrationFileSystem,
): string[] {
  const directories: string[] = [];
  let current = path;
  while (current !== stopAt && !fs.exists(current)) {
    directories.push(current);
    current = dirname(current);
  }
  return directories;
}

function cleanupCreatedTargets(
  targets: readonly string[],
  directories: readonly string[],
  fs: DocsNativeMigrationFileSystem,
): void {
  for (const target of [...targets].reverse()) {
    try {
      fs.unlink(target);
    } catch {
      // Best effort: the error that caused rollback remains primary.
    }
  }
  for (const directory of [...directories].sort(function deepestFirst(left, right) {
    return right.length - left.length;
  })) {
    fs.removeEmptyDirectory(directory);
  }
}

function renderConfig(
  action: DocsNativeMigrationConfig,
  plan: DocsNativeMigrationPlan,
  fs: DocsNativeMigrationFileSystem,
  sourceContents: ReadonlyMap<string, Buffer>,
): Buffer {
  const snapshotFileSystem: DocsNativeMigrationFileSystem = {
    ...fs,
    readFile: function readSnapshot(path) {
      const content = sourceContents.get(path);
      if (content === undefined) {
        throw new Error(`Config source was not snapshotted: ${path}`);
      }
      return content;
    },
  };
  let merged: Record<string, unknown> = {};
  for (const source of action.sources) {
    const config = normalizedConfig(
      source,
      plan.legacyRoot,
      plan.homeRoot,
      snapshotFileSystem,
    );
    if (config === undefined) {
      throw new Error(`Config changed before migration: ${source.path}`);
    }
    merged = { ...merged, ...config };
  }
  return Buffer.from(`${JSON.stringify(merged, null, 2)}\n`);
}

function assertSourceUnchanged(
  sourcePath: string,
  absolutePath: string,
  expectedDigest: string,
  fs: DocsNativeMigrationFileSystem,
  root: string,
): Buffer {
  assertSafeSource(absolutePath, root, fs);
  const content = fs.readFile(absolutePath);
  if (migrationSourceDigest(content) !== expectedDigest) {
    throw new Error(
      `Legacy migration source changed after planning: ${sourcePath}`,
    );
  }
  return content;
}

function assertDestinationContained(
  plan: DocsNativeMigrationPlan,
  targetPath: string,
  fs: DocsNativeMigrationFileSystem,
): void {
  const root = fs.canonicalize(plan.homeRoot);
  const target = fs.canonicalize(join(plan.homeRoot, ...targetPath.split('/')));
  if (!isPathWithin(root, target)) {
    throw new Error(
      `Docs-native migration destination escapes its home: ${targetPath}`,
    );
  }
}

function restoreDeletedSources(
  deletedSources: ReadonlyMap<string, Buffer>,
  fs: DocsNativeMigrationFileSystem,
): void {
  for (const [source, content] of deletedSources) {
    try {
      fs.makeDirectory(dirname(source));
      fs.writeFileExclusive(source, content);
    } catch {
      // Best effort: the error that caused rollback remains primary.
    }
  }
}

function cleanupEmptySourceDirectories(
  sourcePaths: readonly string[],
  legacyRoot: string,
  includeLegacyRoot: boolean,
  fs: DocsNativeMigrationFileSystem,
): void {
  const directories = new Set<string>();
  for (const source of sourcePaths) {
    let current = dirname(source);
    while (current !== legacyRoot && isPathWithin(legacyRoot, current)) {
      directories.add(current);
      current = dirname(current);
    }
  }
  if (includeLegacyRoot) directories.add(legacyRoot);
  for (const directory of [...directories].sort(function deepestFirst(
    left,
    right,
  ) {
    return right.length - left.length;
  })) {
    fs.removeEmptyDirectory(directory);
  }
}

function cleanupEmptyLegacyTree(
  root: string,
  fs: DocsNativeMigrationFileSystem,
): void {
  if (!fs.exists(root) || fs.isSymbolicLink(root)) return;
  let entries: DocsNativeMigrationDirectoryEntry[];
  try {
    entries = fs.readDirectory(root);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      cleanupEmptyLegacyTree(join(root, entry.name), fs);
    }
  }
  fs.removeEmptyDirectory(root);
}

export function executeDocsNativeMigrationPlan(
  plan: DocsNativeMigrationPlan,
  fs: DocsNativeMigrationFileSystem,
): DocsNativeMigrationReport {
  if (plan.issues.length > 0) throw new DocsNativeMigrationError(plan.issues);
  assertPlanRoots(plan, fs);
  const moves = plan.actions.filter(
    (action): action is DocsNativeMigrationMove => action.kind === 'move',
  );
  const configs = plan.actions.filter(
    (action): action is DocsNativeMigrationConfig => action.kind === 'config',
  );
  const sourceContents = new Map<string, Buffer>();
  const renderedConfigs = new Map<DocsNativeMigrationConfig, Buffer>();

  for (const move of moves) {
    const source = join(plan.legacyRoot, ...move.sourcePath.split('/'));
    const target = join(plan.homeRoot, ...move.targetPath.split('/'));
    if (!fs.exists(source)) {
      throw new Error(`Legacy migration source changed before execution: ${move.sourcePath}`);
    }
    if (fs.exists(target)) {
      throw new Error(`Docs-native migration destination changed before execution: ${move.targetPath}`);
    }
    const expectedDigest = plan.sourceDigests[move.sourcePath];
    if (expectedDigest === undefined) {
      throw new Error(`Legacy migration source was not snapshotted: ${move.sourcePath}`);
    }
    sourceContents.set(
      source,
      assertSourceUnchanged(
        move.sourcePath,
        source,
        expectedDigest,
        fs,
        plan.legacyRoot,
      ),
    );
    assertDestinationContained(plan, move.targetPath, fs);
  }
  for (const config of configs) {
    const target = join(plan.homeRoot, ...config.targetPath.split('/'));
    for (const source of config.sources) {
      if (!fs.exists(configSourceAbsolute(
        source,
        plan.legacyRoot,
        plan.homeRoot,
      ))) {
        throw new Error(`Config source changed before execution: ${source.path}`);
      }
      const absoluteSource = configSourceAbsolute(
        source,
        plan.legacyRoot,
        plan.homeRoot,
      );
      assertSafeSource(absoluteSource, source.root === 'legacy' ? plan.legacyRoot : plan.homeRoot, fs);
      sourceContents.set(absoluteSource, fs.readFile(absoluteSource));
    }
    const targetIsSource = config.sources.some(function matchesTarget(source) {
      return configSourceAbsolute(
        source,
        plan.legacyRoot,
        plan.homeRoot,
      ) === target;
    });
    if (fs.exists(target) && !targetIsSource) {
      throw new Error(`Config destination changed before execution: ${config.targetPath}`);
    }
    assertDestinationContained(plan, config.targetPath, fs);
    renderedConfigs.set(
      config,
      renderConfig(config, plan, fs, sourceContents),
    );
  }

  const createdTargets: string[] = [];
  const createdDirectories = new Set<string>();
  const overwrittenTargets = new Map<string, Buffer>();
  const deletedSources = new Map<string, Buffer>();
  let movedConfigs = 0;
  try {
    for (const move of moves) {
      assertPlanRoots(plan, fs);
      assertDestinationContained(plan, move.targetPath, fs);
      const source = join(plan.legacyRoot, ...move.sourcePath.split('/'));
      const target = join(plan.homeRoot, ...move.targetPath.split('/'));
      const parent = dirname(target);
      for (const directory of missingDirectories(parent, plan.homeRoot, fs)) {
        createdDirectories.add(directory);
      }
      fs.makeDirectory(parent);
      const content = sourceContents.get(source);
      if (content === undefined) {
        throw new Error(`Legacy migration source was not snapshotted: ${move.sourcePath}`);
      }
      fs.writeFileExclusive(
        target,
        plan.targetContents[move.sourcePath] ?? content,
      );
      createdTargets.push(target);
    }
    for (const config of configs) {
      const target = join(plan.homeRoot, ...config.targetPath.split('/'));
      const parent = dirname(target);
      for (const directory of missingDirectories(parent, plan.homeRoot, fs)) {
        createdDirectories.add(directory);
      }
      fs.makeDirectory(parent);
      const content = renderedConfigs.get(config);
      if (content === undefined) {
        throw new Error(`Config was not prepared before migration: ${config.targetPath}`);
      }
      if (fs.exists(target)) {
        overwrittenTargets.set(target, fs.readFile(target));
        fs.writeFile(target, content);
      } else {
        fs.writeFileExclusive(target, content);
        createdTargets.push(target);
      }
    }

    for (const move of moves) {
      const source = join(plan.legacyRoot, ...move.sourcePath.split('/'));
      const expectedDigest = plan.sourceDigests[move.sourcePath];
      const content = sourceContents.get(source);
      if (expectedDigest === undefined || content === undefined) {
        throw new Error(`Legacy migration source was not snapshotted: ${move.sourcePath}`);
      }
      assertPlanRoots(plan, fs);
      assertSourceUnchanged(move.sourcePath, source, expectedDigest, fs, plan.legacyRoot);
      fs.unlink(source);
      deletedSources.set(source, content);
    }
    for (const config of configs) {
      const target = join(plan.homeRoot, ...config.targetPath.split('/'));
      for (const source of config.sources) {
        const absoluteSource = configSourceAbsolute(
          source,
          plan.legacyRoot,
          plan.homeRoot,
        );
        if (absoluteSource !== target) {
          const content = sourceContents.get(absoluteSource);
          if (content === undefined) {
            throw new Error(`Config source was not snapshotted: ${source.path}`);
          }
          assertPlanRoots(plan, fs);
          assertSafeSource(absoluteSource, source.root === 'legacy' ? plan.legacyRoot : plan.homeRoot, fs);
          if (migrationSourceDigest(fs.readFile(absoluteSource)) !== migrationSourceDigest(content)) {
            throw new Error(`Config source changed after planning: ${source.path}`);
          }
          fs.unlink(absoluteSource);
          deletedSources.set(absoluteSource, content);
          movedConfigs += 1;
        }
      }
    }
  } catch (error) {
    restoreDeletedSources(deletedSources, fs);
    for (const [target, content] of overwrittenTargets) {
      try {
        fs.writeFile(target, content);
      } catch {
        // Best effort: the error that caused rollback remains primary.
      }
    }
    cleanupCreatedTargets(
      createdTargets,
      [...createdDirectories],
      fs,
    );
    throw error;
  }

  const discards = plan.actions.filter(function isDiscard(action) {
    return action.kind === 'discard';
  });
  for (const discard of discards) {
    const root = discard.root === 'legacy' ? plan.legacyRoot : plan.homeRoot;
    fs.removeTree(join(root, ...discard.path.split('/')));
  }
  cleanupEmptySourceDirectories(
    [...deletedSources.keys()],
    plan.legacyRoot,
    plan.homeKind === 'project',
    fs,
  );
  if (plan.homeKind === 'project') {
    cleanupEmptyLegacyTree(plan.legacyRoot, fs);
  } else {
    for (const directory of [
      'tasks',
      'resources',
      '.internal',
      'logs',
      LEGACY_PROJECT_CONTROL_DIR,
    ]) {
      cleanupEmptyLegacyTree(join(plan.legacyRoot, directory), fs);
    }
  }

  return {
    dryRun: false,
    actions: plan.actions,
    moved: moves.length + movedConfigs,
    rewritten: configs.length + Object.keys(plan.targetContents).length,
    discarded: discards.length,
  };
}


/** Reject replaced roots, including symlinked ancestors, before effects or source deletion. */
function assertPlanRoots(plan: DocsNativeMigrationPlan, fs: DocsNativeMigrationFileSystem): void {
  if (plan.canonicalHomeRoot === undefined || plan.canonicalLegacyRoot === undefined
    || fs.canonicalize(plan.homeRoot) !== plan.canonicalHomeRoot
    || fs.canonicalize(plan.legacyRoot) !== plan.canonicalLegacyRoot) {
    throw new Error('Migration roots changed after planning or were not captured by the planner');
  }
}

/** Native replacement by any symlink must not turn a planned source into another file. */
function assertSafeSource(path: string, root: string, fs: DocsNativeMigrationFileSystem): void {
  const expected = resolve(fs.canonicalize(root), relative(root, path));
  if (fs.isSymbolicLink(path) || fs.realpath(path) !== expected) {
    throw new Error(`Migration source became a symbolic link after planning: ${path}`);
  }
}
