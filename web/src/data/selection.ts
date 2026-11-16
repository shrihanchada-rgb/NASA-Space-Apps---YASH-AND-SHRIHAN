// What the calendar, charts and downloads show: the whole region (default) or an area the user drew.
// Pure functions only (no fetching, no DOM) so they are easy to test.
//
// A drawn area is snapped outward to whole grid cells (0.25 degrees, docs/data-contract.md section 8b).
// Its monthly numbers are the sums of grid_monthly.csv over the cells inside the snapped box, and its
// CSV download is the hotspot rows inside the same box, so the two always agree.

import type { Baseline, BaselineMonth, BBox, GridCell, GridMonth, Hotspot, MonthRecord, Monthly } from './types';

export const GRID_DEG = 0.25;

/** One month of the current selection. count_harm null = no data (never 0). */
export interface SeriesMonth {
  year: number;
  month: number;
  countHarm: number | null;
  countLow: number | null;
  countHigh: number | null;
  rawModis: number | null;
  rawViirs: number | null;
  frpSum: number | null;
}

export interface Selection {
  kind: 'region' | 'area';
  regionId: string;
  label: string;
  box: BBox | null; // snapped box for an area, null for the whole region
  nCells: number | null; // grid cells in the area
  months: SeriesMonth[];
  baseline: BaselineMonth[];
  basePeriod: { start_year: number; end_year: number };
}

// ---------- grid ----------

const EPS = 1e-9;

/** Grid index of a coordinate, matching the pipeline: floor((lat + 90) / 0.25), floor((lon + 180) / 0.25). */
export function cellIndex(lat: number, lon: number, deg = GRID_DEG): [number, number] {
  return [Math.floor((lat + 90) / deg + EPS), Math.floor((lon + 180) / deg + EPS)];
}

/** Grow a box outward to whole grid cells, so the area is made of complete cells. */
export function snapBox(box: BBox, deg = GRID_DEG): BBox {
  const down = (v: number) => Math.floor(v / deg + EPS) * deg;
  const up = (v: number) => Math.ceil(v / deg - EPS) * deg;
  const r = (v: number) => Math.round(v * 1e6) / 1e6;
  const [w, s, e, n] = box;
  const out: BBox = [r(down(w)), r(down(s)), r(up(e)), r(up(n))];
  if (out[2] <= out[0]) out[2] = r(out[0] + deg);
  if (out[3] <= out[1]) out[3] = r(out[1] + deg);
  return out;
}

/** Cell index ranges covered by a snapped box: [latFrom, latTo, lonFrom, lonTo], inclusive. */
export function boxCells(box: BBox, deg = GRID_DEG): [number, number, number, number] {
  const [la0, lo0] = cellIndex(box[1], box[0], deg);
  const [la1, lo1] = cellIndex(box[3], box[2], deg);
  return [la0, la1 - 1, lo0, lo1 - 1];
}

/** Is a point inside a snapped box? Half-open (west/south edge in, east/north edge out), like the grid. */
export function pointInSnappedBox(lat: number, lon: number, box: BBox, deg = GRID_DEG): boolean {
  const [la, lo] = cellIndex(lat, lon, deg);
  const [la0, la1, lo0, lo1] = boxCells(box, deg);
  return la >= la0 && la <= la1 && lo >= lo0 && lo <= lo1;
}

/** Region cells that lie inside a snapped box. */
export function cellsInBox(cells: GridCell[], box: BBox, deg = GRID_DEG): GridCell[] {
  const [la0, la1, lo0, lo1] = boxCells(box, deg);
  return cells.filter((c) => c.lat_idx >= la0 && c.lat_idx <= la1 && c.lon_idx >= lo0 && c.lon_idx <= lo1);
}

// ---------- series ----------

const round2 = (v: number) => Math.round(v * 100) / 100;

export function regionSeries(monthly: Monthly): SeriesMonth[] {
  return monthly.months.map((m) => ({
    year: m.year, month: m.month, countHarm: m.count_harm, countLow: m.count_low, countHigh: m.count_high,
    rawModis: m.count_raw_modis, rawViirs: m.count_raw_viirs,
    frpSum: m.frp_sum_modis == null && m.frp_sum_viirs == null ? null : (m.frp_sum_modis ?? 0) + (m.frp_sum_viirs ?? 0),
  }));
}

/**
 * Monthly series of an area: sums of the grid rows of its cells. A month that has no data for the region
 * has no data for the area too. The range is the region's range for that month, scaled to the area.
 */
export function areaSeries(monthly: Monthly, grid: GridMonth[], cells: GridCell[]): SeriesMonth[] {
  const want = new Set(cells.map((c) => `${c.lat_idx}_${c.lon_idx}`));
  const sums = new Map<string, { harm: number; modis: number; viirs: number; frp: number }>();
  for (const g of grid) {
    if (!want.has(`${g.lat_idx}_${g.lon_idx}`)) continue;
    const k = `${g.year}-${g.month}`;
    const a = sums.get(k) ?? { harm: 0, modis: 0, viirs: 0, frp: 0 };
    a.harm += g.count_harm;
    a.modis += g.count_raw_modis;
    a.viirs += g.count_raw_viirs;
    a.frp += g.frp_sum;
    sums.set(k, a);
  }
  return monthly.months.map((m: MonthRecord) => {
    if (m.count_harm == null) {
      return { year: m.year, month: m.month, countHarm: null, countLow: null, countHigh: null, rawModis: null, rawViirs: null, frpSum: null };
    }
    const a = sums.get(`${m.year}-${m.month}`) ?? { harm: 0, modis: 0, viirs: 0, frp: 0 };
    const lowF = m.count_harm > 0 && m.count_low != null ? m.count_low / m.count_harm : 1;
    const highF = m.count_harm > 0 && m.count_high != null ? m.count_high / m.count_harm : 1;
    return {
      year: m.year, month: m.month, countHarm: round2(a.harm), countLow: round2(a.harm * lowF), countHigh: round2(a.harm * highF),
      rawModis: m.count_raw_modis == null ? null : a.modis, rawViirs: m.count_raw_viirs == null ? null : a.viirs, frpSum: round2(a.frp),
    };
  });
}

