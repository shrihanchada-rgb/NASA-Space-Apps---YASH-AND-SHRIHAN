// The only place that fetches data. Everything comes from <site>/data/, which is
// web/fixtures in development and data/processed for the real site (see vite.config.ts).

import type { Baseline, Daily, FileHeader, Metadata, Monthly, RegionCollection, RegionData } from './types';

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
