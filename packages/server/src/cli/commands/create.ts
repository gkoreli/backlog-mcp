import type { Command } from 'commander';
import { EntityType } from '@backlog-mcp/shared';
import { createEntity } from '../../core/create.js';
import { readBodyFile } from '../body-file.js';
import { cliRuntimeDependencies, run, withAgentIdentity } from '../runner.js';
import { parseFields } from '../parse-fields.js';
import type { CliRuntime } from '../runner.types.js';
import {
  formatCreateResult,
  type CliCreateResult,
} from './create-output.js';

const CLI_CREATE_ATTRIBUTION = {
  tool: 'backlog create',
  mutation: 'create',
} as const;

/** Parsed `backlog create` options. */
interface CreateOptions {
  content?: string;
  bodyFile?: string;
  source?: string;
  type?: string;
  parent?: string;
  fields?: string;
  as?: string;
}

/**
 * Resolve the create body from `--content`, `-F/--body-file`, or its alias
 * `--source`. At most one may be given, like gh's `--body`/`--body-file`.
 */
export async function resolveCreateContent(
  opts: Pick<CreateOptions, 'content' | 'bodyFile' | 'source'>,
  read: (file: string) => Promise<string> = readBodyFile,
): Promise<string | undefined> {
  const given = [
    opts.content !== undefined ? '--content' : undefined,
    opts.bodyFile !== undefined ? '--body-file' : undefined,
    opts.source !== undefined ? '--source' : undefined,
  ].filter(function isGiven(flag): flag is string {
    return flag !== undefined;
  });
  if (given.length > 1) {
    throw new Error(`Specify only one of ${given.join(', ')}`);
  }
  const file = opts.bodyFile ?? opts.source;
  return file === undefined ? opts.content : read(file);
}

export function registerCreate(program: Command): void {
  program
    .command('create <title>')
    .description('Create a new backlog item')
    .option('--content <text>', 'Content in markdown')
    .option('-F, --body-file <file>', 'Read content from file (use "-" to read from standard input)')
    .option('--source <file>', 'Alias of --body-file')
    .option('--type <type>', 'Substrate type')
    .option('--parent <id>', 'Parent ID')
    .option('--fields <json-object>', 'Low-level substrate-specific fields as a JSON object')
    .option('--as <agent>', 'Attribute this write to an agent identity — an AGENT- doc id or declared principal (e.g. aime:granite). Optional per-call override; usually implicit via git config backlog.agent or BACKLOG_AGENT (ADR 0119.1)')
    .action(function createAction(title: string, opts: CreateOptions) {
      return run(
        async function createInHome(runtime: CliRuntime): Promise<CliCreateResult> {
          const result = await createEntity(
            runtime.service,
            {
              title,
              content: await resolveCreateContent(opts),
              type: opts.type ?? EntityType.Task,
              parent_id: opts.parent,
              fields: parseFields(opts.fields),
            },
            runtime.writeContext,
            CLI_CREATE_ATTRIBUTION,
          );
          return { ...result, ...runtime.writeProvenance?.document(result.id) };
        },
        formatCreateResult,
        program.opts().json,
        withAgentIdentity(cliRuntimeDependencies(program), opts.as),
      );
    });
}
