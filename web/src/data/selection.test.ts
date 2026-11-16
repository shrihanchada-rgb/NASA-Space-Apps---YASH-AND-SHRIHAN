import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cellInfos } from '../components/calendar';
import { calendarCsv, estimateRows, fileName, headerLines, hotspotsCsv, monthlyCsv } from './export';
import { parseHotspotCsv, parseNumericCsv } from './loader';
import {
  anomalyPct, boxCells, buildAreaSelection, buildRegionSelection, cellIndex, computeBaseline, filterHotspots,
  monthsInRange, percentileOf, pointInSnappedBox, rankOf, snapBox, yearTotals, type SeriesMonth,
} from './selection';
import type { Baseline, GridCell, GridMonth, Metadata, Monthly } from './types';

const FX = path.resolve(__dirname, '../../fixtures');
const read = (p: string) => fs.readFileSync(path.join(FX, p), 'utf8');
const meta = JSON.parse(read('metadata.json')) as Metadata;
const monthly = JSON.parse(read('regions/US-CA/monthly.json')) as Monthly;
const baseline = JSON.parse(read('regions/US-CA/baseline.json')) as Baseline;
const cells = parseNumericCsv<GridCell>(read('regions/US-CA/grid_cells.csv'), ['lat_idx', 'lon_idx', 'lat', 'lon', 'share_in_region'], 'cells');
const grid = parseNumericCsv<GridMonth>(read('regions/US-CA/grid_monthly.csv'),
  ['year', 'month', 'lat_idx', 'lon_idx', 'count_harm', 'count_raw_modis', 'count_raw_viirs', 'frp_sum'], 'grid');
const points = fs.readdirSync(path.join(FX, 'regions/US-CA/hotspots')).flatMap((f) => parseHotspotCsv(read(`regions/US-CA/hotspots/${f}`)));

describe('grid snapping', () => {
  it('matches the pipeline cell index and snaps outward to whole 0.25-degree cells', () => {
    expect(cellIndex(38.1, -121.9)).toEqual([512, 232]);
    expect(snapBox([-122.1, 37.3, -121.6, 37.9])).toEqual([-122.25, 37.25, -121.5, 38]);
    expect(snapBox([-122, 37, -121.5, 37.5])).toEqual([-122, 37, -121.5, 37.5]);   // already on the grid
    expect(boxCells([-122, 37, -121.5, 37.5])).toEqual([508, 509, 232, 233]);
  });
  it('puts edge points in exactly one of two touching boxes', () => {
    const a = snapBox([-122, 37, -121.5, 37.5]);
    const b = snapBox([-121.5, 37, -121, 37.5]);
    for (const lon of [-121.5, -121.50001, -121.49999]) {
      expect(Number(pointInSnappedBox(37.2, lon, a)) + Number(pointInSnappedBox(37.2, lon, b))).toBe(1);
    }
  });
});

