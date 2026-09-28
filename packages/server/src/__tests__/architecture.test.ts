/**
 * Architecture test (ADR 0134 R6.2, ADR 0134.1 R1): every import in
 * `packages/server/src` obeys the ADR 0134 R1 layer rules or is a listed,
 * shrinking known violation.
 */
import { describe, expect, it } from 'vitest';
import {
  FROZEN_UTILS,
  KNOWN_VIOLATIONS,
  LAYER_RULES,
} from './helpers/architecture-rules.js';
import { edgeKey, listSourceFiles, scanImports } from './helpers/import-graph.js';

const edges = scanImports();

describe('architecture (ADR 0134 R1)', function describeArchitecture() {
  it('scans the real source tree', function scansRealTree() {
    expect(edges.length).toBeGreaterThan(500);
  });

  for (const rule of LAYER_RULES) {
    describe(`${rule.id}: ${rule.description}`, function describeRule() {
      const known = new Set(KNOWN_VIOLATIONS[rule.id] ?? []);
      const found = [...new Set(edges.filter(rule.violates).map(edgeKey))].sort();

      it('has no new violations', function noNewViolations() {
        const added = found.filter(function isUnlisted(key) { return !known.has(key); });
        expect(added, 'New violation. Fix the import (ADR 0134 R1), or amend the ADR.').toEqual([]);
      });

      it('lists no fixed violations (the ratchet only shrinks)', function noStaleEntries() {
        const present = new Set(found);
        const stale = [...known].filter(function isFixed(key) { return !present.has(key); }).sort();
        expect(stale, 'Fixed. Remove these from KNOWN_VIOLATIONS.').toEqual([]);
      });
    });
  }

  it('adds no files to utils/ (ADR 0134 R4.3)', function utilsFrozen() {
    const utils = listSourceFiles().filter(function inUtils(path) { return path.startsWith('utils/'); });
    expect(utils).toEqual([...FROZEN_UTILS].sort());
  });
});
