import type { Metadata, RegionCollection, RegionData } from './data/types';
import type { AppState, Store } from './state';

/** What is currently loaded for the selected region. */
export interface LoadState {
  regionData: RegionData | null;
  loading: boolean;
}

/** Passed to every component. */
export interface AppContext {
  metadata: Metadata;
  regions: RegionCollection;
  state: Store<AppState>;
  loaded: Store<LoadState>;
}
