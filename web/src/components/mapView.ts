// Map: NASA GIBS satellite imagery, region outlines, click a region to select it, or draw a rectangle.
// Imagery is from NASA's Global Imagery Browse Services (GIBS): free, no key needed.
// S27: hotspots for the chosen dates, as points (coloured by sensor or FRP) for short ranges,
// or as a density grid (harmonized count per 0.25-degree cell) for long ones.

import {
  Map as MapLibreMap, NavigationControl, AttributionControl, setWorkerUrl,
  Popup, type ExpressionSpecification, type GeoJSONSource, type LngLat, type RasterTileSource, type StyleSpecification,
} from 'maplibre-gl';
// MapLibre runs part of its work in a web worker. Vite needs the worker's address given explicitly.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { AppContext } from '../context';
import type { BBox } from '../data/types';
import { daysBetween } from '../data/derive';
import { estimateRows } from '../data/export';
import { loadGrid, loadHotspots } from '../data/loader';
import { monthsInRange, regionSeries, snapBox } from '../data/selection';
import { formatCount, h } from '../dom';
import { icon } from '../icons';

setWorkerUrl(workerUrl);

const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
const BLUE_MARBLE = `${GIBS}/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg`;
const daily = (date: string) =>
  `${GIBS}/MODIS_Terra_CorrectedReflectance_TrueColor/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`;
const LABELS = `${GIBS}/Reference_Labels_15m/default/GoogleMapsCompatible_Level13/{z}/{y}/{x}.png`;
const COASTLINES = `${GIBS}/Coastlines_15m/default/GoogleMapsCompatible_Level13/{z}/{y}/{x}.png`;
const DAILY_FIRST = '2000-02-24'; // first MODIS Terra true-colour day in GIBS (checked 2026-11-14)
const ATTRIBUTION = 'Imagery: <a href="https://www.earthdata.nasa.gov/gibs" target="_blank" rel="noopener">NASA GIBS</a>';

type Basemap = 'satellite' | 'daily' | 'plain';
const BASEMAP_LABEL: Record<Basemap, string> = { satellite: 'Satellite', daily: 'Imagery on date', plain: 'Plain' };

type HotLayer = 'points' | 'density' | 'off';
const HOT_LABEL: Record<HotLayer, string> = { points: 'Points', density: 'Density', off: 'Off' };
type ColorBy = 'sensor' | 'frp';
/** Points are drawn only for short ranges with few detections; otherwise the density grid. */
export const POINT_MAX_DAYS = 93;
export const POINT_CAP = 300_000;
/** Phones and small-memory devices get a lower cap, so the page does not run out of memory. */
const SMALL_DEVICE = window.matchMedia('(pointer: coarse)').matches
  || ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 4;
const pointCap = SMALL_DEVICE ? 100_000 : POINT_CAP;

// Okabe-Ito colours: tell apart with colour-blindness, visible on satellite imagery.
const SENSOR_COLORS = { MODIS: '#56B4E9', VIIRS: '#E69F00' };
const FRP_STEPS: [number, string][] = [[0, '#fee391'], [10, '#fec44f'], [50, '#fe9929'], [100, '#ec7014'], [500, '#b33a02']];
const DENSITY_STEPS = [0, 2, 10, 50, 200, 1000]; // harmonized hotspots per cell: lower bounds of 6 classes, colours --seq-1 to --seq-6

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function boxFeature(box: BBox | null): GeoJSON.FeatureCollection {
  if (!box) return { type: 'FeatureCollection', features: [] };
  const [w, s, e, n] = box;
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } }],
  };
}

function toBox(a: LngLat, b: LngLat): BBox {
  return [Math.min(a.lng, b.lng), Math.min(a.lat, b.lat), Math.max(a.lng, b.lng), Math.max(a.lat, b.lat)];
}

function imageryDate(ctx: AppContext): string {
  const end = ctx.state.get().endDate ?? ctx.metadata.time_coverage.end;
  return end < DAILY_FIRST ? DAILY_FIRST : end;
}

