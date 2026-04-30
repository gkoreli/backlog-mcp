import type { Command } from 'commander';
import { updateItem } from '../../core/update.js';
import { run, cliWriteContext } from '../runner.js';

export function registerUpdate(program: Command): void {
  program
    .command('update <id>')
    .description('Update a backlog item')
    .option('--title <text>', 'New title')
    .option('--status <status>', 'New status')
    .option('--epic <id>', 'Set epic (use "" to clear)')
    .option('--parent <id>', 'Set parent (use "" to clear)')
    .option('--evidence <text...>', 'Evidence entries')
    .option('--blocked-reason <text...>', 'Blocked reasons')
    .option('--due-date <date>', 'Due date (use "" to clear)')
    .action((id, opts) => run(
      (s) => updateItem(s, {
        id,
        title: opts.title,
        status: opts.status,
        epic_id: opts.epic === '' ? null : opts.epic,
        parent_id: opts.parent === '' ? null : opts.parent,
        evidence: opts.evidence,
        blocked_reason: opts.blockedReason,
        due_date: opts.dueDate === '' ? null : opts.dueDate,
      }, cliWriteContext()),
      (r) => `Updated ${r.id}`,
      program.opts().json,
    ));
}
