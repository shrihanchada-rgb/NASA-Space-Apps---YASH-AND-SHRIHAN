// Shapes of the files the app reads. Must match docs/data-contract.md (schema_version 1.0).

export interface FileHeader {
  schema_version: string;
  method_version: string;
  is_sample: boolean;
}

export interface Metadata extends FileHeader {
  build_date: string;
  reference_scale: string;
  time_coverage: { start: string; end: string };
  sources: { source: string; first_date: string; last_date: string; n_detections_kept: number }[];
  filters: { min_confidence: 'low' | 'nominal' | 'high'; types_kept: number[] };
  grid_resolution_deg: number;
  regions: string[];
  sensor_transitions: { date: string; label: string }[];
  known_gaps: { start: string; end: string; sensor: 'MODIS' | 'VIIRS' | 'all'; note: string }[];
  validation: { r2: number | null; median_abs_pct_error: number | null; test_years: string };
  citation: string;
}

export interface RegionProperties {
  region_id: string;
  name: string;
  country: string;
  area_km2: number;
  bbox: BBox;
  boundary_source: string;
}

export interface RegionFeature {
  type: 'Feature';
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown };
  properties: RegionProperties;
}

export interface RegionCollection {
  type: 'FeatureCollection';
  features: RegionFeature[];
}

export interface MonthRecord {
  year: number;
  month: number; // 1-12
  count_harm: number | null; // null = no data, 0 = observed, no fires
  count_low: number | null; // lower end of the uncertainty band
  count_high: number | null; // upper end of the uncertainty band
  count_raw_modis: number | null;
  count_raw_viirs: number | null;
  raw_by_satellite: Partial<Record<'T' | 'A' | 'N' | 'N20' | 'N21', number>>;
  frp_sum_modis: number | null;
  frp_sum_viirs: number | null;
  share_high_confidence: number | null;
  n_days_observed: number;
}

export interface Monthly extends FileHeader {
  region_id: string;
  region_name: string;
  build_date: string;
  months: MonthRecord[];
}

export interface Daily extends FileHeader {
  region_id: string;
  build_date: string;
  start: string;
  end: string;
  columns: {
    count_harm: (number | null)[];
    count_raw_modis: (number | null)[];
    count_raw_viirs: (number | null)[];
    frp_sum: (number | null)[];
  };
}

export interface BaselineMonth {
  month: number;
  n_years: number;
  mean: number | null;
  std: number | null;
  p10: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p90: number | null;
}

export interface Baseline extends FileHeader {
  region_id: string;
  build_date: string;
  base_period: { start_year: number; end_year: number };
  months: BaselineMonth[];
}

/** One row of regions/<id>/hotspots/<year>.csv (docs/data-contract.md section 7). */
export interface Hotspot {
  date: string;
  time_utc: string;
  latitude: number;
  longitude: number;
  sensor: 'MODIS' | 'VIIRS';
  satellite: string;
  confidence: 'low' | 'nominal' | 'high';
  frp: number;
  daynight: 'D' | 'N';
  harmonized_weight: number;
  region_id: string;
}

/** [west, south, east, north] in degrees. */
export type BBox = [number, number, number, number];

/** Everything the app loads for one region. Hotspot CSVs are loaded on demand (drawn areas, map points, downloads). */
export interface RegionData {
  monthly: Monthly;
  daily: Daily;
  baseline: Baseline;
}
