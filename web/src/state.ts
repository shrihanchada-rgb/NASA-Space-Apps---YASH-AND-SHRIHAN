// One small shared state object. Components read it and subscribe to changes;
// they never talk to each other directly.

import type { BBox } from './data/types';

export type ColorMode = 'absolute' | 'percentile' | 'anomaly';

export interface AppState {
  regionId: string | null;
  startDate: string | null; // YYYY-MM-DD
  endDate: string | null;
  colorMode: ColorMode;
  drawnBox: BBox | null; // a rectangle the user drew on the map; null = use the whole region
  drawing: boolean; // true while the map is in draw mode
}

export interface Store<T> {
  get(): T;
  set(patch: Partial<T>): void;
  subscribe(listener: (state: T, previous: T) => void): () => void;
}

type ErrorHandler = (err: unknown) => void;
let errorHandler: ErrorHandler = (err) => console.error(err);
/** Where errors from listeners go (main.ts shows them on the page). */
export function onStoreError(fn: ErrorHandler): void {
  errorHandler = fn;
}
function reportError(err: unknown): void {
  try {
    errorHandler(err);
  } catch {
    console.error(err);
  }
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<(state: T, previous: T) => void>();
  return {
    get: () => state,
    set(patch) {
      const keys = Object.keys(patch) as (keyof T)[];
      if (keys.every((k) => Object.is(state[k], patch[k]))) return; // nothing changed
      const previous = state;
      state = { ...state, ...patch };
      // One failing listener must not stop the others (each panel keeps working on its own).
      listeners.forEach((fn) => {
        try {
          fn(state, previous);
        } catch (err) {
          reportError(err);
        }
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
