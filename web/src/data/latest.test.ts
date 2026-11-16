import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { areaDays, dayNight, daysOfMonth, percentileInCalendarMonth, rampColor, rampPosition, regionDays, strongestDays, strongestInMonth } from './latest';
import { parseHotspotCsv } from './loader';
import type { Daily, Hotspot } from './types';

const FIX = path.resolve(__dirname, '../../fixtures');
const daily = JSON.parse(fs.readFileSync(path.join(FIX, 'regions/US-CA/daily.json'), 'utf8')) as Daily;

function daysWith(n: number): Daily {
  const harm = Array.from({ length: n }, (_, i) => (i === 3 ? null : i % 7));
  return { schema_version: '1.0', method_version: 't', is_sample: true, region_id: 'X', build_date: '', start: '2024-01-01', end: '2024-03-31',
    columns: { count_harm: harm, count_raw_modis: harm, count_raw_viirs: harm, frp_sum: harm } };
}

const pt = (date: string, lat: number, lon: number, w: number, dn: 'D' | 'N' = 'D', sensor: 'MODIS' | 'VIIRS' = 'VIIRS'): Hotspot => ({
  date, time_utc: '1000', latitude: lat, longitude: lon, sensor, satellite: 'N', confidence: 'high', frp: 10, daynight: dn, harmonized_weight: w, region_id: 'X',
});

describe('Latest page numbers', () => {
  it('lists the days of a month, leap years included', () => {
    expect(daysOfMonth('2024-02')).toHaveLength(29);
    expect(daysOfMonth('2023-02').at(-1)).toBe('2023-02-28');
  });

  it('keeps days with no satellite data as null, never zero', () => {
    const d = regionDays(daysWith(91), '2024-01');
    expect(d.get('2024-01-04')).toBeNull();
    expect(d.get('2024-01-05')?.count).toBe(4);
    expect(d.size).toBe(31);
  });

  it('an area covering the whole region gives the region count for every day (sample files)', () => {
    const month = '2020-08';
    const text = fs.readFileSync(path.join(FIX, `regions/US-CA/hotspots/${month}.csv`), 'utf8');
    const points = parseHotspotCsv(text);
    const whole: [number, number, number, number] = [-125, 32, -114, 42.5];
    const area = areaDays(daily, month, points, whole);
    const region = regionDays(daily, month);
    for (const [d, v] of region) {
      if (v == null) expect(area.get(d)).toBeNull();
      else expect(area.get(d)!.count).toBeCloseTo(v.count, 1);
    }
  });

  it('an area counts only the points inside its snapped box', () => {
    const d = daysWith(91);
    const pts = [pt('2024-01-02', 37.1, -120.1, 0.5), pt('2024-01-02', 39.1, -122.1, 2), pt('2024-01-04', 37.1, -120.1, 1)];
    const a = areaDays(d, '2024-01', pts, [-120.25, 37, -120, 37.25]);
    expect(a.get('2024-01-02')!.count).toBe(0.5);
    expect(a.get('2024-01-04')).toBeNull(); // no satellite data that day: stays null even with a point
    expect(a.get('2024-01-03')!.count).toBe(0);
  });

  it('splits a day into day and night by the weights', () => {
    const pts = [pt('2024-01-02', 37.1, -120.1, 0.5, 'D'), pt('2024-01-02', 37.1, -120.1, 1.5, 'N'), pt('2024-01-03', 37.1, -120.1, 9, 'N')];
    expect(dayNight(pts, '2024-01-02', null)).toEqual({ day: 0.5, night: 1.5, dayRows: 1, nightRows: 1 });
  });

  it('ranks strongest days and percentiles within the calendar month', () => {
    const top = strongestDays(daily, 3);
    expect(top).toHaveLength(3);
    expect(top[0]!.count).toBeGreaterThanOrEqual(top[1]!.count);
    const p = percentileInCalendarMonth(daily, top[0]!.date);
    expect(p).not.toBeNull();
    expect(strongestInMonth(new Map([['2024-01-01', { count: 2, rawModis: 0, rawViirs: 0, frp: 0 }], ['2024-01-02', null]]))).toEqual([{ date: '2024-01-01', count: 2 }]);
  });

  it('colours: log position from 1 to the biggest day, solid colours', () => {
    expect(rampPosition(1, 1000)).toBe(0);
    expect(rampPosition(1000, 1000)).toBe(1);
    expect(rampColor(0)).toBe('#faf3e3');
    expect(rampColor(1)).toBe('#7e2b1c');
  });
});
