import type { Command } from 'commander';
import { editItem } from '../../core/edit.js';
import type { EditOperation } from '../../core/types.js';
import { run } from '../runner.js';

function formatResult(r: { success: boolean; message?: string; error?: string }) {
  return r.success ? r.message ?? 'Done' : `Error: ${r.error}`;
}

function editAction(id: string, operation: EditOperation, json: boolean) {
  return run((s) => editItem(s, { id, operation }), formatResult, json);
}

export function registerEdit(program: Command) {
  const edit = program
    .command('edit <id>')
    .description('Edit an item body (use a subcommand: replace, append, insert)');

  edit
    .command('replace <old> <new>')
    .description('Replace text in body')
    .action((old_str: string, new_str: string) => {
      const id = edit.args[0] as string;
      return editAction(id, { type: 'str_replace', old_str, new_str }, program.opts().json);
    });

  edit
    .command('append <text>')
    .description('Append text to body')
    .action((text: string) => {
      const id = edit.args[0] as string;
      return editAction(id, { type: 'append', new_str: text }, program.opts().json);
    });

  edit
    .command('insert <line> <text>')
    .description('Insert text at line number')
    .action((line: string, text: string) => {
      const id = edit.args[0] as string;
      return editAction(id, { type: 'insert', insert_line: parseInt(line), new_str: text }, program.opts().json);
    });
}
