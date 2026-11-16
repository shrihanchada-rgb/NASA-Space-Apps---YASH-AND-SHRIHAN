// One script for all of our pages (Overview, Archive, Map, Compare, Download). Each page has only some of the
// panels; a panel is started only if its container is on the page. Fonts (Inter) come from the page's <link>.
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
import { buildAreaSelection, buildRegionSelection, clampBox, snapBox } from './data/selection';
import { readSelection, renderFooter, renderTopbar, selectionQuery, syncSelectionLinks } from './shell';
import { type AppState, createStore, onStoreError } from './state';

function need(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in this page`);
  return el;
}
const find = (id: string): HTMLElement | null => document.getElementById(id);
const page = document.body.dataset.page ?? 'overview';

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

  // The selection can come from the address (set by another page). Dates must be inside the data;
  // an area is cut to the region and snapped to the grid, like a drawn one.
  const cov = metadata.time_coverage;
  const fromUrl = readSelection(location.search);
  const regionId = regions.features[0]?.properties.region_id ?? null;
  const regionBox = regions.features[0]?.properties.bbox;
  const datesOk = fromUrl.startDate && fromUrl.endDate && fromUrl.startDate >= cov.start && fromUrl.endDate <= cov.end;
  const urlBox = fromUrl.drawnBox && regionBox ? clampBox(fromUrl.drawnBox, regionBox) : null;
  const state = createStore<AppState>({
    regionId,
    startDate: datesOk ? fromUrl.startDate! : cov.start,
    endDate: datesOk ? fromUrl.endDate! : cov.end,
    colorMode: fromUrl.colorMode ?? 'absolute',
    drawnBox: urlBox ? snapBox(urlBox) : null,
    drawing: false,
  });
  const loaded = createStore<LoadState>({ regionData: null, loading: false, selection: null, selectionError: null });
  const ctx: AppContext = { metadata, regions, state, loaded };

  renderTopbar(need('topbar'), page, `${metadata.is_sample ? 'Sample data · ' : ''}Data to ${cov.end} · Method ${metadata.method_version}`);
  renderFooter(need('footer'), `${metadata.citation} Map imagery: NASA GIBS.`);
  // On phones the selection panel starts folded; its summary line says what is chosen.
  const selBox = find('sel-box') as HTMLDetailsElement | null;
  const selSummary = find('sel-summary');
  if (selBox && window.matchMedia('(max-width: 900px)').matches) selBox.open = false;
  const describeSelection = () => {
    if (!selSummary) return;
    const s = state.get();
    selSummary.textContent = `Dates and area: ${s.startDate} – ${s.endDate} · ${s.drawnBox ? 'drawn area' : 'all of California'}`;
  };
  describeSelection();
  const keepInAddress = () => { syncSelectionLinks(selectionQuery(state.get(), cov)); describeSelection(); };
  keepInAddress();
  state.subscribe((s, p) => {
    if (s.startDate !== p.startDate || s.endDate !== p.endDate || s.drawnBox !== p.drawnBox || s.colorMode !== p.colorMode) keepInAddress();
  });
  if (metadata.is_sample) {
    const banner = need('sample-banner');
    banner.textContent = 'Sample data: these numbers are invented for development. They are not real fire data.';
    banner.hidden = false;
  }

  // Each panel only where this page has its container.
  const panel = (id: string, what: string, mount: (el: HTMLElement) => void) => {
    const el = find(id);
    if (el) mountSafely(el, what, () => mount(el));
  };
  panel('controls', 'selection panel', (el) => mountControls(el, ctx));
  panel('summary', 'summary', (el) => mountSummary(el, ctx));
  panel('map', 'map', (el) => {
    if (!webglAvailable()) throw new Error('this browser has WebGL turned off or unsupported, which the map needs. Everything else works.');
    mountMap(el, need('map-note'), need('map-tools'), ctx);
  });
  panel('compare', 'comparison', (el) => mountCompare(el, ctx));
  panel('calendar', 'calendar', (el) => mountCalendar(el, ctx));
  panel('charts', 'charts', (el) => mountCharts(el, ctx));
  panel('downloads', 'downloads', (el) => mountDownloads(el, ctx));

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
