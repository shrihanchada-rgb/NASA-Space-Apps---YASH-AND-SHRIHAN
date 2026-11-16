// CSV text for downloads. Pure functions (no DOM), so they are easy to test.

import type { Metadata, Hotspot } from './types';
import type { Selection, SeriesMonth } from './selection';
import { ym } from './selection';

export const HOTSPOT_COLUMNS = ['date', 'time_utc', 'latitude', 'longitude', 'sensor', 'satellite', 'confidence', 'frp', 'daynight', 'harmonized_weight', 'region_id'] as const;

/** Rows above this need the "one file per year" fallback (browsers handle it, but files get very large). */
export const ROW_CAP = 400_000;

const NA = 'NA';
const num = (v: number | null) => (v == null ? NA : String(Math.round(v * 100) / 100));

/** Comment lines (starting with #) at the top of every download: what, where, when, how, and the citation. */
export function headerLines(meta: Metadata, sel: Selection, start: string, end: string, what: string): string[] {
  const where = sel.box
    ? `Drawn area in region ${sel.regionId}: west ${sel.box[0]}, south ${sel.box[1]}, east ${sel.box[2]}, north ${sel.box[3]} (degrees; snapped outward to the 0.25-degree data grid, ${sel.nCells ?? 0} cells)`
    : `Region ${sel.label} (${sel.regionId})`;
  const lines = [
    `# Califire export: ${what}`,
    `# Selection: ${where}`,
    `# Dates: ${start} to ${end} (UTC)`,
    `# Harmonized count: ${meta.reference_scale}`,
    `# Method version: ${meta.method_version}; data built ${meta.build_date}; filters: confidence >= ${meta.filters.min_confidence}, types ${meta.filters.types_kept.join('/')}`,
    '# Missing data is written as NA (no satellite data), never as 0.',
    `# Citation: ${meta.citation}`,
  ];
  if (meta.is_sample) lines.splice(1, 0, '# SAMPLE DATA: these values are invented for development. They are not real fire data.');
  return lines;
}

export function hotspotsCsv(meta: Metadata, sel: Selection, start: string, end: string, rows: Hotspot[]): string {
  const body = rows.map((r) => HOTSPOT_COLUMNS.map((c) => String(r[c])).join(','));
  return [...headerLines(meta, sel, start, end, 'hotspot detections'), HOTSPOT_COLUMNS.join(','), ...body].join('\n') + '\n';
}

export function monthlyCsv(meta: Metadata, sel: Selection, start: string, end: string, months: SeriesMonth[]): string {
  const head = 'year,month,count_harm,count_low,count_high,count_raw_modis,count_raw_viirs,frp_sum';
  const body = months.map((m) => [m.year, m.month, num(m.countHarm), num(m.countLow), num(m.countHigh), num(m.rawModis), num(m.rawViirs), num(m.frpSum)].join(','));
  return [...headerLines(meta, sel, start, end, 'monthly series'), head, ...body].join('\n') + '\n';
}

/** Calendar as a table: one row per year, one column per month (harmonized count). */
export function calendarCsv(meta: Metadata, sel: Selection, start: string, end: string, months: SeriesMonth[]): string {
  const by = new Map(months.map((m) => [ym(m), m]));
  const years = [...new Set(months.map((m) => m.year))].sort((a, b) => a - b);
  const head = ['year', 'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec', 'year_total'].join(',');
  const body = years.map((y) => {
    const vals = Array.from({ length: 12 }, (_, i) => by.get(ym({ year: y, month: i + 1 })));
    const known = vals.filter((m) => m && m.countHarm != null).map((m) => m!.countHarm as number);
    return [y, ...vals.map((m) => (m ? num(m.countHarm) : '')), known.length ? num(known.reduce((a, b) => a + b, 0)) : NA].join(',');
  });
  return [...headerLines(meta, sel, start, end, 'burning calendar (harmonized count per month)'), head, ...body].join('\n') + '\n';
}

/** One row per day (Yashneil's "daily" download, on our data). Days without satellite data are NA, never 0. */
export interface DailyRow { date: string; countHarm: number | null; rawModis: number | null; rawViirs: number | null; frpSum: number | null }
export function dailyCsv(meta: Metadata, sel: Selection, start: string, end: string, rows: DailyRow[]): string {
  const head = 'date,count_harm,count_raw_modis,count_raw_viirs,frp_sum';
  const body = rows.map((r) => [r.date, num(r.countHarm), num(r.rawModis), num(r.rawViirs), num(r.frpSum)].join(','));
  return [...headerLines(meta, sel, start, end, 'daily series'), head, ...body].join('\n') + '\n';
}

/** One row per year (Yashneil's "yearly" download, on our data): sums of the months with data. */
export function yearlyCsv(meta: Metadata, sel: Selection, start: string, end: string, months: SeriesMonth[]): string {
  const head = 'year,count_harm,count_raw_modis,count_raw_viirs,frp_sum,months_with_data';
  const years = [...new Set(months.map((m) => m.year))].sort((a, b) => a - b);
  const body = years.map((y) => {
    const ms = months.filter((m) => m.year === y && m.countHarm != null);
    const sum = (f: (m: SeriesMonth) => number | null) => (ms.length ? ms.reduce((a, m) => a + (f(m) ?? 0), 0) : null);
    return [y, num(sum((m) => m.countHarm)), num(sum((m) => m.rawModis)), num(sum((m) => m.rawViirs)), num(sum((m) => m.frpSum)), ms.length].join(',');
  });
  return [...headerLines(meta, sel, start, end, 'yearly series (sums of the months with data)'), head, ...body].join('\n') + '\n';
}

/** File name: fire-<what>_<region or area>_<start>_<end>.csv */
export function fileName(what: string, sel: Selection, start: string, end: string): string {
  const where = sel.box ? `${sel.regionId}-area_${sel.box.map((v) => v.toFixed(2)).join('_')}` : sel.regionId;
  return `fire-${what}_${where}_${start}_${end}.csv`.replace(/[^A-Za-z0-9._-]/g, '');
}

/** Estimated number of hotspot rows: raw detections in the months of the range. */
export function estimateRows(months: SeriesMonth[]): number {
  return months.reduce((a, m) => a + (m.rawModis ?? 0) + (m.rawViirs ?? 0), 0);
}
