#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mineUsage } from '../packages/server/src/core/usage-instrument.ts';

const HELP = `Usage:
  pnpm --silent usage:report -- \\
    --operations <operations.jsonl> \\
    --usage <memory-usage.jsonl>

Reads both append-only journals and emits one aggregate JSON report to stdout.
Missing input files are reported as missing with zero observed events. The
command never creates or changes a file; redirect stdout explicitly to retain a
report.
`;

function fail(message) {
  throw new Error(message);
}

function parseArguments(argv) {
  if (argv.includes('--help')) return { help: true };
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--') continue;
    if (token !== '--operations' && token !== '--usage') {
      fail(`Unknown option: ${token ?? ''}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) fail(`Missing value for ${token}`);
    const name = token.slice(2);
    if (values[name] !== undefined) fail(`Duplicate option: ${token}`);
    values[name] = resolve(value);
    index += 1;
  }
  if (values.operations === undefined) fail('Missing required option: --operations');
  if (values.usage === undefined) fail('Missing required option: --usage');
  return { help: false, operations: values.operations, usage: values.usage };
}

function readSource(path) {
  try {
    return {
      path,
      status: 'available',
      lines: readFileSync(path, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/),
    };
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return { path, status: 'missing', lines: [] };
    }
    throw error;
  }
}

function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }
  const report = mineUsage({
    operations: readSource(args.operations),
    usage: readSource(args.usage),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
