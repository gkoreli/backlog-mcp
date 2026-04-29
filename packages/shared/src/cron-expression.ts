/**
 * Cron expression validator — classic 5-field numeric form only.
 *
 * Supports: `*`, single number, comma list (1,2,3), range (1-5), step (`*\/N` or `N-M/S`).
 * Does NOT support: named months/days (JAN, MON), `@daily` shortcuts, seconds field (6-field Quartz).
 *
 * Field order: min (0-59) hour (0-23) day-of-month (1-31) month (1-12) day-of-week (0-6).
 *
 * Used as a Zod refinement on `CronSubstrate.schema.schedule` — substrate validation
 * rejects bad schedules before they reach storage.
 */

const FIELD_BOUNDS: Array<[number, number]> = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 6],
];

function inRange(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

function isValidField(component: string, bounds: [number, number]): boolean {
  const [min, max] = bounds;
  if (component === '') return false;

  const slashIdx = component.indexOf('/');
  if (slashIdx !== -1) {
    const base = component.slice(0, slashIdx);
    const step = component.slice(slashIdx + 1);
    if (!/^\d+$/.test(step)) return false;
    const stepVal = parseInt(step, 10);
    if (stepVal <= 0) return false;
    if (stepVal > max - min) return false;
    if (base.includes(',')) return false;
    return isValidBaseForStep(base, bounds);
  }

  if (component.includes(',')) {
    const parts = component.split(',');
    if (parts.length < 2) return false;
    return parts.every(p => isValidSimple(p, bounds));
  }

  return isValidSimple(component, bounds);
}

function isValidBaseForStep(base: string, bounds: [number, number]): boolean {
  if (base === '*') return true;
  return isValidSimple(base, bounds);
}

function isValidSimple(s: string, bounds: [number, number]): boolean {
  const [min, max] = bounds;
  if (s === '*') return true;

  const dashIdx = s.indexOf('-');
  if (dashIdx !== -1) {
    const a = s.slice(0, dashIdx);
    const b = s.slice(dashIdx + 1);
    if (!/^\d+$/.test(a) || !/^\d+$/.test(b)) return false;
    const av = parseInt(a, 10);
    const bv = parseInt(b, 10);
    if (!inRange(av, min, max) || !inRange(bv, min, max)) return false;
    return av <= bv;
  }

  if (!/^\d+$/.test(s)) return false;
  return inRange(parseInt(s, 10), min, max);
}

/**
 * Validate a 5-field cron expression. Returns true iff syntactically valid.
 *
 * Accepted: "* * * * *", "*\/5 * * * *", "0 9-17 * * 1-5",
 *           "0 0 1,15 * *", "30 2 * * 0,6".
 * Rejected: "* * * *" (4 fields), "60 * * * *" (out of range),
 *           "\@daily" (shortcut), "* * * * MON" (named), "*\/abc * * * *" (non-numeric).
 */
export function isValidCronExpression(expr: unknown): boolean {
  if (typeof expr !== 'string') return false;
  const trimmed = expr.trim();
  if (trimmed === '') return false;

  const fields = trimmed.split(/\s+/);
  if (fields.length !== 5) return false;

  for (let i = 0; i < 5; i++) {
    const field = fields[i];
    const bounds = FIELD_BOUNDS[i];
    if (field === undefined || bounds === undefined) return false;
    if (!isValidField(field, bounds)) return false;
  }

  return true;
}
