/** Thin discovery and invocation adapter for declared actions (ADR 0129.2 R4). */
import type { Command } from 'commander';
import { describeSubstrateActions, executeSubstrateIntent, resolveSubstrateAction } from '../../core/substrates/index.js';
import { ValidationError } from '../../core/types.js';
import { cliRuntimeDependencies, run, withAgentIdentity } from '../runner.js';
import type { CliRuntime } from '../runner.types.js';
import { formatWrite } from './write-output.js';

interface ActionOptions { input: string; as?: string }

function parseInput(value: string): Record<string, unknown> {
  let input: unknown;
  try { input = JSON.parse(value); } catch { throw new ValidationError('--input must be a valid JSON object'); }
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new ValidationError('--input must be a JSON object');
  return input as Record<string, unknown>;
}

/** Register peer CLI syntax over the common catalog and executor (ADR 0129.2 R4). */
export function registerActions(program: Command): void {
  program.command('actions [type]')
    .description('Discover declared actions and their input contracts in this home')
    .action(function discoverActions(type?: string) {
      return run(async function discover(runtime: CliRuntime) {
        if (runtime.intentRegistry === undefined) throw new ValidationError('Substrate action catalog is unavailable');
        return describeSubstrateActions(runtime.intentRegistry, type);
      }, function formatCatalog(actions) {
        return JSON.stringify(actions, null, 2);
      }, program.opts().json, cliRuntimeDependencies(program));
    });
  program.command('act <action>')
    .description('Execute a declared action by tool name or type.verb')
    .requiredOption('--input <json-object>', 'Exact declared action inputs; Markdown body uses content')
    .option('--as <agent>', 'Attribute this write to an agent identity')
    .action(function invokeAction(action: string, opts: ActionOptions) {
      return run(async function invoke(runtime: CliRuntime) {
        if (runtime.intentRegistry === undefined || runtime.intentValidator === undefined) {
          throw new ValidationError('Substrate action catalog is unavailable');
        }
        const result = await executeSubstrateIntent({
          intent: resolveSubstrateAction(runtime.intentRegistry, action),
          input: parseInput(opts.input),
          service: runtime.service,
          validator: runtime.intentValidator,
          context: runtime.writeContext,
        });
        return { ...result, ...runtime.writeProvenance?.documents(result.ids) };
      }, function formatAction(result) {
        return formatWrite(`${result.changed ? 'Applied' : 'Unchanged'} ${action}: ${result.ids.join(', ')}`, result);
      }, program.opts().json, withAgentIdentity(cliRuntimeDependencies(program), opts.as));
    });
}
