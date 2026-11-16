import { describe, expect, it } from 'vitest';
import { compareWindow, dailyWindow, monthWindow, shiftYear } from './compare';
import type { SeriesMonth } from './selection';
import type { Daily } from './types';

// 4 years of days, 2020-01-01 .. 2023-12-31. Each year's August has a different level.
function makeDaily(): Daily {
  const start = '2020-01-01';
  const n = 1461;
  const harm: (number | null)[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.parse(start + 'T00:00:00Z') + i * 86_400_000);
    const level = { 2020: 10, 2021: 4, 2022: 1, 2023: 6 }[d.getUTCFullYear()] ?? 0;
    harm.push(d.getUTCMonth() === 7 ? level : 0);
  }
  harm[365 + 212 + 3] = null; // one missing day in Aug 2021
  return { schema_version: '1.0', method_version: 't', is_sample: true, region_id: 'X', build_date: '', start, end: '2023-12-31',
    columns: { count_harm: harm, count_raw_modis: harm, count_raw_viirs: harm, frp_sum: harm.map((v) => (v == null ? null : v * 2)) } };
}

describe('current-fire comparison', () => {
  it('shifts dates by whole years (29 Feb becomes 1 Mar)', () => {
    expect(shiftYear('2020-08-15', 3)).toBe('2023-08-15');
    expect(shiftYear('2020-02-29', 1)).toBe('2021-03-01');
  });

  it('sums a window, skips missing days, never counts them as zero', () => {
    const w = dailyWindow(makeDaily(), '2021-08-01', '2021-08-31')!;
    expect(w.count).toBe(30 * 4);
    expect(w.missingShare).toBeCloseTo(1 / 31);
    expect(w.frp).toBe(30 * 8);
    expect(dailyWindow(makeDaily(), '2019-12-01', '2020-01-05')).toBeNull();
  });

  it('ranks the window against the same dates in other years', () => {
    const d = makeDaily();
    const c = compareWindow((s, e) => dailyWindow(d, s, e), 'day', '2023-08-01', '2023-08-31', { start: d.start, end: d.end })!;
    expect(c.others.map((w) => w.year)).toEqual([2020, 2021, 2022]);
    expect(c.rank).toBe(2); // 2020 is bigger
    expect(c.percentile).toBeCloseTo((2 / 3) * 100);
    expect(c.similar[0]!.year).toBe(2021); // 120 is closest to 186 in log terms
  });

  it('refuses windows longer than a year', () => {
    const d = makeDaily();
    expect(compareWindow((s, e) => dailyWindow(d, s, e), 'day', '2020-01-01', '2021-06-01', { start: d.start, end: d.end })).toBeNull();
  });

  it('works on whole months for a drawn area and leaves out months with no data', () => {
    const months: SeriesMonth[] = [];
    for (let y = 2018; y <= 2022; y++) for (let m = 1; m <= 12; m++) {
      const v = y === 2019 && m === 8 ? null : m === 8 ? y - 2000 : 0;
      months.push({ year: y, month: m, countHarm: v, countLow: v, countHigh: v, rawModis: v, rawViirs: v, frpSum: v });
    }
    const c = compareWindow((s, e) => monthWindow(months, s, e), 'month', '2022-08-01', '2022-08-31', { start: '2018-01-01', end: '2022-12-31' })!;
    expect(c.selected.count).toBe(22);
    expect(c.skipped).toEqual([2019]);
    expect(c.rank).toBe(1);
  });
});
