import './styles.css';
import { mountControls } from './components/controls';
import { mountMap } from './components/mapView';
import { mountPlaceholder } from './components/placeholder';
import { mountSummary } from './components/summary';
import type { AppContext, LoadState } from './context';
import { loadMetadata, loadRegionData, loadRegions } from './data/loader';
import { type AppState, createStore } from './state';

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
  const loaded = createStore<LoadState>({ regionData: null, loading: false });
  const ctx: AppContext = { metadata, regions, state, loaded };

  if (metadata.is_sample) {
    const banner = need('sample-banner');
    banner.textContent = 'SAMPLE DATA: these numbers are invented for development. They are not real fire data.';
    banner.hidden = false;
  }

  mountControls(need('controls'), ctx);
  mountSummary(need('summary'), ctx);
  mountMap(need('map'), need('map-note'), need('map-tools'), ctx);
  mountPlaceholder(need('calendar'), 'Burning activity calendar', 'S21', 'Years × months heatmap of hotspot counts.');
  mountPlaceholder(need('charts'), 'Charts', 'S22', 'Monthly series, yearly totals and seasonal cycle.');
  mountPlaceholder(need('downloads'), 'Downloads', 'S23', 'CSV of hotspots for the current selection.');

  need('footer').textContent =
    `${metadata.citation} · Data built ${metadata.build_date} · Method ${metadata.method_version}`;

  async function loadSelected(): Promise<void> {
    const id = state.get().regionId;
    if (!id) return;
    loaded.set({ regionData: null, loading: true });
    try {
      const regionData = await loadRegionData(id);
      if (state.get().regionId === id) loaded.set({ regionData, loading: false }); // ignore stale answers
      status.hidden = true;
    } catch (err) {
      if (state.get().regionId === id) loaded.set({ regionData: null, loading: false });
      showError(err instanceof Error ? err.message : 'Could not load the region data.');
    }
  }
  state.subscribe((s, prev) => {
    if (s.regionId !== prev.regionId) void loadSelected();
  });
  await loadSelected();
}

start().catch((err: unknown) => {
  showError(err instanceof Error ? err.message : 'The app could not start.');
});
