import type { Selection } from './data/selection';
import type { Metadata, RegionCollection, RegionData } from './data/types';
import type { AppState, Store } from './state';

/** What is currently loaded for the selected region. */
export interface LoadState {
  regionData: RegionData | null;
  loading: boolean;
  /** What the calendar, charts and downloads show: the region, or the drawn area. Null while loading. */
  selection: Selection | null;
  selectionError: string | null;
}

/** Passed to every component. */
export interface AppContext {
  metadata: Metadata;
  regions: RegionCollection;
  state: Store<AppState>;
  loaded: Store<LoadState>;
}
