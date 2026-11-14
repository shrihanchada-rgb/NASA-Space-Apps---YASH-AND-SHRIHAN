// Pure calculations on loaded data. No fetching, no DOM, so they are easy to test.

import type { Baseline, BBox, Daily, Hotspot, MonthRecord, Monthly } from './types';

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

// ---------- Month-level figures for a date range ----------

export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Months that overlap [start, end] at least partly. Month data cannot be split into days. */
export function monthsOverlapping(monthly: Monthly, start: string, end: string): MonthRecord[] {
  const first = start.slice(0, 7);
  const last = end.slice(0, 7);
  return monthly.months.filter((m) => {
    const ym = `${m.year}-${String(m.month).padStart(2, '0')}`;
    return ym >= first && ym <= last;
  });
}

export interface MonthPeaks {
  peakMonth: { year: number; month: number; count: number } | null;
  peakYear: { year: number; count: number; monthsWithData: number } | null;
  shareHighConfidence: number | null; // 0-1, weighted by raw detections
  wholeMonths: boolean; // false if the range starts or ends mid-month
}

export function monthPeaks(monthly: Monthly, start: string, end: string): MonthPeaks {
  const months = monthsOverlapping(monthly, start, end);
  let peakMonth: MonthPeaks['peakMonth'] = null;
  const byYear = new Map<number, { count: number; n: number }>();
  let highWeighted = 0;
  let weight = 0;
  for (const m of months) {
    if (m.count_harm == null) continue;
    if (!peakMonth || m.count_harm > peakMonth.count) peakMonth = { year: m.year, month: m.month, count: m.count_harm };
    const y = byYear.get(m.year) ?? { count: 0, n: 0 };
    byYear.set(m.year, { count: y.count + m.count_harm, n: y.n + 1 });
    const raw = (m.count_raw_modis ?? 0) + (m.count_raw_viirs ?? 0);
    if (m.share_high_confidence != null && raw > 0) {
      highWeighted += m.share_high_confidence * raw;
      weight += raw;
    }
  }
  let peakYear: MonthPeaks['peakYear'] = null;
  for (const [year, v] of byYear) {
    if (!peakYear || v.count > peakYear.count) peakYear = { year, count: v.count, monthsWithData: v.n };
  }
  const endDay = new Date(end + 'T00:00:00Z');
  const lastOfMonth = new Date(Date.UTC(endDay.getUTCFullYear(), endDay.getUTCMonth() + 1, 0)).getUTCDate();
  return {
    peakMonth: peakMonth && peakMonth.count > 0 ? peakMonth : null,
    peakYear: peakYear && peakYear.count > 0 ? peakYear : null,
    shareHighConfidence: weight > 0 ? highWeighted / weight : null,
    wholeMonths: start.endsWith('-01') && endDay.getUTCDate() === lastOfMonth,
  };
}

// ---------- Date presets ----------

export interface DatePreset {
  id: string;
  label: string;
  start: string;
  end: string;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  return isoDate(new Date(Date.parse(date + 'T00:00:00Z') + days * DAY_MS));
}

/**
 * The 3 consecutive calendar months with the highest average hotspot count (from the baseline).
 * Wraps around the year end (e.g. Nov-Jan). Null if the baseline has no usable values.
 */
export function fireSeasonMonths(baseline: Baseline): number[] | null {
  const mean = new Map(baseline.months.map((m) => [m.month, m.mean]));
  let best: { months: number[]; total: number } | null = null;
  for (let s = 1; s <= 12; s++) {
    const months = [s, (s % 12) + 1, ((s + 1) % 12) + 1];
    const values = months.map((m) => mean.get(m));
    if (values.some((v) => v == null)) continue;
    const total = values.reduce<number>((a, v) => a + (v ?? 0), 0);
    if (!best || total > best.total) best = { months, total };
  }
  return best && best.total > 0 ? best.months : null;
}

/** Quick date ranges, all relative to the last date in the data (not today's date). */
export function datePresets(coverage: { start: string; end: string }, baseline: Baseline | null): DatePreset[] {
  const { start, end } = coverage;
  const clampStart = (d: string) => (d < start ? start : d);
  const endYear = Number(end.slice(0, 4));
  const fullYear = end.endsWith('-12-31') ? endYear : endYear - 1;
  const presets: DatePreset[] = [
    { id: 'all', label: 'All data', start, end },
    { id: 'last-30', label: 'Last 30 days', start: clampStart(addDays(end, -29)), end },
    { id: 'last-12m', label: 'Last 12 months', start: clampStart(addDays(`${endYear - 1}${end.slice(4)}`, 1)), end },
  ];
  if (`${fullYear}-01-01` >= start) {
    presets.push({ id: 'year', label: `Year ${fullYear}`, start: `${fullYear}-01-01`, end: `${fullYear}-12-31` });
  }
  const season = baseline ? fireSeasonMonths(baseline) : null;
  if (season) {
    const [m1, , m3] = season as [number, number, number];
    const wraps = m3 < m1;
    const y1 = wraps ? fullYear - 1 : fullYear;
    const s = `${y1}-${String(m1).padStart(2, '0')}-01`;
    const e = isoDate(new Date(Date.UTC(fullYear, m3, 0)));
    if (s >= start && e <= end) {
      const name = `${MONTH_NAMES[m1 - 1]}–${MONTH_NAMES[m3 - 1]}`;
      presets.push({ id: 'season', label: `Fire season ${name} ${fullYear}`, start: s, end: e });
    }
  }
  return presets;
}

// ---------- Drawn areas ----------

export function inBox(lon: number, lat: number, box: BBox): boolean {
  return lon >= box[0] && lon <= box[2] && lat >= box[1] && lat <= box[3];
}

export function boxesOverlap(a: BBox, b: BBox): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

/** Area of a longitude/latitude box on a sphere, km². */
export function boxAreaKm2(box: BBox): number {
  const R = 6371.0088;
  const rad = Math.PI / 180;
  return R * R * (box[2] - box[0]) * rad * Math.abs(Math.sin(box[3] * rad) - Math.sin(box[1] * rad));
}

export interface PointSummary {
  countHarm: number; // sum of harmonized_weight
  rawModis: number;
  rawViirs: number;
  frpSum: number;
  highConfidence: number;
  total: number;
}

/** Totals for hotspot points inside a box and date range. */
export function summarizePoints(points: Hotspot[], box: BBox, start: string, end: string): PointSummary {
  const s: PointSummary = { countHarm: 0, rawModis: 0, rawViirs: 0, frpSum: 0, highConfidence: 0, total: 0 };
  for (const p of points) {
    if (p.date < start || p.date > end || !inBox(p.longitude, p.latitude, box)) continue;
    s.total++;
    s.countHarm += p.harmonized_weight;
    s.frpSum += p.frp;
    if (p.sensor === 'MODIS') s.rawModis++;
    else s.rawViirs++;
    if (p.confidence === 'high') s.highConfidence++;
  }
  return s;
}
