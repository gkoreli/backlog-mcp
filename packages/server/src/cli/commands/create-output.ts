import { homedir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { projectHomeProvenance } from '../../core/home-provenance.js';
import type { HomeProvenance } from '../../core/home-provenance.types.js';
import type { CreateResult } from '../../core/types.js';
import type { CliRuntime } from '../runner.types.js';

/**
 * A create result plus where it landed: the same `HomeProvenance` the HTTP
 * adapter returns (ADR 0112 R-9). Additive to `CreateResult`, so existing
 * `--json` consumers keep every field they read before.
 */
export type CliCreateResult = CreateResult & Partial<HomeProvenance>;

/** Attach the selected home's provenance to a create result. */
export function withCreateProvenance(
  result: CreateResult,
  runtime: Pick<CliRuntime, 'home' | 'getSourcePath'>,
): CliCreateResult {
  const home = runtime.home;
  return home === undefined
    ? result
    : {
      ...result,
      ...projectHomeProvenance(home, homedir(), runtime.getSourcePath?.(result.id)),
    };
}

/**
 * Mention routing only when it chose a parent (`in EPIC-0001 via session`).
 * Nothing chosen is the common case and prints nothing extra; `--json` still
 * carries `routed_by`.
 */
function formatCreated(result: CreateResult): string {
  if (result.parent_id === undefined) return `Created ${result.id}`;
  const via = result.routed_by === undefined ? '' : ` via ${result.routed_by}`;
  return `Created ${result.id} in ${result.parent_id}${via}`;
}

/**
 * Document source paths are relative to the documents dir. Show them from
 * the home root (`docs/tasks/…`), or absolute when the documents dir lives
 * outside the root.
 */
function formatSourcePath(provenance: Partial<HomeProvenance>): string | undefined {
  const { source_path: sourcePath, root, documents_dir: documentsDir } = provenance;
  if (sourcePath === undefined) return undefined;
  if (root === undefined || documentsDir === undefined) return sourcePath;
  const absolute = isAbsolute(sourcePath) ? sourcePath : join(documentsDir, sourcePath);
  const fromRoot = relative(root, absolute);
  return fromRoot.startsWith('..') ? absolute : fromRoot;
}

function formatHome(provenance: Partial<HomeProvenance>): string {
  return provenance.home === 'global'
    ? 'global home'
    : `project home ${provenance.display_path ?? provenance.home_id}`;
}

/**
 * Human output. The first line starts with `Created ID` so scripts that
 * parse it keep working. The second names the home: a project home can be
 * selected implicitly by a conventional `docs/` (ADR 0112 R-2 step 5), so
 * the write says where it landed.
 */
export function formatCreateResult(result: CliCreateResult): string {
  const created = formatCreated(result);
  if (result.home === undefined) return created;
  const file = formatSourcePath(result);
  const where = formatHome(result);
  return file === undefined
    ? `${created}\n  ${where}`
    : `${created}\n  ${where}: ${file}`;
}
