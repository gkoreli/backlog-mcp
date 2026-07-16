import {
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { extname, isAbsolute, posix, relative, resolve, sep } from 'node:path';
import matter from 'gray-matter';
import { parseDocumentIdentity } from './document-identity.js';
import type {
  DiscoverDocumentsParams,
  DiscoveredDocument,
  DiscoveredSubstrateDeclaration,
  DiscoveryChronology,
  DocumentDiscoveryDependencies,
  DocumentDiscoveryDiagnostic,
  DocumentDiscoveryResult,
  DocumentDiscoveryStat,
  DocumentFormat,
} from './document-discovery.types.js';

interface DiscoveredPath {
  absolutePath: string;
  sourcePath: string;
  stat: DocumentDiscoveryStat;
}

const FORMAT_BY_EXTENSION: Readonly<Record<string, DocumentFormat>> = {
  '.json': 'json',
  '.markdown': 'markdown',
  '.md': 'markdown',
  '.txt': 'text',
  '.yaml': 'yaml',
  '.yml': 'yaml',
};

const DEFAULT_DEPENDENCIES: DocumentDiscoveryDependencies = {
  readDirectory: readDirectory,
  readFile: readTextFile,
  lstat: lstatSync,
  stat: statSync,
  realpath: realpathSync,
  getGitFirstAddDate: noGitFirstAddDate,
};

/**
 * Recursively discovers supported documents beneath one bounded documents directory.
 *
 * The result is ordered by normalized POSIX source path, keeps declarations separate
 * from ordinary resources, and reports individual failures without aborting the scan.
 */
export function discoverDocuments(params: DiscoverDocumentsParams): DocumentDiscoveryResult {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...params.dependencies };
  const diagnostics: DocumentDiscoveryDiagnostic[] = [];
  const documentsDir = resolve(params.documentsDir);
  const canonicalDocumentsDir = readCanonicalDocumentsDir(
    documentsDir,
    dependencies,
    diagnostics,
  );

  if (canonicalDocumentsDir === undefined) {
    return { documents: [], declarations: [], diagnostics };
  }

  const discoveredPaths = collectDiscoveredPaths(
    documentsDir,
    canonicalDocumentsDir,
    dependencies,
    diagnostics,
  );
  const documents: DiscoveredDocument[] = [];
  const declarations: DiscoveredSubstrateDeclaration[] = [];

  for (const discoveredPath of discoveredPaths) {
    const format = getDocumentFormat(discoveredPath.sourcePath);
    if (format === undefined) {
      continue;
    }

    if (isSubstrateDeclaration(discoveredPath.sourcePath, format)) {
      declarations.push(readDeclaration(discoveredPath, dependencies, diagnostics));
      continue;
    }

    documents.push(readDocument(discoveredPath, format, dependencies, diagnostics));
  }

  diagnostics.push(...findDuplicatePathKeys(documents));
  diagnostics.sort(compareDiagnostics);

  return { documents, declarations, diagnostics };
}

function readCanonicalDocumentsDir(
  documentsDir: string,
  dependencies: DocumentDiscoveryDependencies,
  diagnostics: DocumentDiscoveryDiagnostic[],
): string | undefined {
  try {
    const canonicalDocumentsDir = dependencies.realpath(documentsDir);
    const rootStat = dependencies.stat(documentsDir);
    if (!rootStat.isDirectory()) {
      throw new Error('path is not a directory');
    }
    return canonicalDocumentsDir;
  } catch (error) {
    diagnostics.push({
      code: 'documents-dir-unreadable',
      message: `Cannot discover documents directory: ${getErrorMessage(error)}`,
      sourcePaths: ['.'],
    });
    return undefined;
  }
}

function collectDiscoveredPaths(
  documentsDir: string,
  canonicalDocumentsDir: string,
  dependencies: DocumentDiscoveryDependencies,
  diagnostics: DocumentDiscoveryDiagnostic[],
): DiscoveredPath[] {
  const paths: DiscoveredPath[] = [];
  const visitedDirectories = new Set<string>();

  walkDirectory(
    documentsDir,
    documentsDir,
    canonicalDocumentsDir,
    dependencies,
    diagnostics,
    visitedDirectories,
    paths,
  );

  return paths.sort(compareSourcePaths);
}

