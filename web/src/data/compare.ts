// S27 "current fire" comparison: the chosen dates against the same calendar dates in every other year.
// Pure functions only. Whole region: from daily.json (day precision). Drawn area: from the area's
// monthly series (whole months), because the grid files are monthly.

import { daysBetween } from './derive';
import type { SeriesMonth } from './selection';
import type { Daily } from './types';

const DAY_MS = 86_400_000;
export const MAX_WINDOW_DAYS = 366;
/** A year's window counts only if at most this share of its days (or months) has no data. */
export const MAX_MISSING_SHARE = 0.1;

export interface WindowStat {
  year: number; // year the window starts in
  start: string;
  end: string;
  count: number; // harmonized hotspots
  frp: number; // MW, sum of detections
  missingShare: number; // 0-1, days (or months) with no data
  peakDate: string | null; // busiest day (region) or month (area)
  peakCount: number;
}

export interface Comparison {
  unit: 'day' | 'month';
  selected: WindowStat;
  others: WindowStat[]; // usable past and later years, oldest first
  percentile: number | null; // share of other years with a lower count, x 100 (null if fewer than 3)
  rank: number; // 1 = most active of all usable years, including the selected one
  of: number;
  similar: WindowStat[]; // closest counts, most similar first (up to 5)
  skipped: number[]; // years left out because too much of the window has no data
}

/** Same month and day in another year. 29 Feb in a non-leap year becomes 1 Mar. */
export function shiftYear(date: string, years: number): string {
  const y = Number(date.slice(0, 4)) + years;
  return new Date(Date.UTC(y, Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)))).toISOString().slice(0, 10);
}

function iso(start: string, i: number): string {
  return new Date(Date.parse(start + 'T00:00:00Z') + i * DAY_MS).toISOString().slice(0, 10);
}

/** Totals of one window from daily.json. Null if the window is not fully inside the file. */
export function dailyWindow(daily: Daily, start: string, end: string): WindowStat | null {
  const n = daily.columns.count_harm.length;
  const from = daysBetween(daily.start, start);
  const to = daysBetween(daily.start, end);
  if (from < 0 || to >= n || to < from) return null;
  let count = 0, frp = 0, missing = 0, peakCount = -1, peak: number | null = null;
  for (let i = from; i <= to; i++) {
    const v = daily.columns.count_harm[i];
    if (v == null) { missing++; continue; }
    count += v;
    frp += daily.columns.frp_sum[i] ?? 0;
    if (v > peakCount) { peakCount = v; peak = i; }
  }
  return { year: Number(start.slice(0, 4)), start, end, count, frp, missingShare: missing / (to - from + 1),
    peakDate: peak == null ? null : iso(daily.start, peak), peakCount: Math.max(peakCount, 0) };
}

/** Totals of one window from a monthly series (whole months overlapping the dates). */
export function monthWindow(months: SeriesMonth[], start: string, end: string): WindowStat | null {
  const a = start.slice(0, 7);
  const b = end.slice(0, 7);
  const ym = (m: SeriesMonth) => `${m.year}-${String(m.month).padStart(2, '0')}`;
  const sel = months.filter((m) => ym(m) >= a && ym(m) <= b);
  const want = (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7)) + 1;
  if (sel.length < want) return null; // outside the data
  let count = 0, frp = 0, missing = 0, peakCount = -1, peak: string | null = null;
  for (const m of sel) {
    if (m.countHarm == null) { missing++; continue; }
    count += m.countHarm;
    frp += m.frpSum ?? 0;
    if (m.countHarm > peakCount) { peakCount = m.countHarm; peak = ym(m); }
  }
  return { year: Number(start.slice(0, 4)), start, end, count, frp, missingShare: missing / want, peakDate: peak, peakCount: Math.max(peakCount, 0) };
}

/**
 * Compare the window [start, end] with the same dates in every other year that has data.
 * Returns null if the window is longer than a year or not inside the data.
 */
export function compareWindow(
  get: (start: string, end: string) => WindowStat | null, unit: 'day' | 'month',
  start: string, end: string, coverage: { start: string; end: string },
): Comparison | null {
  if (daysBetween(start, end) + 1 > MAX_WINDOW_DAYS || end < start) return null;
  const selected = get(start, end);
  if (!selected) return null;
  const y0 = Number(coverage.start.slice(0, 4));
  const y1 = Number(coverage.end.slice(0, 4));
  const sy = Number(start.slice(0, 4));
  const others: WindowStat[] = [];
  const skipped: number[] = [];
  for (let y = y0; y <= y1; y++) {
    if (y === sy) continue;
    const s = shiftYear(start, y - sy);
    const e = shiftYear(end, y - sy);
    if (s < coverage.start || e > coverage.end) continue;
    const w = get(s, e);
    if (!w) continue;
    if (w.missingShare > MAX_MISSING_SHARE) skipped.push(y);
    else others.push(w);
  }
  const lower = others.filter((w) => w.count < selected.count).length;
  const closeness = (w: WindowStat) => Math.abs(Math.log1p(w.count) - Math.log1p(selected.count));
  return {
    unit, selected, others, skipped,
    percentile: others.length >= 3 ? (lower / others.length) * 100 : null,
    rank: others.filter((w) => w.count > selected.count).length + 1,
    of: others.length + 1,
    similar: [...others].sort((a, b) => closeness(a) - closeness(b) || b.year - a.year).slice(0, 5),
  };
}
