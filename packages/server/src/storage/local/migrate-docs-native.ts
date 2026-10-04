import { createMigrationFileSystem } from './migrate-docs-native-filesystem.js';
/** Local one-shot migration entrypoints; domain planning never supplies ambient I/O. */
import { discoverDocuments } from './document-discovery.js';
import { assertDocsNativeMigrationComplete as assertWith, planDocsNativeMigration as planWith, DocsNativeMigrationError } from '../../core/migrate-docs-native.js';
import type { BacklogHome } from '../../core/backlog-home.types.js';
import type { AssertDocsNativeMigrationCompleteOptions, PlanDocsNativeMigrationParams, MigrateDocsNativeParams, DocsNativeMigrationReport } from '../../core/migrate-docs-native.types.js';
import { executeDocsNativeMigrationPlan } from './migrate-docs-native-executor.js';
export { DocsNativeMigrationError, DocsNativeMigrationRequiredError } from '../../core/migrate-docs-native.js';

/** Refuse to serve an unmigrated home using explicit local reads. */
export function assertDocsNativeMigrationComplete(home: BacklogHome, options: AssertDocsNativeMigrationCompleteOptions = {}): void {
  assertWith(home, { ...options, fileSystem: createMigrationFileSystem(options.fileSystem) });
}
/** Read-only local planning, including the destination corpus used for collision checks. */
export function planDocsNativeMigration(params: PlanDocsNativeMigrationParams) {
  return planWith({ ...params, fileSystem: createMigrationFileSystem(params.fileSystem), destinationDocuments: discoverDocuments({ documentsDir: params.home.documentsDir }).documents });
}
/** Plan once; execution checks source fingerprints and destinations before publishing. */
export function migrateDocsNative(params: MigrateDocsNativeParams): DocsNativeMigrationReport {
  const plan = planDocsNativeMigration(params);
  if (plan.issues.length > 0) throw new DocsNativeMigrationError(plan.issues);
  if (params.dryRun) return { dryRun: true, actions: plan.actions, moved: 0, rewritten: 0, discarded: 0 };
  return executeDocsNativeMigrationPlan(plan, createMigrationFileSystem(params.fileSystem));
}
