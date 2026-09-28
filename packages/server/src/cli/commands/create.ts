import { homedir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import type { Command } from 'commander';
import { EntityType } from '@backlog-mcp/shared';
import { createEntity } from '../../core/create.js';
import {
  presentGlobalHome,
  presentProjectHome,
} from '../../core/home-presentation.js';
import { cliRuntimeDependencies, run, withAgentIdentity } from '../runner.js';
import { parseFields } from '../parse-fields.js';
import type { CreateResult } from '../../core/types.js';
import type { CliRuntime } from '../runner.types.js';
import type { BacklogHome } from '../../core/backlog-home.types.js';

type DisplayHome = Pick<BacklogHome, 'root' | 'documentsDir'>;

const CLI_CREATE_ATTRIBUTION = {
  tool: 'backlog create',
  mutation: 'create',
} as const;

/** `--source -` reads the body from stdin instead of a home-contained file. */
export const STDIN_SOURCE = '-';

/**
 * Create result plus the provenance of where the write landed (ADR 0112 R-9:
 * results carry `home`, `home_id`, `source_path`). Additive to `CreateResult`,
 * so existing `--json` consumers keep every field they read before.
 */
export interface CliCreateResult extends CreateResult {
  home?: 'global' | 'project';
  home_id?: string;
  display_path?: string;
  source_path?: string;
}

/** Read all of stdin as UTF-8 — the local-adapter half of `--source -`. */
export async function readStdin(
  stream: AsyncIterable<string | Uint8Array> = process.stdin,
): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * Resolve the create body. File sources stay contained to the selected home
 * (the shared resolver's contract); stdin is the explicit local escape hatch
 * for content that lives elsewhere (ADR 0106.5 R8: file-to-content resolution
 * is a local adapter concern), e.g. `backlog create T --source - < /tmp/x.md`.
 */
export async function resolveCreateContent(
  opts: { source?: string; content?: string },
  runtime: Pick<CliRuntime, 'resolveSourcePath'>,
  stdin: () => Promise<string> = readStdin,
): Promise<string | undefined> {
  if (!opts.source) return opts.content;
  return opts.source === STDIN_SOURCE
    ? stdin()
    : runtime.resolveSourcePath(opts.source);
}

/** Attach selected-home provenance so the caller sees where the item landed. */
export function withCreateProvenance(
  result: CreateResult,
  runtime: Pick<CliRuntime, 'home' | 'getSourcePath'>,
): CliCreateResult {
  const home = runtime.home;
  if (home === undefined) return result;
  const presentation = home.kind === 'global'
    ? presentGlobalHome(home.root, homedir())
    : presentProjectHome(home.root, homedir());
  const sourcePath = runtime.getSourcePath?.(result.id);
  return {
    ...result,
    home: home.kind,
    home_id: home.id,
    display_path: presentation.display_path,
    ...(sourcePath === undefined ? {} : { source_path: sourcePath }),
  };
}

function formatRouting(result: CreateResult): string {
  if (result.routed_by === undefined) {
    return result.parent_id === undefined
      ? `Created ${result.id}`
      : `Created ${result.id} in ${result.parent_id}`;
  }
  return `Created ${result.id} (${result.routed_by} → ${result.parent_id ?? 'unfiled'})`;
}

function displaySourcePath(
  result: CliCreateResult,
  home: DisplayHome | undefined,
): string | undefined {
  const sourcePath = result.source_path;
  if (sourcePath === undefined) return undefined;
  if (home === undefined) return sourcePath;
  // Document source paths are relative to the documents dir; show them from
  // the home root so `docs/tasks/…` is a path the caller can open.
  const absolute = isAbsolute(sourcePath)
    ? sourcePath
    : join(home.documentsDir, sourcePath);
  const rel = relative(home.root, absolute);
  return rel.startsWith('..') ? absolute : rel;
}

/**
 * The first line is unchanged (`Created ID …`) so scripts that parse it keep
 * working. The second line names the home: a project home can be selected
 * implicitly by a conventional `docs/` (ADR 0112 R-2 step 5), so the write
 * says where it landed instead of leaving the caller to guess.
 */
export function formatCreateResult(
  result: CliCreateResult,
  home?: DisplayHome,
): string {
  const first = formatRouting(result);
  if (result.home === undefined) return first;
  const where = result.home === 'global'
    ? 'global home'
    : `project home ${result.display_path ?? result.home_id}`;
  const file = displaySourcePath(result, home);
  return file === undefined ? `${first}\n  ${where}` : `${first}\n  ${where}: ${file}`;
}

export function registerCreate(program: Command): void {
  program
    .command('create <title>')
    .description('Create a new backlog item')
    .option('--content <text>', 'Content in markdown')
    .option('--source <path>', 'Read content from a file inside the selected home, or - for stdin')
    .option('--type <type>', 'Substrate type')
    .option('--parent <id>', 'Parent ID')
    .option('--fields <json-object>', 'Low-level substrate-specific fields as a JSON object')
    .option('--as <agent>', 'Attribute this write to an agent identity — an AGENT- doc id or declared principal (e.g. aime:granite). Optional per-call override; usually implicit via git config backlog.agent or BACKLOG_AGENT (ADR 0119.1)')
    .action((title, opts) => {
      let home: DisplayHome | undefined;
      return run(
        async (runtime) => {
          const content = await resolveCreateContent(opts, runtime);
          const result = await createEntity(
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
          home = runtime.home;
          return withCreateProvenance(result, runtime);
        },
        (result) => formatCreateResult(result, home),
        program.opts().json,
        withAgentIdentity(cliRuntimeDependencies(program), opts.as),
      );
    });
}
