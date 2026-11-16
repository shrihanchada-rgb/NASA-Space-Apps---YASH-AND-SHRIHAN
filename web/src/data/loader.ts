// The only place that fetches data. Everything comes from <site>/data/, which is
// web/fixtures in development and data/processed for the real site (see vite.config.ts).

import type { Forecast, Baseline, Daily, FileHeader, GridCell, GridMonth, Hotspot, Metadata, Monthly, RegionCollection, RegionData, RegionGrid } from './types';

export const SUPPORTED_SCHEMA = '1.0';

export class DataError extends Error {}

const base = `${import.meta.env.BASE_URL}data/`;

/** Longest wait for one file (the largest month of hotspots is about 20 MB). */
export const FETCH_TIMEOUT_MS = 120_000;

/**
 * Fetch one data file as text. Never hangs: gives up after FETCH_TIMEOUT_MS.
 * Returns null for 404 when allowMissing is set (a missing hotspot month means no detections).
 */
async function getText(path: string, allowMissing = false): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetch(base + path, { signal: ctrl.signal });
    } catch {
      throw new DataError(ctrl.signal.aborted
        ? `Loading ${path} took too long. Check your connection and try again.`
        : `Could not reach ${path}. Check your connection.`);
    }
    if (allowMissing && res.status === 404) return null;
    if (!res.ok) throw new DataError(`Could not load ${path} (HTTP ${res.status}).`);
    try {
      return await res.text();
    } catch {
      throw new DataError(`Loading ${path} was interrupted. Check your connection and try again.`);
    }
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson<T>(path: string): Promise<T> {
  const text = (await getText(path))!;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new DataError(`${path} is not valid JSON.`);
  }
}

export function checkVersion(file: FileHeader, path: string): void {
  if (file.schema_version !== SUPPORTED_SCHEMA) {
    throw new DataError(
      `${path} uses data format ${file.schema_version}, but this app understands ${SUPPORTED_SCHEMA}.`,
    );
  }
}

export async function loadMetadata(): Promise<Metadata> {
  const meta = await fetchJson<Metadata>('metadata.json');
  checkVersion(meta, 'metadata.json');
  return meta;
}

export function loadRegions(): Promise<RegionCollection> {
  return fetchJson<RegionCollection>('regions.geojson');
}

const regionCache = new Map<string, Promise<RegionData>>();

export function loadRegionData(regionId: string): Promise<RegionData> {
  let hit = regionCache.get(regionId);
  if (!hit) {
    const dir = `regions/${encodeURIComponent(regionId)}/`;
    hit = Promise.all([
      fetchJson<Monthly>(dir + 'monthly.json'),
      fetchJson<Daily>(dir + 'daily.json'),
      fetchJson<Baseline>(dir + 'baseline.json'),
    ]).then(([monthly, daily, baseline]) => {
      checkVersion(monthly, dir + 'monthly.json');
      checkVersion(daily, dir + 'daily.json');
      checkVersion(baseline, dir + 'baseline.json');
      return { monthly, daily, baseline };
    });
    hit.catch(() => regionCache.delete(regionId)); // allow a retry after a failure
    regionCache.set(regionId, hit);
  }
  return hit;
}

const HOTSPOT_COLUMNS = [
  'date', 'time_utc', 'latitude', 'longitude', 'sensor', 'satellite',
  'confidence', 'frp', 'daynight', 'harmonized_weight', 'region_id',
] as const;

/** Parse a hotspot CSV. The contract's columns contain no commas or quotes, so a plain split is safe. */
export function parseHotspotCsv(text: string, path = 'hotspots'): Hotspot[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '' && !l.startsWith('#'));
  const header = lines.shift()?.split(',') ?? [];
  if (header.join(',') !== HOTSPOT_COLUMNS.join(',')) {
    throw new DataError(`${path} has unexpected columns: ${header.join(',')}`);
  }
  return lines.map((line) => {
    const v = line.split(',');
    return {
      date: v[0] ?? '',
      time_utc: v[1] ?? '',
      latitude: Number(v[2]),
      longitude: Number(v[3]),
      sensor: v[4] as Hotspot['sensor'],
      satellite: v[5] ?? '',
      confidence: v[6] as Hotspot['confidence'],
      frp: Number(v[7]),
      daynight: v[8] as Hotspot['daynight'],
      harmonized_weight: Number(v[9]),
      region_id: v[10] ?? '',
    };
  });
}

