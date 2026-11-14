// Map: NASA GIBS satellite imagery, region outlines, click a region to select it, or draw a rectangle.
// Imagery is from NASA's Global Imagery Browse Services (GIBS): free, no key needed.
// Step S27 adds hotspot points.

import {
  Map as MapLibreMap, NavigationControl, AttributionControl, setWorkerUrl,
  type GeoJSONSource, type LngLat, type RasterTileSource, type StyleSpecification,
} from 'maplibre-gl';
// MapLibre runs part of its work in a web worker. Vite needs the worker's address given explicitly.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { AppContext } from '../context';
import type { BBox } from '../data/types';
import { h } from '../dom';
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
  toolbar.replaceChildren(seg, labelsToggle, drawBtn);

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
    const parts = ['Click a region to select it, or draw an area.'];
    if (basemap === 'satellite') parts.push('Background: NASA Blue Marble composite (cloud-free, not a specific date).');
    if (basemap === 'daily') parts.push(`Background: MODIS Terra true colour for ${imageryDate(ctx)} (one day; clouds and gaps between satellite passes are normal).`);
    parts.push('Hotspot points come in a later step.');
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
    ctx.state.set({ drawnBox: box, drawing: false });
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
    map.addLayer({ id: 'labels', type: 'raster', source: 'labels' });

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
      if (s.endDate !== prev.endDate) {
        (map.getSource('daily') as RasterTileSource).setTiles([daily(imageryDate(ctx))]);
        updateNote();
      }
    });
    el.dataset.ready = 'true'; // lets tests wait for the map
  });

  applyBasemap();
  syncDrawUi();
}
