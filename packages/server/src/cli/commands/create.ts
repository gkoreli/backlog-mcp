import type { Command } from 'commander';
import { EntityType } from '@backlog-mcp/shared';
import { createEntity } from '../../core/create.js';
import { cliRuntimeDependencies, run } from '../runner.js';
import { parseFields } from '../parse-fields.js';

const CLI_CREATE_ATTRIBUTION = {
  tool: 'backlog create',
  mutation: 'create',
} as const;

export function registerCreate(program: Command): void {
  program
    .command('create <title>')
    .description('Create a new backlog item')
    .option('--content <text>', 'Content in markdown')
    .option('--source <path>', 'Read content from file')
    .option('--type <type>', 'Substrate type')
    .option('--parent <id>', 'Parent ID')
    .option('--fields <json-object>', 'Low-level substrate-specific fields as a JSON object')
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
      (r) => `Created ${r.id}`,
      program.opts().json,
      cliRuntimeDependencies(program),
    ));
}