describe('area selection agrees with the hotspot rows (no double counting, nothing lost)', () => {
  const boxes = [snapBox([-122.9, 39.2, -120.8, 41.3]), snapBox([-118, 33.8, -116.6, 34.7]), snapBox([-124.5, 32.4, -114, 42.1])];
  for (const box of boxes) {
    it(`box ${box.join(',')}`, () => {
      const sel = buildAreaSelection('US-CA', 'California', box, monthly, baseline, grid, cells);
      const rows = filterHotspots(points, sel, '1900-01-01', '2100-12-31');
      for (const m of sel.months) {
        const key = `${m.year}-${String(m.month).padStart(2, '0')}`;
        const mine = rows.filter((p) => p.date.startsWith(key));
        if (m.countHarm == null) { expect(mine.length).toBe(0); continue; }
        expect(m.countHarm).toBeCloseTo(mine.reduce((a, p) => a + p.harmonized_weight, 0), 1);
        expect(m.rawModis).toBe(mine.filter((p) => p.sensor === 'MODIS').length);
        expect(m.rawViirs).toBe(mine.filter((p) => p.sensor === 'VIIRS').length);
      }
    });
  }
  it('a box over the whole state gives the region numbers', () => {
    const sel = buildAreaSelection('US-CA', 'California', snapBox([-125, 32, -114, 42.25]), monthly, baseline, grid, cells);
    const reg = buildRegionSelection('US-CA', 'California', monthly, baseline);
    sel.months.forEach((m, i) => expect(m.countHarm ?? -1).toBeCloseTo(reg.months[i]!.countHarm ?? -1, 1));
    expect(sel.nCells).toBe(cells.length);
  });
  it('months with no data for the region have no data for any area', () => {
    const sel = buildAreaSelection('US-CA', 'California', snapBox([-122, 37, -121, 38]), monthly, baseline, grid, cells);
    const missing = monthly.months.filter((m) => m.count_harm == null).map((m) => `${m.year}-${m.month}`);
    expect(missing.length).toBeGreaterThan(0);
    for (const m of sel.months) if (missing.includes(`${m.year}-${m.month}`)) expect(m.countHarm).toBeNull();
  });
  it('an area outside the region has no cells', () => {
    expect(buildAreaSelection('US-CA', 'California', snapBox([-100, 20, -99, 21]), monthly, baseline, grid, cells).nCells).toBe(0);
  });
  it('area baseline equals the region baseline when the area is the whole region', () => {
    const sel = buildAreaSelection('US-CA', 'California', snapBox([-125, 32, -114, 42.25]), monthly, baseline, grid, cells);
    sel.baseline.forEach((b, i) => {
      const r = baseline.months[i]!;
      expect(b.n_years).toBe(r.n_years);
      if (r.mean != null) expect(b.mean).toBeCloseTo(r.mean, 1);
    });
  });
});

const sm = (year: number, month: number, v: number | null): SeriesMonth => ({ year, month, countHarm: v, countLow: v, countHigh: v, rawModis: v, rawViirs: v, frpSum: v });

describe('colour values', () => {
  const months = [sm(2020, 8, 100), sm(2021, 8, 10), sm(2022, 8, 40), sm(2023, 8, null), sm(2024, 8, 0)];
  const period = { start_year: 2020, end_year: 2024 };
  it('baseline uses numpy-style percentiles and needs 3 years', () => {
    const b = computeBaseline(months, period)[7]!;
    expect(b.n_years).toBe(4);
    expect(b.mean).toBe(37.5);
    expect(b.p50).toBe(25);
    expect(computeBaseline(months.slice(0, 2), period)[7]!.mean).toBeNull();
  });
  it('anomaly, percentile and rank follow the contract definitions', () => {
    const b = computeBaseline(months, period)[7]!;
    expect(anomalyPct(75, b)).toBeCloseTo(100);
    expect(anomalyPct(null, b)).toBeNull();
    expect(percentileOf(40, 8, months, period)).toBe(50);   // 0 and 10 are lower: 2 of 4
    expect(rankOf(months[2]!, months)).toEqual({ rank: 2, of: 4 });
  });
  it('calendar hatches missing months; zero is the lightest step, or far below normal in anomaly mode', () => {
    const sel = { kind: 'region' as const, regionId: 'X', label: 'X', box: null, nCells: null, months, baseline: computeBaseline(months, period), basePeriod: period };
    for (const mode of ['absolute', 'percentile', 'anomaly'] as const) {
      const c = cellInfos(sel, mode);
      expect(c[3]!.color).toBeNull();
      expect(c[4]!.color).toBe(mode === 'anomaly' ? 'var(--div-0)' : 'var(--seq-0)');   // 0 fires = far below normal
    }
    expect(cellInfos(sel, 'absolute')[0]!.color).toBe('var(--seq-6)');
    expect(cellInfos(sel, 'anomaly')[0]!.color).toBe('var(--div-5)');   // +167 %
  });
  it('year totals flag partial years', () => {
    const t = yearTotals([sm(2020, 1, 5), sm(2020, 2, null)]);
    expect(t[0]).toMatchObject({ year: 2020, total: 5, monthsWithData: 1, complete: false });
  });
});

