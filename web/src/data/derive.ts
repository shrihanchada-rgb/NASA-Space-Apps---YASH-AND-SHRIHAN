// Pure calculations on loaded data. No fetching, no DOM, so they are easy to test.

import type { Daily } from './types';

const DAY_MS = 86_400_000;

/** Days from date a to date b (both YYYY-MM-DD, UTC). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY_MS);
}

export interface RangeSummary {
  start: string; // range actually used, after clamping to the data
  end: string;
  countHarm: number | null; // null = no data at all in the range
  rawModis: number | null;
  rawViirs: number | null;
  frpSum: number | null;
  daysObserved: number;
  daysMissing: number;
}

function sumOrNull(values: (number | null)[], from: number, to: number): number | null {
  let total = 0;
  let any = false;
  for (let i = from; i <= to; i++) {
    const v = values[i];
    if (v != null) {
      total += v;
      any = true;
    }
  }
  return any ? total : null;
}

/**
 * Totals for a date range. The range is clamped to the dates the file covers.
 * Missing days (null) are skipped and counted in daysMissing; they are never treated as zero.
 * Returns null if the range does not overlap the data.
 */
export function summarizeRange(daily: Daily, start: string, end: string): RangeSummary | null {
  const from = Math.max(0, daysBetween(daily.start, start));
  const to = Math.min(daily.columns.count_harm.length - 1, daysBetween(daily.start, end));
  if (from > to) return null;
  let observed = 0;
  for (let i = from; i <= to; i++) if (daily.columns.count_harm[i] != null) observed++;
  const iso = (i: number) => new Date(Date.parse(daily.start + 'T00:00:00Z') + i * DAY_MS).toISOString().slice(0, 10);
  return {
    start: iso(from),
    end: iso(to),
    countHarm: sumOrNull(daily.columns.count_harm, from, to),
    rawModis: sumOrNull(daily.columns.count_raw_modis, from, to),
    rawViirs: sumOrNull(daily.columns.count_raw_viirs, from, to),
    frpSum: sumOrNull(daily.columns.frp_sum, from, to),
    daysObserved: observed,
    daysMissing: to - from + 1 - observed,
  };
}
