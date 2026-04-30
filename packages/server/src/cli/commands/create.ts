import type { Command } from 'commander';
import { createItem } from '../../core/create.js';
import { resolveSourcePath } from '../../utils/resolve-source-path.js';
import { run, cliWriteContext } from '../runner.js';

export function registerCreate(program: Command): void {
  program
    .command('create <title>')
    .description('Create a new backlog item')
    .option('--description <text>', 'Description in markdown')
    .option('--source <path>', 'Read description from file')
    .option('--type <type>', 'Entity type (task, epic, folder, artifact, milestone)')
    .option('--epic <id>', 'Parent epic ID')
    .option('--parent <id>', 'Parent ID')
    .action((title, opts) => run(
      (s) => {
        const description = opts.source ? resolveSourcePath(opts.source) : opts.description;
        return createItem(s, {
          title,
          description,
          type: opts.type,
          epic_id: opts.epic,
          parent_id: opts.parent,
        }, cliWriteContext());
      },
      (r) => `Created ${r.id}`,
      program.opts().json,
    ));
}
