import type { ContextStub, ContextStubs } from './types.js';

/** Non-parent relational groups in disclosure order, followed by declared typed relations. */
export function listContextGroups(context: ContextStubs): Array<[string, ContextStub[]]> {
  const groups: Array<[string, ContextStub[] | undefined]> = [
    ['children', context.children],
    ['siblings', context.siblings],
    ['references', context.references],
    ['referenced_by', context.referenced_by],
    ['related', context.related],
    ['ancestors', context.ancestors],
    ['descendants', context.descendants],
    ...Object.entries(context.relations ?? {}),
  ];
  return groups.flatMap(function nonemptyGroup([role, stubs]): Array<[string, ContextStub[]]> {
    return stubs === undefined || stubs.length === 0 ? [] : [[role, stubs]];
  });
}
