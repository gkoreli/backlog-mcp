import type { Command } from 'commander';
import {
  BacklogHomeResolutionError,
  resolveBacklogHome,
} from '../../core/backlog-home.js';
import {
  migrateDocsNative,
  type DocsNativeMigrationReport,
} from '../../core/index.js';
import { loadHomeSubstrateRegistry } from '../../storage/local/home-substrate-registry.js';
import { paths } from '../../utils/paths.js';
import { resolveLegacyDataRoot } from '../../utils/legacy-data-root.js';
import { resolveViewerPort } from '../../utils/ports.js';
import { isServerRunning } from '../server-manager.js';

interface MigrateDocsNativeCommandDependencies {
  env?: Readonly<Record<string, string | undefined>>;
  cwd?: string;
  migrate?: typeof migrateDocsNative;
  serverRunning?: (port: number) => Promise<boolean>;
  log?: (message: string) => void;
}

/** Format one deterministic migration report for direct CLI use. */
export function formatDocsNativeMigrationReport(
  report: DocsNativeMigrationReport,
): string {
  const lines = [
    report.dryRun ? 'Docs-native migration plan:' : 'Docs-native migration complete:',
  ];
  for (const action of report.actions) {
    if (action.kind === 'move') {
      lines.push(`  move ${action.sourcePath} -> ${action.targetPath}`);
    } else if (action.kind === 'config') {
      lines.push(
        `  config ${action.sources.map(function sourcePath(source) {
          return source.path;
        }).join(' + ')} -> ${action.targetPath}`,
      );
    } else {
      lines.push(`  discard ${action.path}`);
    }
  }
  if (report.actions.length === 0) lines.push('  nothing to migrate');
  if (!report.dryRun) {
    lines.push(
      `  moved=${report.moved} rewritten=${report.rewritten} discarded=${report.discarded}`,
    );
  }
  return lines.join('\n');
}

/** Register the explicit one-shot migration outside ordinary runtime startup. */
export function registerMigrateDocsNative(
  program: Command,
  dependencies: MigrateDocsNativeCommandDependencies = {},
): void {
  program
    .command('migrate')
    .description('Run explicit one-shot backlog migrations')
    .command('docs-native')
    .description('Move one backlog home to the docs-native layout')
    .option('--dry-run', 'Print the deterministic plan without changing files')
    .action(async function migrateCommand(options: { dryRun?: boolean }) {
      const rootOptions = program.opts<{
        home?: string;
        projectRoot?: string;
        json?: boolean;
      }>();
      if (rootOptions.home !== 'global' && rootOptions.home !== 'project') {
        throw new BacklogHomeResolutionError(
          'Docs-native migration requires --home global or --home project',
        );
      }
      if (
        rootOptions.home === 'global'
        && rootOptions.projectRoot !== undefined
      ) {
        throw new BacklogHomeResolutionError(
          'Project root cannot be combined with home "global"',
        );
      }
      if (
        rootOptions.home === 'project'
        && rootOptions.projectRoot === undefined
      ) {
        throw new BacklogHomeResolutionError(
          'Project migration requires --project-root <path>',
        );
      }

      const env = dependencies.env ?? process.env;
      const home = resolveBacklogHome({
        home: rootOptions.home,
        projectRoot: rootOptions.projectRoot,
        cwd: dependencies.cwd ?? process.cwd(),
        env: {},
      });
      if (!options.dryRun) {
        const running = await (
          dependencies.serverRunning ?? isServerRunning
        )(resolveViewerPort(paths.environment));
        if (running) {
          throw new Error(
            'Stop the backlog server before running docs-native migration',
          );
        }
      }

      const definitions = loadHomeSubstrateRegistry(home);
      const selectedLegacyRoot = home.kind === 'global'
        ? resolveLegacyDataRoot(env)
        : undefined;
      const report = (dependencies.migrate ?? migrateDocsNative)({
        home,
        registry: definitions.registry,
        dryRun: options.dryRun,
        ...(selectedLegacyRoot === undefined
          ? {}
          : { legacyRoot: selectedLegacyRoot }),
      });
      const output = rootOptions.json
        ? JSON.stringify(report, null, 2)
        : formatDocsNativeMigrationReport(report);
      (dependencies.log ?? console.log)(output);
    });
}