export function mountMap(el: HTMLElement, note: HTMLElement, toolbar: HTMLElement, ctx: AppContext): void {
  let basemap: Basemap = 'satellite';

  // --- toolbar: basemap switcher, labels toggle, draw button ---
  const seg = h('div', { class: 'segmented', role: 'group' });
  seg.setAttribute('aria-label', 'Map background');
  const segButtons = (Object.keys(BASEMAP_LABEL) as Basemap[]).map((b) => {
    const btn = h('button', { type: 'button', textContent: BASEMAP_LABEL[b] });
    btn.dataset.basemap = b;
    btn.addEventListener('click', () => setBasemap(b));
    return btn;
  });
  seg.append(...segButtons);

  // Place names are off by default: NASA's label tiles sometimes fail (HTTP 500) on their side.
  const labels = h('input', { type: 'checkbox', checked: false, id: 'map-labels' });
  const labelsToggle = h('label', { class: 'toggle', htmlFor: 'map-labels' }, labels, 'Place names');
  labels.addEventListener('change', () => applyBasemap());

  const drawBtn = h('button', { type: 'button', class: 'chip', id: 'draw-toggle' });
  drawBtn.addEventListener('click', () => ctx.state.set({ drawing: !ctx.state.get().drawing }));
  const hotSeg = h('div', { class: 'segmented', role: 'group' });
  hotSeg.setAttribute('aria-label', 'Hotspots on the map');
  let hotLayer: HotLayer = 'points';
  let colorBy: ColorBy = 'sensor';
  const hotButtons = (Object.keys(HOT_LABEL) as HotLayer[]).map((m) => {
    const btn = h('button', { type: 'button', textContent: HOT_LABEL[m] });
    btn.dataset.layer = m;
    btn.addEventListener('click', () => { hotLayer = m; void refreshHotspots(); });
    return btn;
  });
  hotSeg.append(...hotButtons);
  const colorSeg = h('div', { class: 'segmented', role: 'group' });
  colorSeg.setAttribute('aria-label', 'Colour points by');
  const colorButtons = (['sensor', 'frp'] as ColorBy[]).map((m) => {
    const btn = h('button', { type: 'button', textContent: m === 'sensor' ? 'By sensor' : 'By FRP' });
    btn.dataset.color = m;
    btn.addEventListener('click', () => { colorBy = m; applyPointColors(); });
    return btn;
  });
  colorSeg.append(...colorButtons);
  const hotLabel = h('span', { class: 'map-tools-label' }, 'Hotspots');
  toolbar.replaceChildren(seg, labelsToggle, drawBtn, h('div', { class: 'map-tools-row' }, hotLabel, hotSeg, colorSeg));
  const legend = h('div', { class: 'map-legend', 'aria-live': 'polite' } as Partial<HTMLDivElement>);
  note.before(legend);
  let shown: 'points' | 'density' | 'off' = 'off';
  let shownText = '';

  const style: StyleSpecification = {
    version: 8,
    sources: {
      bluemarble: { type: 'raster', tiles: [BLUE_MARBLE], tileSize: 256, maxzoom: 8, attribution: `${ATTRIBUTION} · Blue Marble` },
      daily: { type: 'raster', tiles: [daily(imageryDate(ctx))], tileSize: 256, maxzoom: 9, attribution: `${ATTRIBUTION} · MODIS Terra true colour` },
      labels: { type: 'raster', tiles: [LABELS], tileSize: 256, maxzoom: 13 },
      coastlines: { type: 'raster', tiles: [COASTLINES], tileSize: 256, maxzoom: 13 },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': cssVar('--map-bg') } },
      { id: 'bluemarble', type: 'raster', source: 'bluemarble' },
      { id: 'daily', type: 'raster', source: 'daily', layout: { visibility: 'none' } },
    ],
  };

  const map = new MapLibreMap({
    container: el,
    style,
    center: [0, 20],
    zoom: 1,
    maxZoom: 11,
    attributionControl: false,
  });
  map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new AttributionControl({ compact: true }), 'bottom-right');
  // A missing overlay tile (labels, coastlines) only leaves a small gap; don't flood the console with it.
  map.on('error', (e) => {
    const src = (e as { sourceId?: string }).sourceId;
    if (src === 'labels' || src === 'coastlines') return;
    console.error(e.error ?? e);
  });

  function setBasemap(b: Basemap): void {
    basemap = b;
    applyBasemap();
  }

  function applyBasemap(): void {
    segButtons.forEach((btn) => btn.setAttribute('aria-pressed', String(btn.dataset.basemap === basemap)));
    labelsToggle.hidden = basemap === 'plain';
    if (!map.getLayer('region-fill')) return;
    const vis = (on: boolean) => (on ? 'visible' : 'none');
    map.setLayoutProperty('bluemarble', 'visibility', vis(basemap === 'satellite'));
    map.setLayoutProperty('daily', 'visibility', vis(basemap === 'daily'));
    map.setLayoutProperty('labels', 'visibility', vis(basemap !== 'plain' && labels.checked));
    map.setLayoutProperty('coastlines', 'visibility', vis(basemap === 'daily'));
    map.setPaintProperty('region-fill', 'fill-opacity', basemap === 'plain' ? 1 : 0);
    map.setPaintProperty('region-line', 'line-color', basemap === 'plain' ? cssVar('--subtle') : '#ffffff');
    updateNote();
  }

  function updateNote(): void {
    const parts = ['Draw an area to see its own calendar, charts and downloads (it snaps to the 0.25° data grid, about 25 km).'];
    if (basemap === 'satellite') parts.push('Background: NASA Blue Marble composite (cloud-free, not a specific date).');
    if (basemap === 'daily') parts.push(`Background: MODIS Terra true colour for ${imageryDate(ctx)} (one day; clouds and gaps between satellite passes are normal).`);
    if (shownText) parts.push(shownText);
    note.textContent = parts.join(' ');
  }

  function syncDrawUi(): void {
    const { drawing } = ctx.state.get();
    drawBtn.replaceChildren(icon(drawing ? 'close' : 'draw'), drawing ? 'Cancel drawing' : 'Draw an area');
    drawBtn.setAttribute('aria-pressed', String(drawing));
    drawBtn.title = drawing ? 'Drag on the map to draw a rectangle' : '';
    el.classList.toggle('drawing', drawing);
    if (drawing) map.dragPan.disable();
    else map.dragPan.enable();
  }

  function showSelection(animate: boolean): void {
    const { regionId, drawnBox } = ctx.state.get();
    if (!map.getLayer('region-selected')) return;
    map.setFilter('region-selected', ['==', ['get', 'region_id'], drawnBox ? '' : regionId ?? '']);
    (map.getSource('drawn') as GeoJSONSource).setData(boxFeature(drawnBox));
    const bbox = drawnBox ?? ctx.regions.features.find((f) => f.properties.region_id === regionId)?.properties.bbox;
    if (bbox) map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 40, animate: animate && !reduceMotion, maxZoom: 9 });
  }

  // --- hotspots ---
  function applyPointColors(): void {
    colorButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.color === colorBy)));
    colorSeg.hidden = shown !== 'points';
    if (map.getLayer('hot-points')) {
      map.setPaintProperty('hot-points', 'circle-color', colorBy === 'sensor'
        ? ['match', ['get', 'sensor'], 'MODIS', SENSOR_COLORS.MODIS, SENSOR_COLORS.VIIRS]
        : ['step', ['get', 'frp'], FRP_STEPS[0]![1], ...FRP_STEPS.slice(1).flat()] as ExpressionSpecification);
    }
    renderLegend();
  }

  function swatch(color: string, round = false): HTMLElement {
    const s = h('span', { class: `swatch${round ? ' is-round' : ''}` });
    s.style.background = color;
    return s;
  }

  function renderLegend(): void {
    if (shown === 'points') {
      const items = colorBy === 'sensor'
        ? [h('li', {}, swatch(SENSOR_COLORS.MODIS, true), 'MODIS (1 km)'), h('li', {}, swatch(SENSOR_COLORS.VIIRS, true), 'VIIRS (375 m)')]
        : FRP_STEPS.map(([v, c], i) => h('li', {}, swatch(c, true), i + 1 < FRP_STEPS.length ? `${v}–${FRP_STEPS[i + 1]![0]} MW` : `≥ ${v} MW`));
      legend.replaceChildren(h('span', { class: 'note' }, colorBy === 'sensor' ? 'Detections by sensor' : 'Fire radiative power'), h('ul', {}, ...items));
    } else if (shown === 'density') {
      const items = DENSITY_STEPS.map((v, i) => {
        const next = DENSITY_STEPS[i + 1];
        return h('li', {}, swatch(cssVar(`--seq-${i + 1}`)), next == null ? `≥ ${v}` : i === 0 ? `< ${next}` : `${v}–${next}`);
      });
      legend.replaceChildren(h('span', { class: 'note' }, 'Harmonized hotspots per 0.25° cell'), h('ul', {}, ...items));
    } else legend.replaceChildren();
  }

  let hotToken = 0;
  const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
  async function refreshHotspots(): Promise<void> {
    const mine = ++hotToken;
    hotButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.layer === hotLayer)));
    const { regionId, startDate, endDate } = ctx.state.get();
    const rd = ctx.loaded.get().regionData;
    if (!map.getSource('hot-points') || !regionId || !rd || !startDate || !endDate) return;
    const pts = map.getSource('hot-points') as GeoJSONSource;
    const dens = map.getSource('hot-density') as GeoJSONSource;
    const months = monthsInRange(regionSeries(rd.monthly), startDate, endDate);
    const days = daysBetween(startDate, endDate) + 1;
    const est = estimateRows(months);
    let want: 'points' | 'density' | 'off' = hotLayer;
    let why = '';
    if (want === 'points' && (days > POINT_MAX_DAYS || est > pointCap)) {
      want = 'density';
      why = days > POINT_MAX_DAYS
        ? `Points are shown for ${POINT_MAX_DAYS} days or fewer; showing density instead.`
        : `About ${formatCount(est)} detections are too many to draw; showing density instead. Pick fewer days for points.`;
    }
    legend.replaceChildren(h('span', { class: 'note' }, want === 'off' ? '' : 'Loading hotspots…'));
    // Clear the layer that will not be shown at once, so an old layer never sits under the new one while it loads.
    if (want !== 'points') pts.setData(empty);
    if (want !== 'density') dens.setData(empty);
    try {
      if (want === 'points') {
        const rows = await loadHotspots(regionId, startDate, endDate);
        if (mine !== hotToken) return;
        pts.setData({ type: 'FeatureCollection', features: rows.map((r) => ({
          type: 'Feature', geometry: { type: 'Point', coordinates: [r.longitude, r.latitude] },
          properties: { sensor: r.sensor, satellite: r.satellite, frp: r.frp, date: r.date, time: r.time_utc, confidence: r.confidence, daynight: r.daynight, weight: r.harmonized_weight },
        })) });
        dens.setData(empty);
        why = `${formatCount(rows.length)} detections (all sensors, raw; the harmonized count weights them). Click a point for details.`;
      } else if (want === 'density') {
        const grid = await loadGrid(regionId);
        if (mine !== hotToken) return;
        const a = startDate.slice(0, 7), b = endDate.slice(0, 7);
        const sums = new Map<string, number>();
        for (const g of grid.months) {
          const k = `${g.year}-${String(g.month).padStart(2, '0')}`;
          if (k < a || k > b || g.count_harm <= 0) continue;
          const id = `${g.lat_idx}_${g.lon_idx}`;
          sums.set(id, (sums.get(id) ?? 0) + g.count_harm);
        }
        const d = 0.25;
        dens.setData({ type: 'FeatureCollection', features: [...sums].map(([id, count]) => {
          const [la = 0, lo = 0] = id.split('_').map(Number);
          const s0 = la * d - 90, w0 = lo * d - 180;
          return { type: 'Feature', properties: { count },
            geometry: { type: 'Polygon', coordinates: [[[w0, s0], [w0 + d, s0], [w0 + d, s0 + d], [w0, s0 + d], [w0, s0]]] } };
        }) });
        pts.setData(empty);
        why = `${why} Density: harmonized hotspots per 0.25° cell, whole months ${a} to ${b}.`.trim();
      } else {
        pts.setData(empty);
        dens.setData(empty);
        why = '';
      }
      shown = want;
      shownText = why;
    } catch (err) {
      if (mine !== hotToken) return;
      shown = 'off';
      shownText = err instanceof Error ? err.message : 'Could not load hotspots.';
    }
    applyPointColors();
    updateNote();
  }

  // --- drawing a rectangle ---
  let anchor: LngLat | null = null;
  const begin = (p: LngLat) => { if (ctx.state.get().drawing) anchor = p; };
  const move = (p: LngLat) => { if (anchor) (map.getSource('drawn') as GeoJSONSource).setData(boxFeature(toBox(anchor, p))); };
  function finish(p: LngLat): void {
    if (!anchor) return;
    const box = toBox(anchor, p);
    anchor = null;
    if (box[2] - box[0] < 0.01 || box[3] - box[1] < 0.01) {
      (map.getSource('drawn') as GeoJSONSource).setData(boxFeature(ctx.state.get().drawnBox));
      return; // a click, not a drag
    }
    ctx.state.set({ drawnBox: snapBox(box), drawing: false }); // whole 0.25-degree cells, like the data grid
  }

  map.on('load', () => {
    const accent = cssVar('--accent');
    map.addSource('regions', { type: 'geojson', data: ctx.regions as unknown as GeoJSON.FeatureCollection });
    map.addSource('drawn', { type: 'geojson', data: boxFeature(null) });
    map.addLayer({ id: 'coastlines', type: 'raster', source: 'coastlines', layout: { visibility: 'none' } });
    map.addLayer({ id: 'region-fill', type: 'fill', source: 'regions', paint: { 'fill-color': cssVar('--map-land'), 'fill-opacity': 0 } });
    map.addLayer({ id: 'region-line', type: 'line', source: 'regions', paint: { 'line-color': '#ffffff', 'line-width': 1, 'line-opacity': 0.8 } });
    map.addLayer({
      id: 'region-selected', type: 'line', source: 'regions',
      paint: { 'line-color': accent, 'line-width': 3 }, filter: ['==', ['get', 'region_id'], ''],
    });
    map.addLayer({ id: 'drawn-fill', type: 'fill', source: 'drawn', paint: { 'fill-color': accent, 'fill-opacity': 0.15 } });
    map.addLayer({ id: 'drawn-line', type: 'line', source: 'drawn', paint: { 'line-color': accent, 'line-width': 2, 'line-dasharray': [2, 1] } });
    map.addSource('hot-density', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addSource('hot-points', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    const densityColor = ['step', ['get', 'count'], cssVar('--seq-1'),
      ...DENSITY_STEPS.slice(1).flatMap((v, i) => [v, cssVar(`--seq-${i + 2}`)])] as ExpressionSpecification;
    map.addLayer({ id: 'hot-density', type: 'fill', source: 'hot-density', paint: { 'fill-color': densityColor, 'fill-opacity': 0.8 } }, 'drawn-fill');
    map.addLayer({
      id: 'hot-points', type: 'circle', source: 'hot-points',
      layout: { 'circle-sort-key': ['get', 'frp'] },
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 1.6, 7, 3, 10, 6],
        'circle-stroke-color': '#111111', 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 4, 0, 8, 0.6],
        'circle-color': SENSOR_COLORS.VIIRS,
      },
    }, 'drawn-fill');
    map.addLayer({ id: 'labels', type: 'raster', source: 'labels' });
    map.on('click', 'hot-points', (e) => {
      const p = e.features?.[0]?.properties as Record<string, string | number> | undefined;
      if (!p || ctx.state.get().drawing) return;
      const t = String(p.time);
      new Popup({ closeButton: true, maxWidth: '260px' })
        .setLngLat(e.lngLat)
        .setDOMContent(h('div', { class: 'popup' },
          h('strong', {}, `${p.sensor} · ${p.satellite}`),
          h('p', {}, `${p.date} ${t.slice(0, 2)}:${t.slice(2)} UTC (${p.daynight === 'D' ? 'day' : 'night'})`),
          h('p', {}, `FRP ${p.frp} MW · ${p.confidence} confidence`),
          h('p', { class: 'note' }, `Weight in the harmonized count: ${p.weight}`)))
        .addTo(map);
    });
    map.on('mouseenter', 'hot-points', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'hot-points', () => { map.getCanvas().style.cursor = ''; });

    map.on('click', 'region-fill', (e) => {
      if (ctx.state.get().drawing) return;
      const id = e.features?.[0]?.properties?.region_id as string | undefined;
      if (id) ctx.state.set({ regionId: id, drawnBox: null });
    });
    map.on('mouseenter', 'region-fill', () => { if (!ctx.state.get().drawing) map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'region-fill', () => { map.getCanvas().style.cursor = ''; });
    map.on('mousedown', (e) => begin(e.lngLat));
    map.on('mousemove', (e) => move(e.lngLat));
    map.on('mouseup', (e) => finish(e.lngLat));
    map.on('touchstart', (e) => begin(e.lngLat));
    map.on('touchmove', (e) => move(e.lngLat));
    map.on('touchend', (e) => finish(e.lngLat));

    applyBasemap();
    syncDrawUi();
    showSelection(false);
    ctx.state.subscribe((s, prev) => {
      if (s.drawing !== prev.drawing) syncDrawUi();
      if (s.regionId !== prev.regionId || s.drawnBox !== prev.drawnBox) showSelection(true);
      if (s.regionId !== prev.regionId || s.startDate !== prev.startDate || s.endDate !== prev.endDate) void refreshHotspots();
      if (s.endDate !== prev.endDate) {
        (map.getSource('daily') as RasterTileSource).setTiles([daily(imageryDate(ctx))]);
        updateNote();
      }
    });
    ctx.loaded.subscribe((l, p) => { if (l.regionData !== p.regionData) void refreshHotspots(); });
    void refreshHotspots();
    el.dataset.ready = 'true'; // lets tests wait for the map
  });

  applyBasemap();
  syncDrawUi();
}
