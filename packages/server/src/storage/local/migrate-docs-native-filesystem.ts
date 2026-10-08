/** Local migration capabilities and optional fault-injection overrides. */
import { bunYamlCodec } from './bun-yaml-codec.js';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { paths } from '../../utils/paths.js';
import type { DocsNativeMigrationFileSystem } from '../../core/migrate-docs-native.types.js';

const LOCAL_FILE_SYSTEM: DocsNativeMigrationFileSystem = {
  yaml: bunYamlCodec,
  exists: existsSync,
  canonicalize: function canonicalize(path) { return paths.canonicalizeThroughExistingAncestor(path); },
  isSymbolicLink: function isSymbolicLink(path) {
    return lstatSync(path).isSymbolicLink();
  },
  realpath: realpathSync,
  readDirectory: function readDirectory(path) {
    return readdirSync(path, { withFileTypes: true });
  },
  readFile: readFileSync,
  makeDirectory: function makeDirectory(path) {
    mkdirSync(path, { recursive: true });
  },
  writeFileExclusive: function writeFileExclusive(path, content) {
    writeFileSync(path, content, { flag: 'wx' });
  },
  writeFile: writeFileSync,
  unlink: unlinkSync,
  removeTree: function removeTree(path) {
    rmSync(path, { recursive: true, force: true });
  },
  removeEmptyDirectory: function removeEmptyDirectory(path) {
    try {
      rmdirSync(path);
    } catch {
      // Existing or concurrently-created siblings keep their directory.
    }
  },
};

export function createMigrationFileSystem(overrides?: Partial<DocsNativeMigrationFileSystem>): DocsNativeMigrationFileSystem {
  const fs = { ...LOCAL_FILE_SYSTEM, ...overrides };
  return { ...fs, canonicalize: overrides?.canonicalize ?? function canonicalize(path) {
    return paths.canonicalizeThroughExistingAncestor(path, { exists: fs.exists, canonicalize: fs.realpath });
  } };
}