function walkDirectory(
  directoryPath: string,
  documentsDir: string,
  canonicalDocumentsDir: string,
  dependencies: DocumentDiscoveryDependencies,
  diagnostics: DocumentDiscoveryDiagnostic[],
  visitedDirectories: Set<string>,
  paths: DiscoveredPath[],
): void {
  const canonicalDirectory = readContainedRealpath(
    directoryPath,
    documentsDir,
    canonicalDocumentsDir,
    dependencies,
    diagnostics,
  );
  if (canonicalDirectory === undefined || visitedDirectories.has(canonicalDirectory)) {
    return;
  }
  visitedDirectories.add(canonicalDirectory);

  let names: string[];
  try {
    names = dependencies.readDirectory(directoryPath).sort(compareText);
  } catch (error) {
    diagnostics.push(createUnreadablePathDiagnostic(directoryPath, documentsDir, error));
    return;
  }

  for (const name of names) {
    const absolutePath = resolve(directoryPath, name);
    const sourcePath = normalizeSourcePath(documentsDir, absolutePath);
    let linkStat: DocumentDiscoveryStat;

    try {
      linkStat = dependencies.lstat(absolutePath);
    } catch (error) {
      diagnostics.push({
        code: 'path-unreadable',
        message: `Cannot inspect ${sourcePath}: ${getErrorMessage(error)}`,
        sourcePaths: [sourcePath],
      });
      continue;
    }

    if (linkStat.isSymbolicLink()) {
      collectSymbolicLink(
        absolutePath,
        documentsDir,
        canonicalDocumentsDir,
        dependencies,
        diagnostics,
        visitedDirectories,
        paths,
      );
      continue;
    }

    if (linkStat.isDirectory()) {
      walkDirectory(
        absolutePath,
        documentsDir,
        canonicalDocumentsDir,
        dependencies,
        diagnostics,
        visitedDirectories,
        paths,
      );
      continue;
    }

    if (linkStat.isFile()) {
      paths.push({ absolutePath, sourcePath, stat: linkStat });
    }
  }
}

function collectSymbolicLink(
  absolutePath: string,
  documentsDir: string,
  canonicalDocumentsDir: string,
  dependencies: DocumentDiscoveryDependencies,
  diagnostics: DocumentDiscoveryDiagnostic[],
  visitedDirectories: Set<string>,
  paths: DiscoveredPath[],
): void {
  const canonicalPath = readContainedRealpath(
    absolutePath,
    documentsDir,
    canonicalDocumentsDir,
    dependencies,
    diagnostics,
  );
  if (canonicalPath === undefined) {
    return;
  }

  let targetStat: DocumentDiscoveryStat;
  try {
    targetStat = dependencies.stat(absolutePath);
  } catch (error) {
    diagnostics.push(createUnreadablePathDiagnostic(absolutePath, documentsDir, error));
    return;
  }

  if (targetStat.isDirectory()) {
    walkDirectory(
      absolutePath,
      documentsDir,
      canonicalDocumentsDir,
      dependencies,
      diagnostics,
      visitedDirectories,
      paths,
    );
    return;
  }

  if (targetStat.isFile()) {
    paths.push({
      absolutePath,
      sourcePath: normalizeSourcePath(documentsDir, absolutePath),
      stat: targetStat,
    });
  }
}

function readContainedRealpath(
  absolutePath: string,
  documentsDir: string,
  canonicalDocumentsDir: string,
  dependencies: DocumentDiscoveryDependencies,
  diagnostics: DocumentDiscoveryDiagnostic[],
): string | undefined {
  const sourcePath = normalizeSourcePath(documentsDir, absolutePath);
  let canonicalPath: string;

  try {
    canonicalPath = dependencies.realpath(absolutePath);
  } catch (error) {
    diagnostics.push(createUnreadablePathDiagnostic(absolutePath, documentsDir, error));
    return undefined;
  }

  if (isPathContained(canonicalDocumentsDir, canonicalPath)) {
    return canonicalPath;
  }

  diagnostics.push({
    code: 'symlink-outside-documents',
    message: `Refusing to follow ${sourcePath} outside the documents directory`,
    sourcePaths: [sourcePath],
  });
  return undefined;
}

function readDocument(
  path: DiscoveredPath,
  format: DocumentFormat,
  dependencies: DocumentDiscoveryDependencies,
  diagnostics: DocumentDiscoveryDiagnostic[],
): DiscoveredDocument {
  let content: string | undefined;
  let declaredId: unknown;

  try {
    content = dependencies.readFile(path.absolutePath);
    if (format === 'markdown') {
      try {
        // Passing options disables gray-matter's content-only cache. Its cache
        // stores the pre-parse object before a YAML error and would otherwise
        // make the same malformed content appear valid on subsequent scans.
        declaredId = matter(content, {}).data.id;
      } catch (error) {
        diagnostics.push({
          code: 'malformed-frontmatter',
          message: `Cannot parse frontmatter in ${path.sourcePath}: ${getErrorMessage(error)}`,
          sourcePaths: [path.sourcePath],
        });
      }
    }
  } catch (error) {
    diagnostics.push({
      code: 'file-unreadable',
      message: `Cannot read ${path.sourcePath}: ${getErrorMessage(error)}`,
      sourcePaths: [path.sourcePath],
    });
  }

  const chronology = getChronology(path, dependencies);
  const identity = parseDocumentIdentity({
    sourcePath: path.sourcePath,
    declaredId,
    ...chronology,
  });

  return {
    sourcePath: path.sourcePath,
    absolutePath: path.absolutePath,
    format,
    content,
    identity,
  };
}