const hotspotCache = new Map<string, Promise<Hotspot[]>>();

/** Hotspots for one region and month (YYYY-MM). A missing file (404) means no detections that month: returns []. */
export function loadHotspotMonth(regionId: string, month: string): Promise<Hotspot[]> {
  const path = `regions/${encodeURIComponent(regionId)}/hotspots/${month}.csv`;
  let hit = hotspotCache.get(path);
  if (!hit) {
    hit = (async () => {
      const text = await getText(path, true);
      return text == null ? [] : parseHotspotCsv(text, path);
    })();
    hit.catch(() => hotspotCache.delete(path));
    hotspotCache.set(path, hit);
  }
  return hit;
}

/** Months (YYYY-MM) from start to end dates, inclusive. */
export function monthKeys(start: string, end: string): string[] {
  const out: string[] = [];
  let y = Number(start.slice(0, 4));
  let m = Number(start.slice(5, 7));
  const last = end.slice(0, 7);
  for (;;) {
    const k = `${y}-${String(m).padStart(2, '0')}`;
    if (k > last) break;
    out.push(k);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

/** All hotspots of a region between two dates (loads only the month files needed). */
export async function loadHotspots(regionId: string, start: string, end: string): Promise<Hotspot[]> {
  const parts = await Promise.all(monthKeys(start, end).map((k) => loadHotspotMonth(regionId, k)));
  return parts.flat().filter((p) => p.date >= start && p.date <= end);
}

// ---------- grid files (contract section 8b) ----------

async function fetchText(path: string): Promise<string> {
  return (await getText(path))!;
}

/** Parse a plain numeric CSV with the expected header into objects. */
export function parseNumericCsv<T>(text: string, columns: readonly string[], path: string): T[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const header = lines.shift() ?? '';
  if (header !== columns.join(',')) throw new DataError(`${path} has unexpected columns: ${header}`);
  return lines.map((line) => {
    const v = line.split(',');
    const o: Record<string, number> = {};
    columns.forEach((c, i) => { o[c] = Number(v[i]); });
    return o as T;
  });
}

const CELL_COLUMNS = ['lat_idx', 'lon_idx', 'lat', 'lon', 'share_in_region'] as const;
const GRID_COLUMNS = ['year', 'month', 'lat_idx', 'lon_idx', 'count_harm', 'count_raw_modis', 'count_raw_viirs', 'frp_sum'] as const;
const gridCache = new Map<string, Promise<RegionGrid>>();

export function loadGrid(regionId: string): Promise<RegionGrid> {
  let hit = gridCache.get(regionId);
  if (!hit) {
    const dir = `regions/${encodeURIComponent(regionId)}/`;
    hit = Promise.all([fetchText(dir + 'grid_cells.csv'), fetchText(dir + 'grid_monthly.csv')]).then(([c, g]) => ({
      cells: parseNumericCsv<GridCell>(c, CELL_COLUMNS, dir + 'grid_cells.csv'),
      months: parseNumericCsv<GridMonth>(g, GRID_COLUMNS, dir + 'grid_monthly.csv'),
    }));
    hit.catch(() => gridCache.delete(regionId));
    gridCache.set(regionId, hit);
  }
  return hit;
}

const forecastCache = new Map<string, Promise<Forecast | null>>();

/** The optional forecast file. Missing (404) or invalid means "no forecast": the page works without it. */
export function loadForecast(regionId: string): Promise<Forecast | null> {
  let hit = forecastCache.get(regionId);
  if (!hit) {
    const path = `regions/${encodeURIComponent(regionId)}/forecast.json`;
    hit = getText(path, true).then((text) => {
      if (text == null) return null;
      try {
        const f = JSON.parse(text) as Forecast;
        const ok = f.kind === 'experimental_forecast' && Array.isArray(f.predictions) && f.predictions.every((p) =>
          /^\d{4}-\d{2}-\d{2}$/.test(p.date) && [p.q10, p.median, p.q90].every(Number.isFinite) && p.q10 >= 0 && p.q10 <= p.median && p.median <= p.q90);
        return ok ? f : null;
      } catch {
        return null;
      }
    }).catch(() => null);
    forecastCache.set(regionId, hit);
  }
  return hit;
}
