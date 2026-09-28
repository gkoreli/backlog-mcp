import type { Command } from 'commander';
import { deleteItem } from '../../core/delete.js';
import type { HomeProvenance } from '../../core/home-provenance.types.js';
import type { DeleteResult } from '../../core/types.js';
import { cliRuntimeDependencies, run, withAgentIdentity } from '../runner.js';
import type { CliRuntime } from '../runner.types.js';
import { formatWrite } from './write-output.js';

const CLI_DELETE_ATTRIBUTION = {
  tool: 'backlog delete',
  mutation: 'delete',
} as const;

/** A delete result and where the document was (ADR 0134.1 R4.4). */
type CliDeleteResult = DeleteResult & Partial<HomeProvenance>;

function formatDeleteResult(result: CliDeleteResult): string {
  return result.deleted
    ? formatWrite(`Deleted ${result.id}`, result)
    : `${result.id} not found`;
}

export function registerDelete(program: Command): void {
  program
    .command('delete <id>')
    .description('Delete a backlog item')
    .requiredOption('--force', 'Confirm deletion')
    .option('--as <agent>', 'Attribute this write to an agent identity — an AGENT- doc id or declared principal (e.g. aime:granite). Optional per-call override; usually implicit via git config backlog.agent or BACKLOG_AGENT (ADR 0119.1)')
    .action((id, opts) => run(
      async function deleteInHome(runtime: CliRuntime): Promise<CliDeleteResult> {
        // The path is looked up first: after deletion it no longer resolves.
        const provenance = runtime.writeProvenance?.document(id);
        const result = await deleteItem(
          runtime.service,
          { id },
          runtime.writeContext,
          CLI_DELETE_ATTRIBUTION,
        );
        return result.deleted ? { ...result, ...provenance } : result;
      },
      formatDeleteResult,
      program.opts().json,
      withAgentIdentity(cliRuntimeDependencies(program), opts.as),
    ));
}
