import type { Command } from 'commander';
import { editItem } from '../../core/edit.js';
import type { EditOperation } from '../../core/types.js';
import { run, cliWriteContext } from '../runner.js';

function formatResult(r: { success: boolean; message?: string; error?: string }) {
  if (!r.success) {
    console.error(r.error ?? 'Edit failed');
    process.exit(1);
  }
  return r.message ?? 'Done';
}

function editAction(id: string, operation: EditOperation, json: boolean) {
  return run((s) => editItem(s, { id, operation }, cliWriteContext()), formatResult, json);
}

export function registerEdit(program: Command) {
  const edit = program
    .command('edit')
    .description('Edit an item body (use a subcommand: replace, append, insert)');

  edit
    .command('replace <id> <old> <new>')
    .description('Replace text in body')
    .action((id: string, old_str: string, new_str: string) =>
      editAction(id, { type: 'str_replace', old_str, new_str }, program.opts().json));

  edit
    .command('append <id> <text>')
    .description('Append text to body')
    .action((id: string, text: string) =>
      editAction(id, { type: 'append', new_str: text }, program.opts().json));

  edit
    .command('insert <id> <line> <text>')
    .description('Insert text at line number')
    .action((id: string, line: string, text: string) =>
      editAction(id, { type: 'insert', insert_line: parseInt(line), new_str: text }, program.opts().json));
}
