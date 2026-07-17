import type { Command } from 'commander';
import { EntityType } from '@backlog-mcp/shared';
import { createEntity } from '../../core/create.js';
import { cliRuntimeDependencies, run, withAgentIdentity } from '../runner.js';
import { parseFields } from '../parse-fields.js';
import type { CreateResult } from '../../core/types.js';

const CLI_CREATE_ATTRIBUTION = {
  tool: 'backlog create',
  mutation: 'create',
} as const;

function formatCreateResult(result: CreateResult): string {
  if (result.routed_by === undefined) {
    return result.parent_id === undefined
      ? `Created ${result.id}`
      : `Created ${result.id} in ${result.parent_id}`;
  }
  return `Created ${result.id} (${result.routed_by} → ${result.parent_id ?? 'unfiled'})`;
}

export function registerCreate(program: Command): void {
  program
    .command('create <title>')
    .description('Create a new backlog item')
    .option('--content <text>', 'Content in markdown')
    .option('--source <path>', 'Read content from file')
    .option('--type <type>', 'Substrate type')
    .option('--parent <id>', 'Parent ID')
    .option('--fields <json-object>', 'Low-level substrate-specific fields as a JSON object')
    .option('--as <agent>', 'Attribute this write to an agent identity — an AGENT- doc id or declared principal (e.g. aime:granite). Optional; also via BACKLOG_AGENT env (ADR 0119)')
    .action((title, opts) => run(
      (runtime) => {
        const content = opts.source
          ? runtime.resolveSourcePath(opts.source)
          : opts.content;
        return createEntity(
          runtime.service,
          {
            title,
            content,
            type: opts.type ?? EntityType.Task,
            parent_id: opts.parent,
            fields: parseFields(opts.fields),
          },
          runtime.writeContext,
          CLI_CREATE_ATTRIBUTION,
        );
      },
      formatCreateResult,
      program.opts().json,
      withAgentIdentity(cliRuntimeDependencies(program), opts.as),
    ));
}
