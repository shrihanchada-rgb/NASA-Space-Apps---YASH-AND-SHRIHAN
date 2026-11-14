// Map: region outlines, click a region to select it, or draw a rectangle.
// Step S27 adds a basemap (provider not chosen yet, see docs/sources.md) and hotspot points.

import { Map as MapLibreMap, NavigationControl, setWorkerUrl, type GeoJSONSource, type LngLat } from 'maplibre-gl';
// MapLibre runs part of its work in a web worker. Vite needs the worker's address given explicitly.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { AppContext } from '../context';
import type { BBox } from '../data/types';
import { h } from '../dom';

setWorkerUrl(workerUrl);

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

export function mountMap(el: HTMLElement, note: HTMLElement, toolbar: HTMLElement, ctx: AppContext): void {
  note.textContent = 'Click a region to select it, or use "Draw an area". No basemap yet; hotspot points come in a later step.';

  const drawBtn = h('button', { type: 'button', class: 'chip', id: 'draw-toggle' });
  drawBtn.addEventListener('click', () => ctx.state.set({ drawing: !ctx.state.get().drawing }));
  const drawHelp = h('span', { class: 'note', id: 'draw-help' });
  toolbar.replaceChildren(drawBtn, drawHelp);

  const map = new MapLibreMap({
    container: el,
    style: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': cssVar('--map-bg') } }] },
    center: [0, 20],
    zoom: 1,
    attributionControl: false,
  });
  map.addControl(new NavigationControl({ showCompass: false }), 'top-right');

  function syncDrawUi(): void {
    const { drawing } = ctx.state.get();
    drawBtn.textContent = drawing ? 'Cancel drawing' : 'Draw an area';
    drawBtn.setAttribute('aria-pressed', String(drawing));
    drawHelp.textContent = drawing ? 'Drag on the map to draw a rectangle.' : '';
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
    if (bbox) map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 32, animate, maxZoom: 9 });
  }

  // --- drawing a rectangle ---
  let anchor: LngLat | null = null;
  function begin(lngLat: LngLat): void {
    if (ctx.state.get().drawing) anchor = lngLat;
  }
  function move(lngLat: LngLat): void {
    if (anchor) (map.getSource('drawn') as GeoJSONSource).setData(boxFeature(toBox(anchor, lngLat)));
  }
  function finish(lngLat: LngLat): void {
    if (!anchor) return;
    const box = toBox(anchor, lngLat);
    anchor = null;
    if (box[2] - box[0] < 0.01 || box[3] - box[1] < 0.01) {
      (map.getSource('drawn') as GeoJSONSource).setData(boxFeature(ctx.state.get().drawnBox));
      return; // a click, not a drag
    }
    ctx.state.set({ drawnBox: box, drawing: false });
  }

  map.on('load', () => {
    map.addSource('regions', { type: 'geojson', data: ctx.regions as unknown as GeoJSON.FeatureCollection });
    map.addSource('drawn', { type: 'geojson', data: boxFeature(null) });
    map.addLayer({ id: 'region-fill', type: 'fill', source: 'regions', paint: { 'fill-color': cssVar('--map-land') } });
    map.addLayer({ id: 'region-line', type: 'line', source: 'regions', paint: { 'line-color': cssVar('--muted'), 'line-width': 1 } });
    map.addLayer({
      id: 'region-selected', type: 'line', source: 'regions',
      paint: { 'line-color': cssVar('--accent'), 'line-width': 2.5 }, filter: ['==', ['get', 'region_id'], ''],
    });
    map.addLayer({ id: 'drawn-fill', type: 'fill', source: 'drawn', paint: { 'fill-color': cssVar('--accent'), 'fill-opacity': 0.12 } });
    map.addLayer({ id: 'drawn-line', type: 'line', source: 'drawn', paint: { 'line-color': cssVar('--accent'), 'line-width': 2, 'line-dasharray': [2, 1] } });

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

    syncDrawUi();
    showSelection(false);
    ctx.state.subscribe((s, prev) => {
      if (s.drawing !== prev.drawing) syncDrawUi();
      if (s.regionId !== prev.regionId || s.drawnBox !== prev.drawnBox) showSelection(true);
    });
    el.dataset.ready = 'true'; // lets tests wait for the map
  });

  syncDrawUi();
}
