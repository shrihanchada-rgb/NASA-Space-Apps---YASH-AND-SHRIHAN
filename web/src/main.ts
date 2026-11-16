import '@fontsource-variable/ibm-plex-sans';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles.css';
import { mountCalendar } from './components/calendar';
import { mountCharts } from './components/charts';
import { mountCompare } from './components/compare';
import { mountControls } from './components/controls';
import { mountDownloads } from './components/downloads';
import { mountMap } from './components/mapView';
import { mountSummary } from './components/summary';
import type { AppContext, LoadState } from './context';
import { loadGrid, loadMetadata, loadRegionData, loadRegions } from './data/loader';
import { buildAreaSelection, buildRegionSelection } from './data/selection';
import { type AppState, createStore, onStoreError } from './state';

function need(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in index.html`);
  return el;
}

const status = need('status');
function showError(message: string): void {
  status.textContent = message;
  status.hidden = false;
}

/** An unexpected error: log it, and tell the user once without hiding the rest of the page. */
let reported = false;
function reportUnexpected(err: unknown): void {
  console.error(err);
  if (reported) return;
  reported = true;
  showError('Something went wrong in part of the page. The rest still works; reload the page if a panel looks wrong.');
}
onStoreError(reportUnexpected);
window.addEventListener('error', (e) => reportUnexpected(e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => reportUnexpected(e.reason));

/** Start one panel. If it fails, show why inside that panel and keep the others running. */
function mountSafely(el: HTMLElement, what: string, mount: () => void): void {
  try {
    mount();
  } catch (err) {
    console.error(err);
    const p = document.createElement('p');
    p.className = 'field-error';
    p.textContent = `The ${what} could not start${err instanceof Error && err.message ? `: ${err.message.replace(/\.$/, '')}.` : '.'}`;
    el.replaceChildren(p);
  }
}

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

async function start(): Promise<void> {
  const [metadata, regions] = await Promise.all([loadMetadata(), loadRegions()]);

  const state = createStore<AppState>({
    regionId: regions.features[0]?.properties.region_id ?? null,
    startDate: metadata.time_coverage.start,
    endDate: metadata.time_coverage.end,
    colorMode: 'absolute',
    drawnBox: null,
    drawing: false,
  });
  const loaded = createStore<LoadState>({ regionData: null, loading: false, selection: null, selectionError: null });
  const ctx: AppContext = { metadata, regions, state, loaded };

  const tag = (text: string, cls = '') => {
    const t = document.createElement('span');
    t.className = `tag ${cls}`;
    const dot = document.createElement('span');
    dot.className = 'tag-dot';
    t.append(dot, text);
    return t;
  };
  need('data-status').replaceChildren(
    tag(metadata.is_sample ? 'Sample data' : 'FIRMS data', metadata.is_sample ? 'is-sample' : ''),
    tag(`Built ${metadata.build_date}`),
    tag(`Method ${metadata.method_version}`),
  );
  if (metadata.is_sample) {
    const banner = need('sample-banner');
    banner.textContent = 'Sample data: these numbers are invented for development. They are not real fire data.';
    banner.hidden = false;
  }

  mountSafely(need('controls'), 'selection panel', () => mountControls(need('controls'), ctx));
  mountSafely(need('summary'), 'summary', () => mountSummary(need('summary'), ctx));
  mountSafely(need('map'), 'map', () => {
    if (!webglAvailable()) throw new Error('this browser has WebGL turned off or unsupported, which the map needs. Everything else works.');
    mountMap(need('map'), need('map-note'), need('map-tools'), ctx);
  });
  mountSafely(need('compare'), 'comparison', () => mountCompare(need('compare'), ctx));
  mountSafely(need('calendar'), 'calendar', () => mountCalendar(need('calendar'), ctx));
  mountSafely(need('charts'), 'charts', () => mountCharts(need('charts'), ctx));
  mountSafely(need('downloads'), 'downloads', () => mountDownloads(need('downloads'), ctx));

  need('footer').textContent =
    `${metadata.citation} Map imagery: NASA Global Imagery Browse Services (GIBS).`;

  // The selection (whole region by default, or the drawn area) feeds the calendar, charts and downloads.
  let selToken = 0;
  async function updateSelection(): Promise<void> {
    const mine = ++selToken;
    const { regionId, drawnBox } = state.get();
    const { regionData } = loaded.get();
    const region = regions.features.find((f) => f.properties.region_id === regionId)?.properties;
    if (!regionId || !regionData || !region) return;
    if (!drawnBox) {
      loaded.set({ selection: buildRegionSelection(regionId, region.name, regionData.monthly, regionData.baseline), selectionError: null });
      return;
    }
    loaded.set({ selection: null, selectionError: null });
    try {
      const grid = await loadGrid(regionId);
      if (mine !== selToken) return; // a newer selection was made meanwhile
      const sel = buildAreaSelection(regionId, region.name, drawnBox, regionData.monthly, regionData.baseline, grid.months, grid.cells);
      loaded.set(sel.nCells
        ? { selection: sel, selectionError: null }
        : { selection: null, selectionError: `The drawn area is outside ${region.name}. Draw inside the outline, or clear the area.` });
    } catch (err) {
      if (mine === selToken) loaded.set({ selection: null, selectionError: err instanceof Error ? err.message : 'Could not load the area data.' });
    }
  }

  async function loadSelected(): Promise<void> {
    const id = state.get().regionId;
    if (!id) return;
    loaded.set({ regionData: null, loading: true, selection: null });
    try {
      const regionData = await loadRegionData(id);
      if (state.get().regionId === id) loaded.set({ regionData, loading: false }); // ignore stale answers
      status.hidden = true;
      void updateSelection();
    } catch (err) {
      if (state.get().regionId === id) loaded.set({ regionData: null, loading: false });
      showError(err instanceof Error ? err.message : 'Could not load the region data.');
    }
  }
  state.subscribe((s, prev) => {
    if (s.regionId !== prev.regionId) void loadSelected();
    else if (s.drawnBox !== prev.drawnBox) void updateSelection();
  });
  await loadSelected();
}

start().catch((err: unknown) => {
  showError(err instanceof Error ? err.message : 'The app could not start.');
});