function readDeclaration(
  path: DiscoveredPath,
  dependencies: DocumentDiscoveryDependencies,
  diagnostics: DocumentDiscoveryDiagnostic[],
): DiscoveredSubstrateDeclaration {
  let content: string | undefined;
  let value: unknown;

  try {
    content = dependencies.readFile(path.absolutePath);
    try {
      value = JSON.parse(content) as unknown;
    } catch (error) {
      diagnostics.push({
        code: 'malformed-substrate-declaration',
        message: `Cannot parse substrate declaration ${path.sourcePath}: ${getErrorMessage(error)}`,
        sourcePaths: [path.sourcePath],
      });
    }
  } catch (error) {
    diagnostics.push({
      code: 'file-unreadable',
      message: `Cannot read ${path.sourcePath}: ${getErrorMessage(error)}`,
      sourcePaths: [path.sourcePath],
    });
  }

  return {
    sourcePath: path.sourcePath,
    absolutePath: path.absolutePath,
    content,
    value,
  };
}

function getChronology(
  path: DiscoveredPath,
  dependencies: DocumentDiscoveryDependencies,
): DiscoveryChronology {
  try {
    const firstAddDate = normalizeDate(
      dependencies.getGitFirstAddDate(path.absolutePath, path.sourcePath),
    );
    if (firstAddDate !== undefined) {
      return { observedDate: firstAddDate, dateSource: 'git-first-add' };
    }
  } catch {
    // Git chronology is optional. Filesystem mtime remains the deterministic fallback.
  }

  const modifiedDate = normalizeDate(path.stat.mtime);
  return modifiedDate === undefined
    ? {}
    : { observedDate: modifiedDate, dateSource: 'filesystem-mtime' };
}

function findDuplicatePathKeys(
  documents: DiscoveredDocument[],
): DocumentDiscoveryDiagnostic[] {
  const pathsByCollectionAndKey = new Map<string, string[]>();

  for (const document of documents) {
    const pathKey = document.identity.pathKey;
    if (pathKey === undefined) {
      continue;
    }

    const collection = posix.dirname(document.sourcePath);
    const collisionKey = `${collection}\0${pathKey}`;
    const paths = pathsByCollectionAndKey.get(collisionKey) ?? [];
    paths.push(document.sourcePath);
    pathsByCollectionAndKey.set(collisionKey, paths);
  }

  const diagnostics: DocumentDiscoveryDiagnostic[] = [];
  for (const paths of pathsByCollectionAndKey.values()) {
    if (paths.length < 2) {
      continue;
    }

    paths.sort(compareText);
    diagnostics.push({
      code: 'duplicate-path-key',
      message: `Duplicate document identity is claimed by: ${paths.join(', ')}`,
      sourcePaths: paths,
    });
  }
  return diagnostics;
}

function getDocumentFormat(sourcePath: string): DocumentFormat | undefined {
  return FORMAT_BY_EXTENSION[extname(sourcePath).toLowerCase()];
}

function isSubstrateDeclaration(sourcePath: string, format: DocumentFormat): boolean {
  return format === 'json' && sourcePath.split('/')[0] === 'substrates';
}

function normalizeSourcePath(documentsDir: string, absolutePath: string): string {
  return relative(documentsDir, absolutePath).split(sep).join('/');
}

function isPathContained(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath === ''
    || (
      relativePath !== '..'
      && !relativePath.startsWith(`..${sep}`)
      && !isAbsolute(relativePath)
    );
}

function normalizeDate(value: Date | string | undefined): string | undefined {
  const date = value instanceof Date
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? new Date(value.trim())
      : undefined;
  return date === undefined || Number.isNaN(date.getTime())
    ? undefined
    : date.toISOString();
}

function compareSourcePaths(left: DiscoveredPath, right: DiscoveredPath): number {
  return compareText(left.sourcePath, right.sourcePath);
}

function compareDiagnostics(
  left: DocumentDiscoveryDiagnostic,
  right: DocumentDiscoveryDiagnostic,
): number {
  const leftPath = left.sourcePaths[0] ?? '';
  const rightPath = right.sourcePaths[0] ?? '';
  return compareText(leftPath, rightPath) || compareText(left.code, right.code);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function createUnreadablePathDiagnostic(
  absolutePath: string,
  documentsDir: string,
  error: unknown,
): DocumentDiscoveryDiagnostic {
  const sourcePath = normalizeSourcePath(documentsDir, absolutePath);
  return {
    code: 'path-unreadable',
    message: `Cannot inspect ${sourcePath}: ${getErrorMessage(error)}`,
    sourcePaths: [sourcePath],
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readDirectory(absolutePath: string): string[] {
  return readdirSync(absolutePath, { encoding: 'utf8' });
}

function readTextFile(absolutePath: string): string {
  return readFileSync(absolutePath, 'utf8');
}

function noGitFirstAddDate(): undefined {
  return undefined;
}
