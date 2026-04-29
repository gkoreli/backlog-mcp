import { describe, it, expect } from 'vitest';
import { isValidCronExpression } from '@backlog-mcp/shared';

describe('isValidCronExpression', () => {
  describe('valid expressions', () => {
    const valid = [
      '* * * * *',
      '0 * * * *',                  // every hour on the hour
      '*/5 * * * *',                // every 5 minutes
      '0 9-17 * * 1-5',             // 9am-5pm weekdays
      '0 0 1,15 * *',               // 1st and 15th of month
      '30 2 * * 0,6',               // 2:30am weekends
      '0 0 1 1 *',                  // new year's day
      '59 23 31 12 *',              // last minute of year
      '0 0 * * 0',                  // midnight sundays
      '*/15 9-17 * * 1-5',          // every 15m during work hours
      '0 */2 * * *',                // every 2 hours
      '0 0-23/3 * * *',             // every 3rd hour
      '5,10,15,20,25,30 * * * *',   // explicit list
      '0 0 * * *',                  // daily at midnight
    ];
    for (const expr of valid) {
      it(`accepts: "${expr}"`, () => {
        expect(isValidCronExpression(expr)).toBe(true);
      });
    }

    it('tolerates leading/trailing whitespace', () => {
      expect(isValidCronExpression('  * * * * *  ')).toBe(true);
    });

    it('tolerates multi-space separators', () => {
      expect(isValidCronExpression('*   *  *  *  *')).toBe(true);
    });
  });

  describe('invalid expressions', () => {
    const invalid: Array<[string, string]> = [
      ['', 'empty string'],
      ['   ', 'whitespace only'],
      ['* * * *', 'four fields'],
      ['* * * * * *', 'six fields'],
      ['60 * * * *', 'minute out of range (60)'],
      ['-1 * * * *', 'negative minute'],
      ['* 24 * * *', 'hour out of range (24)'],
      ['* * 0 * *', 'day of month below range (0)'],
      ['* * 32 * *', 'day of month above range (32)'],
      ['* * * 0 *', 'month below range (0)'],
      ['* * * 13 *', 'month above range (13)'],
      ['* * * * 7', 'day of week above range (7)'],
      ['*/abc * * * *', 'non-numeric step'],
      ['*/0 * * * *', 'zero step'],
      ['*/-1 * * * *', 'negative step'],
      ['abc * * * *', 'non-numeric field'],
      ['@daily', '@-shortcut not supported'],
      ['@every 5m', '@every not supported'],
      ['* * * * MON', 'named day-of-week not supported'],
      ['* * * JAN *', 'named month not supported'],
      ['5- * * * *', 'incomplete range (trailing dash)'],
      ['-5 * * * *', 'incomplete range (leading dash)'],
      ['10-5 * * * *', 'reversed range'],
      ['1,,2 * * * *', 'empty list element'],
      [',1 * * * *', 'leading comma'],
      ['1, * * * *', 'trailing comma'],
      ['1,2,3/5 * * * *', 'step on list element (not supported)'],
      ['*/5/2 * * * *', 'double slash (not supported)'],
      ['* * * * */8', 'step exceeds day-of-week range'],
      ['5.5 * * * *', 'decimal value'],
    ];
    for (const [expr, reason] of invalid) {
      it(`rejects "${expr}" (${reason})`, () => {
        expect(isValidCronExpression(expr)).toBe(false);
      });
    }

    it('rejects non-string input (null)', () => {
      expect(isValidCronExpression(null)).toBe(false);
    });

    it('rejects non-string input (undefined)', () => {
      expect(isValidCronExpression(undefined)).toBe(false);
    });

    it('rejects non-string input (number)', () => {
      expect(isValidCronExpression(42 as unknown)).toBe(false);
    });

    it('rejects non-string input (object)', () => {
      expect(isValidCronExpression({ schedule: '* * * * *' } as unknown)).toBe(false);
    });
  });
});
