import type { Command } from 'commander';
import { createItem } from '../../core/create.js';
import { resolveSourcePath } from '../../utils/resolve-source-path.js';
import { run, cliWriteContext } from '../runner.js';

export function registerCreate(program: Command): void {
  program
    .command('create <title>')
    .description('Create a new backlog item')
    .option('--content <text>', 'Content in markdown')
    .option('--source <path>', 'Read content from file')
    .option('--type <type>', 'Entity type (task, epic, folder, artifact, milestone)')
    .option('--epic <id>', 'Parent epic ID')
    .option('--parent <id>', 'Parent ID')
    .action((title, opts) => run(
      (s) => {
        const content = opts.source ? resolveSourcePath(opts.source) : opts.content;
        return createItem(s, {
          title,
          content,
          type: opts.type,
          epic_id: opts.epic,
          parent_id: opts.parent,
        }, cliWriteContext());
      },
      (r) => `Created ${r.id}`,
      program.opts().json,
    ));
}