describe('CSV downloads', () => {
  const reg = buildRegionSelection('US-CA', 'California', monthly, baseline);
  const area = buildAreaSelection('US-CA', 'California', snapBox([-122.1, 37.3, -121.6, 37.9]), monthly, baseline, grid, cells);
  it('header names the selection, dates, method, citation and the sample warning', () => {
    const lines = headerLines(meta, area, '2020-01-01', '2020-12-31', 'hotspot detections');
    expect(lines.every((l) => l.startsWith('#'))).toBe(true);
    expect(lines.join('\n')).toContain('west -122.25, south 37.25, east -121.5, north 38');
    expect(lines.join('\n')).toContain('SAMPLE DATA');
    expect(lines.join('\n')).toContain(meta.citation);
  });
  it('hotspot CSV has the contract columns and only rows in the area and dates', () => {
    const rows = filterHotspots(points, area, '2020-01-01', '2020-12-31');
    const text = hotspotsCsv(meta, area, '2020-01-01', '2020-12-31', rows);
    const data = text.split('\n').filter((l) => l && !l.startsWith('#'));
    expect(data[0]).toBe('date,time_utc,latitude,longitude,sensor,satellite,confidence,frp,daynight,harmonized_weight,region_id');
    expect(data.length - 1).toBe(rows.length);
    expect(parseHotspotCsv(text).length).toBe(rows.length);
  });
  it('monthly and calendar CSVs write missing months as NA, never 0', () => {
    const months = monthsInRange(reg.months, '2024-01-01', '2024-12-31');
    expect(monthlyCsv(meta, reg, '2024-01-01', '2024-12-31', months)).toMatch(/\n2024,6,NA,NA,NA,NA,NA,NA\n/);
    const cal = calendarCsv(meta, reg, '2024-01-01', '2024-12-31', months).split('\n').find((l) => l.startsWith('2024,'))!;
    expect(cal.split(',')[6]).toBe('NA');
    expect(cal.split(',').length).toBe(14);
  });
  it('file names and row estimates', () => {
    expect(fileName('hotspots', area, '2020-01-01', '2020-12-31')).toBe('fire-hotspots_US-CA-area_-122.25_37.25_-121.50_38.00_2020-01-01_2020-12-31.csv');
    const months = monthsInRange(reg.months, '2020-01-01', '2020-12-31');
    expect(estimateRows(months)).toBe(points.filter((p) => p.date.startsWith('2020')).length);
  });
});

import { monthKeys } from './loader';
describe('monthKeys (hotspot month files to load)', () => {
  it('lists every month between two dates, across a year end', () => {
    expect(monthKeys('2023-11-15', '2024-02-01')).toEqual(['2023-11', '2023-12', '2024-01', '2024-02']);
    expect(monthKeys('2024-05-03', '2024-05-20')).toEqual(['2024-05']);
  });
});

import { clampBox } from './selection';
describe('clampBox (drawing is limited to the region)', () => {
  const ca: [number, number, number, number] = [-124.4, 32.5, -114.1, 42];
  it('keeps a box inside the region unchanged', () => {
    expect(clampBox([-122, 37, -121, 38], ca)).toEqual([-122, 37, -121, 38]);
  });
  it('cuts a box that sticks out', () => {
    expect(clampBox([-130, 30, -120, 45], ca)).toEqual([-124.4, 32.5, -120, 42]);
  });
  it('returns null for a box wholly outside (the Pacific, Nevada east of the region)', () => {
    expect(clampBox([-130, 36, -126, 38], ca)).toBeNull();
    expect(clampBox([-112, 36, -110, 38], ca)).toBeNull();
  });
});
