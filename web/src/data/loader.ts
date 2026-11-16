// The only place that fetches data. Everything comes from <site>/data/, which is
// web/fixtures in development and data/processed for the real site (see vite.config.ts).

import type { Baseline, Daily, FileHeader, GridCell, GridMonth, Hotspot, Metadata, Monthly, RegionCollection, RegionData, RegionGrid } from './types';

export const SUPPORTED_SCHEMA = '1.0';

export class DataError extends Error {}

const base = `${import.meta.env.BASE_URL}data/`;

async function fetchJson<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(base + path);
  } catch {
    throw new DataError(`Could not reach ${path}. Check your connection.`);
  }
  if (!res.ok) throw new DataError(`Could not load ${path} (HTTP ${res.status}).`);
  try {
    return (await res.json()) as T;
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

/** Hotspots for one region and year. A missing file (404) means no detections that year: returns []. */
export function loadHotspots(regionId: string, year: number): Promise<Hotspot[]> {
  const path = `regions/${encodeURIComponent(regionId)}/hotspots/${year}.csv`;
  let hit = hotspotCache.get(path);
  if (!hit) {
    hit = (async () => {
      let res: Response;
      try {
        res = await fetch(base + path);
      } catch {
        throw new DataError(`Could not reach ${path}. Check your connection.`);
      }
      if (res.status === 404) return [];
      if (!res.ok) throw new DataError(`Could not load ${path} (HTTP ${res.status}).`);
      return parseHotspotCsv(await res.text(), path);
    })();
    hit.catch(() => hotspotCache.delete(path));
    hotspotCache.set(path, hit);
  }
  return hit;
}

// ---------- grid files (contract section 8b) ----------

async function fetchText(path: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(base + path);
  } catch {
    throw new DataError(`Could not reach ${path}. Check your connection.`);
  }
  if (!res.ok) throw new DataError(`Could not load ${path} (HTTP ${res.status}).`);
  return res.text();
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
