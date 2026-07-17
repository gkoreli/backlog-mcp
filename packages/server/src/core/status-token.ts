/**
 * Status token normalization (first-impression repair batch, 2026-07).
 *
 * Real corpora write workflow states freeform: "Accepted", "Accepted
 * (goga, 2026-07-16)", "Accepted, amended 2026-04-14", "PARKED, ONLY
 * EXPLORATION". Exact case-sensitive comparison at the declared-status
 * seams made wakeup disclose 1 of ~46 eligible ADRs in this very repo.
 *
 * The rule is token normalization only — case-fold, take the leading
 * token (up to the first comma/parenthesis/semicolon), trim. No fuzzy
 * matching, no synonym maps, no per-repo configuration. A missing or
 * empty status never matches anything (fail-closed).
 */

/** Leading status token: case-folded, split at the first `,`, `(`, or `;`. */
export function statusToken(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const token = value.split(/[,(;]/u, 1)[0]?.trim().toLowerCase();
  return token ? token : undefined;
}

/**
 * One comparison for every declared-status seam (wakeup disclosure
 * filters, list --status). Strings compare by token; non-string workflow
 * scalars (numbers, booleans) compare strictly.
 */
export function matchesDeclaredStatus(
  entityStatus: unknown,
  declared: unknown,
): boolean {
  if (typeof declared === 'string') {
    const token = statusToken(entityStatus);
    return token !== undefined && token === statusToken(declared);
  }
  return entityStatus !== undefined && entityStatus === declared;
}
