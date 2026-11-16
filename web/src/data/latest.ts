// Numbers for the Latest page (Yashneil's day-by-day calendar structure, our harmonized data).
// Pure functions, tested in latest.test.ts.
//
// Whole region: daily.json. Drawn area: the hotspot rows inside the snapped box, summed per day by their
// harmonized_weight (the weights of a day add up to that day's harmonized count, contract section 7).
// A day with no satellite data for the region (null) has no data for the area too: never zero.

import { pointInSnappedBox, type SeriesMonth } from './selection';
import type { BBox, Daily, Hotspot } from './types';

const DAY_MS = 86_400_000;

export interface DayValue {
  count: number; // harmonized (MODIS-equivalent) hotspots
  rawModis: number;
  rawViirs: number;
  frp: number; // MW
}

export const isoDay = (start: string, i: number): string =>
  new Date(Date.parse(start + 'T00:00:00Z') + i * DAY_MS).toISOString().slice(0, 10);
const index = (daily: Daily, date: string): number =>
  Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(daily.start + 'T00:00:00Z')) / DAY_MS);

/** Days of a month (YYYY-MM) as YYYY-MM-DD. */
export function daysOfMonth(month: string): string[] {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

/** Region values for one month. Days outside the data are absent; days with no satellite data are null. */
export function regionDays(daily: Daily, month: string): Map<string, DayValue | null> {
  const out = new Map<string, DayValue | null>();
  const c = daily.columns;
  for (const d of daysOfMonth(month)) {
    const i = index(daily, d);
    if (i < 0 || i >= c.count_harm.length) continue;
    const v = c.count_harm[i];
    out.set(d, v == null ? null : { count: v, rawModis: c.count_raw_modis[i] ?? 0, rawViirs: c.count_raw_viirs[i] ?? 0, frp: c.frp_sum[i] ?? 0 });
  }
  return out;
}

/** Area values for one month, from the hotspot rows of that month. Same days as the region (null stays null). */
export function areaDays(daily: Daily, month: string, points: Hotspot[], box: BBox): Map<string, DayValue | null> {
  const region = regionDays(daily, month);
  const out = new Map<string, DayValue | null>();
  for (const [d, v] of region) out.set(d, v == null ? null : { count: 0, rawModis: 0, rawViirs: 0, frp: 0 });
  for (const p of points) {
    const v = out.get(p.date);
    if (!v || !pointInSnappedBox(p.latitude, p.longitude, box)) continue;
    v.count += p.harmonized_weight;
    if (p.sensor === 'MODIS') v.rawModis++;
    else v.rawViirs++;
    v.frp += p.frp;
  }
  for (const v of out.values()) if (v) { v.count = Math.round(v.count * 100) / 100; v.frp = Math.round(v.frp * 10) / 10; }
  return out;
}

/** Day and night parts of one day's harmonized count (from its hotspot rows). */
export function dayNight(points: Hotspot[], date: string, box: BBox | null): { day: number; night: number; dayRows: number; nightRows: number } {
  const r = { day: 0, night: 0, dayRows: 0, nightRows: 0 };
  for (const p of points) {
    if (p.date !== date || (box && !pointInSnappedBox(p.latitude, p.longitude, box))) continue;
    if (p.daynight === 'D') { r.day += p.harmonized_weight; r.dayRows++; } else { r.night += p.harmonized_weight; r.nightRows++; }
  }
  r.day = Math.round(r.day * 100) / 100;
  r.night = Math.round(r.night * 100) / 100;
  return r;
}

/** Share (0-100) of days with data in the same calendar month, all years, with a lower count. Null if under 30 days. */
export function percentileInCalendarMonth(daily: Daily, date: string): number | null {
  const mm = date.slice(5, 7);
  const i0 = index(daily, date);
  const v = daily.columns.count_harm[i0];
  if (v == null) return null;
  const same: number[] = [];
  daily.columns.count_harm.forEach((x, i) => { if (x != null && isoDay(daily.start, i).slice(5, 7) === mm) same.push(x); });
  if (same.length < 30) return null;
  return Math.round((same.filter((x) => x < v).length / Math.max(same.length - 1, 1)) * 100);
}

/** His "strongest days, trailing 24 months": top n days in the 24 calendar months ending with the data. */
export function strongestDays(daily: Daily, n = 5, months = 24): { date: string; count: number }[] {
  const end = daily.end;
  const cut = new Date(Date.UTC(Number(end.slice(0, 4)), Number(end.slice(5, 7)) - months, 1)).toISOString().slice(0, 10);
  const rows: { date: string; count: number }[] = [];
  daily.columns.count_harm.forEach((v, i) => { const d = isoDay(daily.start, i); if (v != null && d >= cut) rows.push({ date: d, count: v }); });
  return rows.sort((a, b) => b.count - a.count || a.date.localeCompare(b.date)).slice(0, n);
}

/** Top n days of a month's values. */
export function strongestInMonth(days: Map<string, DayValue | null>, n = 5): { date: string; count: number }[] {
  return [...days].filter((e): e is [string, DayValue] => e[1] != null && e[1].count > 0)
    .map(([date, v]) => ({ date, count: v.count })).sort((a, b) => b.count - a.count).slice(0, n);
}

/** Sum of the last 12 months that have data (works for the region and for an area). */
export function trailing12(months: SeriesMonth[]): { total: number; from: string; to: string } | null {
  const known = months.filter((m) => m.countHarm != null);
  const last = known.slice(-12);
  if (!last.length) return null;
  const ym = (m: SeriesMonth) => `${m.year}-${String(m.month).padStart(2, '0')}`;
  return { total: last.reduce((a, m) => a + (m.countHarm ?? 0), 0), from: ym(last[0]!), to: ym(last[last.length - 1]!) };
}

export function biggestDay(daily: Daily): { date: string; count: number } | null {
  let best: { date: string; count: number } | null = null;
  daily.columns.count_harm.forEach((v, i) => { if (v != null && (!best || v > best.count)) best = { date: isoDay(daily.start, i), count: v }; });
  return best;
}

export function daysWithData(daily: Daily): number {
  return daily.columns.count_harm.filter((v) => v != null).length;
}

// ---------- colours: his ramp (solid colour per cell), scaled to our data ----------

const STOPS = ['#faf3e3', '#e7cd90', '#d9a441', '#c8692b', '#c2452d', '#7e2b1c'];
function lerpHex(a: string, b: string, f: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) + (((pb >> s) & 255) - ((pa >> s) & 255)) * f);
  return `#${((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)}`;
}
/** Position 0-1 on a log scale from 1 to `max` hotspots per day. */
export function rampPosition(v: number, max: number): number {
  const hi = Math.log10(Math.max(max, 10));
  return Math.max(0, Math.min(1, Math.log10(Math.max(v, 1)) / hi));
}
export function rampColor(t: number): string {
  const scaled = Math.max(0, Math.min(1, t)) * (STOPS.length - 1);
  const i = Math.min(Math.floor(scaled), STOPS.length - 2);
  return lerpHex(STOPS[i]!, STOPS[i + 1]!, scaled - i);
}
export const LEGEND_STOPS = STOPS;
