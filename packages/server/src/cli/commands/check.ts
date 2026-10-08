/** CLI presentation of the shared read-only corpus check (ADR 0113.4). */
import type { Command } from 'commander';
import type { CorpusCheckReport } from '../../core/corpus-check.contract.js';
import { parseHomeSelector } from '../../core/backlog-home-selection.js';
import { createCliCorpusChecker } from '../../composition/cli-corpus-checker.js';
import { requestExit } from '../../utils/process-exit.js';

function formatReport(report: CorpusCheckReport): string {
  const summary = report.summary;
  const lines = [
    `Checked ${summary.documents} documents: ${summary.entities} entities, ${summary.resources} resources; ${summary.errors} errors, ${summary.warnings} warnings`,
  ];
  for (const diagnostic of report.diagnostics) {
    lines.push(`${diagnostic.severity} ${diagnostic.source_path}${diagnostic.field === undefined ? '' : ` ${diagnostic.field}`}: ${diagnostic.code}: ${diagnostic.message}`);
  }
  if (!report.complete) lines.push('The corpus could not be checked completely; resolve the scan diagnostics and run check again.');
  return lines.join('\n');
}

/** Register a bounded selected-home check; no runtime or write side effects. */
export function registerCheck(program: Command): void {
  program.command('check')
    .description('Validate authored documents against their declared substrates without writing')
    .action(async function checkSelectedCorpus() {
      try {
        const options = program.opts<{home?: string; projectRoot?: string; json?: boolean}>();
        const report = await createCliCorpusChecker({
          home: parseHomeSelector(options.home),
          projectRoot: options.projectRoot,
        }).check();
        console.log(options.json ? JSON.stringify(report, null, 2) : formatReport(report));
        requestExit(report.valid ? 0 : 1);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        requestExit(2);
      }
    });
}
