import { isAbsolute, relative, sep } from 'node:path';

/**
 * Return whether candidate is root or its descendant. Canonicalize paths at
 * the filesystem boundary when symlink containment matters.
 */
export function isPathWithin(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath === ''
    || (
      relativePath !== '..'
      && !relativePath.startsWith(`..${sep}`)
      && !isAbsolute(relativePath)
    );
}
