import { describe, expect, it } from 'vitest';
import { boxAreaKm2, datePresets, fireSeasonMonths, monthPeaks, summarizePoints } from './derive';
import { parseHotspotCsv } from './loader';
import type { Baseline, Hotspot, MonthRecord, Monthly } from './types';

const m = (year: number, month: number, count: number | null, share: number | null = 0.5, raw = 10): MonthRecord => ({
  year, month, count_harm: count, count_low: count, count_high: count,
  count_raw_modis: count == null ? null : raw, count_raw_viirs: count == null ? null : 0, raw_by_satellite: {},
  frp_sum_modis: null, frp_sum_viirs: null, share_high_confidence: share, n_days_observed: count == null ? 0 : 30,
});
const monthly = (months: MonthRecord[]): Monthly => ({
  schema_version: '1.0', method_version: 'none', is_sample: true, region_id: 'XX', region_name: 'X', build_date: '2026-01-01', months,
});
const baseline = (means: (number | null)[]): Baseline => ({
  schema_version: '1.0', method_version: 'none', is_sample: true, region_id: 'XX', build_date: '2026-01-01',
  base_period: { start_year: 2020, end_year: 2025 },
  months: means.map((mean, i) => ({ month: i + 1, n_years: 3, mean, std: null, p10: null, p25: null, p50: null, p75: null, p90: null })),
});

describe('monthPeaks', () => {
  const data = monthly([m(2023, 7, 5), m(2023, 8, 40), m(2023, 9, null), m(2024, 8, 30), m(2024, 9, 25)]);
  it('finds the peak month and peak year, skipping missing months', () => {
    const p = monthPeaks(data, '2023-01-01', '2024-12-31');
    expect(p.peakMonth).toEqual({ year: 2023, month: 8, count: 40 });
    expect(p.peakYear).toEqual({ year: 2024, count: 55, monthsWithData: 2 });
    expect(p.wholeMonths).toBe(true);
  });
  it('flags ranges that cut months', () => {
    expect(monthPeaks(data, '2023-07-15', '2023-08-31').wholeMonths).toBe(false);
  });
  it('weights the high-confidence share by raw detections', () => {
    const d = monthly([m(2023, 1, 1, 1.0, 30), m(2023, 2, 1, 0.0, 10)]);
    expect(monthPeaks(d, '2023-01-01', '2023-02-28').shareHighConfidence).toBeCloseTo(0.75);
  });
  it('reports no peak when there were no fires', () => {
    expect(monthPeaks(monthly([m(2023, 2, 0)]), '2023-02-01', '2023-02-28').peakMonth).toBeNull();
  });
});

describe('fire season and presets', () => {
  it('picks the 3 months with the highest mean, wrapping the year end', () => {
    expect(fireSeasonMonths(baseline([9, 1, 1, 1, 1, 1, 1, 1, 1, 1, 8, 9]))).toEqual([11, 12, 1]);
    expect(fireSeasonMonths(baseline([0, 0, 0, 0, 0, 1, 5, 9, 6, 1, 0, 0]))).toEqual([7, 8, 9]);
  });
  it('skips windows that include a month with no baseline', () => {
    expect(fireSeasonMonths(baseline([0, 0, 0, 0, 0, null, 5, 9, 6, 1, 0, 0]))).toEqual([7, 8, 9]);
  });
  it('builds presets relative to the end of the data', () => {
    const p = datePresets({ start: '2023-01-01', end: '2025-12-31' }, baseline([0, 0, 0, 0, 0, 1, 5, 9, 6, 1, 0, 0]));
    expect(p.map((x) => [x.id, x.start, x.end])).toEqual([
      ['all', '2023-01-01', '2025-12-31'],
      ['last-30', '2025-12-02', '2025-12-31'],
      ['last-12m', '2025-01-01', '2025-12-31'],
      ['year', '2025-01-01', '2025-12-31'],
      ['season', '2025-07-01', '2025-09-30'],
    ]);
  });
  it('uses the previous year as the full year when data ends mid-year', () => {
    const p = datePresets({ start: '2000-11-01', end: '2026-08-31' }, null);
    expect(p.find((x) => x.id === 'year')).toMatchObject({ start: '2025-01-01', end: '2025-12-31' });
  });
});

describe('drawn areas', () => {
  const pt = (date: string, lon: number, lat: number, sensor: 'MODIS' | 'VIIRS', w: number): Hotspot => ({
    date, time_utc: '1200', latitude: lat, longitude: lon, sensor, satellite: 'T', confidence: 'high',
    frp: 10, daynight: 'D', harmonized_weight: w, region_id: 'XX',
  });
  it('counts only points inside the box and dates', () => {
    const pts = [pt('2023-08-01', 0.5, 0.5, 'MODIS', 1), pt('2023-08-01', 5, 5, 'VIIRS', 0.25), pt('2022-01-01', 0.5, 0.5, 'VIIRS', 0.25), pt('2023-08-02', 0.2, 0.9, 'VIIRS', 0.25)];
    expect(summarizePoints(pts, [0, 0, 1, 1], '2023-01-01', '2023-12-31')).toEqual({
      countHarm: 1.25, rawModis: 1, rawViirs: 1, frpSum: 20, highConfidence: 2, total: 2,
    });
  });
  it('computes box area (1 x 1 degree at the equator ~ 12,364 km2)', () => {
    expect(boxAreaKm2([0, 0, 1, 1])).toBeGreaterThan(12300);
    expect(boxAreaKm2([0, 0, 1, 1])).toBeLessThan(12400);
  });
  it('parses the contract CSV and rejects wrong columns', () => {
    const csv = 'date,time_utc,latitude,longitude,sensor,satellite,confidence,frp,daynight,harmonized_weight,region_id\n2023-05-27,1031,32.7,-116.3,VIIRS,N,nominal,27.2,N,0.25,US-CA\n';
    expect(parseHotspotCsv(csv)[0]).toMatchObject({ latitude: 32.7, sensor: 'VIIRS', harmonized_weight: 0.25 });
    expect(() => parseHotspotCsv('a,b\n1,2\n')).toThrow(/unexpected columns/);
  });
});
