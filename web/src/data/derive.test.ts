import { describe, expect, it } from 'vitest';
import { daysBetween, summarizeRange } from './derive';
import type { Daily } from './types';

const daily: Daily = {
  schema_version: '1.0',
  method_version: 'none',
  is_sample: true,
  region_id: 'XX',
  build_date: '2026-01-01',
  start: '2024-01-01',
  end: '2024-01-05',
  columns: {
    count_harm: [1, 0, null, 2.5, null],
    count_raw_modis: [1, 0, null, 1, null],
    count_raw_viirs: [0, 0, null, 6, null],
    frp_sum: [10, 0, null, 30.5, null],
  },
};

describe('daysBetween', () => {
  it('counts days across a leap day', () => {
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2);
  });
});

describe('summarizeRange', () => {
  it('sums a range and counts missing days separately from zeros', () => {
    const s = summarizeRange(daily, '2024-01-01', '2024-01-05');
    expect(s).toMatchObject({ countHarm: 3.5, rawModis: 2, rawViirs: 6, frpSum: 40.5, daysObserved: 3, daysMissing: 2 });
  });

  it('clamps a range that is wider than the data', () => {
    const s = summarizeRange(daily, '2020-01-01', '2030-01-01');
    expect(s).toMatchObject({ start: '2024-01-01', end: '2024-01-05', countHarm: 3.5 });
  });

  it('gives null totals, not zero, when every day is missing', () => {
    const s = summarizeRange(daily, '2024-01-03', '2024-01-03');
    expect(s).toMatchObject({ countHarm: null, daysObserved: 0, daysMissing: 1 });
  });

  it('gives zero when days were observed with no fires', () => {
    expect(summarizeRange(daily, '2024-01-02', '2024-01-02')?.countHarm).toBe(0);
  });

  it('returns null when the range does not overlap the data', () => {
    expect(summarizeRange(daily, '2025-01-01', '2025-01-31')).toBeNull();
  });
});
