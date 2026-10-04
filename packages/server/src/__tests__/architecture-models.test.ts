/** ADR 0136 ownership guards; repository probes read real source and never write. */
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { listSourceFiles, SOURCE_ROOT } from './helpers/import-graph.js';

const realFs = await vi.importActual<typeof import('node:fs')>('node:fs');
const packageRoot = resolve(SOURCE_ROOT, '../..');

function source(path: string) {
  return realFs.readFileSync(path, 'utf8');
}

function ambientReferences(text: string, clocks: boolean): string[] {
  const file = ts.createSourceFile('subject.ts', text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isIdentifier(node) && (node.text === 'process' || node.text === 'console')) found.push(node.getText(file));
    if (clocks && ts.isCallExpression(node) && node.expression.getText(file) === 'Date.now') found.push('Date.now()');
    if (clocks && ts.isNewExpression(node) && node.expression.getText(file) === 'Date' && (node.arguments?.length ?? 0) === 0) found.push('new Date()');
    ts.forEachChild(node, visit);
  }
  visit(file);
  return found;
}

describe('domain ownership (ADR 0136)', function modelOwnership() {
  it('keeps all core free of console and process globals', function noAmbientGlobals() {
    const violations = listSourceFiles().filter(function inCore(path) { return path.startsWith('core/'); }).flatMap(function inspect(path) {
      return ambientReferences(source(join(SOURCE_ROOT, path)), false).map(function label(access) { return `${path}: ${access}`; });
    });
    expect(violations).toEqual([]);
  });
  it('keeps pure policy and capture independent of ambient time', function suppliedTime() {
    const paths = [
      'core/operation-entry.ts', 'core/memory-validity.ts', 'core/memory-correction.ts', 'core/memory-capture.ts',
      '../../memory/src/search/search-selection.ts', '../../memory/src/search/search-document.ts',
    ];
    for (const path of paths) expect(ambientReferences(source(resolve(SOURCE_ROOT, path)), true), path).toEqual([]);
  });
  it('keeps search value/projection modules independent of effects and the Orama adapter', function pureSearchDependencies() {
    for (const path of ['search-selection.ts', 'search-document.ts']) {
      const text = source(join(packageRoot, 'memory/src/search', path));
      const imports = ts.preProcessFile(text, true, true).importedFiles.map(function specifier(file) { return file.fileName; });
      expect(imports.filter(function outsideModel(specifier) { return specifier !== '@backlog-mcp/shared' && specifier !== './types.js'; }), path).toEqual([]);
    }
  });
  it('preserves shared/memory package dependency direction', function packageDirection() {
    for (const name of ['shared', 'memory']) {
      const root = join(packageRoot, name, 'src');
      const allowed = name === 'shared' ? [] : ['@backlog-mcp/shared'];
      const violations = listSourceFiles(root).flatMap(function inspect(path) {
        return ts.preProcessFile(source(join(root, path)), true, true).importedFiles.filter(function outward(file) {
          return (file.fileName.startsWith('@backlog-mcp/') && !allowed.includes(file.fileName))
            || /(?:^|\/)packages\/(?:server|viewer)\//u.test(file.fileName)
            || /(?:^|\/)\.\.\/(?:server|viewer)(?:\/|$)/u.test(file.fileName);
        }).map(function label(file) { return `${name}/${path} -> ${file.fileName}`; });
      });
      expect(violations).toEqual([]);
    }
  });
  it('the ambient guard ignores comments but detects globals and unsupplied time', function validatesScanner() {
    expect(ambientReferences('// Date.now(); console.error(); process.env\nconst time = new Date(1000);', true)).toEqual([]);
    expect(ambientReferences('console.error(process.env); Date.now(); new Date();', true)).toEqual(['console', 'process', 'Date.now()', 'new Date()']);
  });
});