// ---------- baseline and colour values ----------

function quantile(sorted: number[], q: number): number {
  // Same as numpy.percentile (linear interpolation), which the pipeline uses.
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo] ?? 0;
  const b = sorted[hi] ?? a;
  return a + (b - a) * (pos - lo);
}

/** Per calendar month over the base period (contract section 6). Fewer than 3 years gives nulls. */
export function computeBaseline(months: SeriesMonth[], period: { start_year: number; end_year: number }): BaselineMonth[] {
  const out: BaselineMonth[] = [];
  for (let m = 1; m <= 12; m++) {
    const v = months
      .filter((x) => x.month === m && x.year >= period.start_year && x.year <= period.end_year && x.countHarm != null)
      .map((x) => x.countHarm as number)
      .sort((a, b) => a - b);
    if (v.length < 3) {
      out.push({ month: m, n_years: v.length, mean: null, std: null, p10: null, p25: null, p50: null, p75: null, p90: null });
      continue;
    }
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    const std = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1));
    const r = (x: number) => round2(x);
    out.push({ month: m, n_years: v.length, mean: r(mean), std: r(std), p10: r(quantile(v, 0.1)), p25: r(quantile(v, 0.25)),
      p50: r(quantile(v, 0.5)), p75: r(quantile(v, 0.75)), p90: r(quantile(v, 0.9)) });
  }
  return out;
}

/** Anomaly % = (value - mean) / mean x 100. Null if the value or the mean is missing or the mean is 0. */
export function anomalyPct(value: number | null, base: BaselineMonth | undefined): number | null {
  if (value == null || !base || base.mean == null || base.mean === 0) return null;
  return ((value - base.mean) / base.mean) * 100;
}

/** Percentile = share of base-period years (same calendar month) with a lower value, x 100. */
export function percentileOf(value: number | null, month: number, months: SeriesMonth[], period: { start_year: number; end_year: number }): number | null {
  if (value == null) return null;
  const v = months.filter((x) => x.month === month && x.year >= period.start_year && x.year <= period.end_year && x.countHarm != null);
  if (v.length < 3) return null;
  return (v.filter((x) => (x.countHarm as number) < value).length / v.length) * 100;
}

/** Rank among all years of the same calendar month (1 = most active). */
export function rankOf(m: SeriesMonth, months: SeriesMonth[]): { rank: number; of: number } | null {
  if (m.countHarm == null) return null;
  const same = months.filter((x) => x.month === m.month && x.countHarm != null);
  return { rank: same.filter((x) => (x.countHarm as number) > (m.countHarm as number)).length + 1, of: same.length };
}

// ---------- building a selection ----------

export function buildRegionSelection(regionId: string, name: string, monthly: Monthly, baseline: Baseline): Selection {
  return { kind: 'region', regionId, label: name, box: null, nCells: null, months: regionSeries(monthly),
    baseline: baseline.months, basePeriod: baseline.base_period };
}

export function buildAreaSelection(regionId: string, regionName: string, box: BBox, monthly: Monthly, baseline: Baseline,
  grid: GridMonth[], cells: GridCell[]): Selection {
  const inside = cellsInBox(cells, box);
  const months = areaSeries(monthly, grid, inside);
  return { kind: 'area', regionId, label: `Drawn area in ${regionName}`, box, nCells: inside.length, months,
    baseline: computeBaseline(months, baseline.base_period), basePeriod: baseline.base_period };
}

// ---------- slices used by charts and downloads ----------

export function ym(m: { year: number; month: number }): string {
  return `${m.year}-${String(m.month).padStart(2, '0')}`;
}

export function monthsInRange(months: SeriesMonth[], start: string, end: string): SeriesMonth[] {
  const a = start.slice(0, 7);
  const b = end.slice(0, 7);
  return months.filter((m) => ym(m) >= a && ym(m) <= b);
}

export interface YearTotal {
  year: number;
  total: number | null;
  monthsWithData: number;
  complete: boolean; // all 12 months have data
}

export function yearTotals(months: SeriesMonth[]): YearTotal[] {
  const by = new Map<number, YearTotal>();
  for (const m of months) {
    const y = by.get(m.year) ?? { year: m.year, total: null, monthsWithData: 0, complete: false };
    if (m.countHarm != null) {
      y.total = (y.total ?? 0) + m.countHarm;
      y.monthsWithData++;
    }
    by.set(m.year, y);
  }
  return [...by.values()].map((y) => ({ ...y, complete: y.monthsWithData === 12 })).sort((a, b) => a.year - b.year);
}

/** Hotspot rows of the selection and date range (an area uses the same snapped box as the grid). */
export function filterHotspots(points: Hotspot[], sel: Pick<Selection, 'box'>, start: string, end: string): Hotspot[] {
  return points.filter((p) => p.date >= start && p.date <= end && (!sel.box || pointInSnappedBox(p.latitude, p.longitude, sel.box)));
}
