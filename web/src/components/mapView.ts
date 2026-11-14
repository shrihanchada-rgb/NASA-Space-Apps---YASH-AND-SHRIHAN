// Map of the selected region. For now: a plain background and the region outlines.
// Step S27 adds: a basemap (provider not chosen yet, see docs/sources.md) and hotspot points.

import { Map as MapLibreMap, NavigationControl, setWorkerUrl } from 'maplibre-gl';
// MapLibre runs part of its work in a web worker. Vite needs the worker's address given explicitly.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { AppContext } from '../context';

setWorkerUrl(workerUrl);

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function mountMap(el: HTMLElement, note: HTMLElement, ctx: AppContext): void {
  note.textContent = 'Region outlines only. Basemap and hotspot points come in a later step.';

  const map = new MapLibreMap({
    container: el,
    style: {
      version: 8,
      sources: {},
      layers: [{ id: 'background', type: 'background', paint: { 'background-color': cssVar('--map-bg') } }],
    },
    center: [0, 20],
    zoom: 1,
    attributionControl: false,
  });
  map.addControl(new NavigationControl({ showCompass: false }), 'top-right');

  function showSelected(animate: boolean): void {
    const id = ctx.state.get().regionId;
    map.setFilter('region-selected', ['==', ['get', 'region_id'], id ?? '']);
    const bbox = ctx.regions.features.find((f) => f.properties.region_id === id)?.properties.bbox;
    if (bbox) map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 32, animate });
  }

  map.on('load', () => {
    map.addSource('regions', { type: 'geojson', data: ctx.regions as unknown as GeoJSON.FeatureCollection });
    map.addLayer({ id: 'region-fill', type: 'fill', source: 'regions', paint: { 'fill-color': cssVar('--map-land') } });
    map.addLayer({ id: 'region-line', type: 'line', source: 'regions', paint: { 'line-color': cssVar('--muted'), 'line-width': 1 } });
    map.addLayer({
      id: 'region-selected',
      type: 'line',
      source: 'regions',
      paint: { 'line-color': cssVar('--accent'), 'line-width': 2.5 },
      filter: ['==', ['get', 'region_id'], ''],
    });
    showSelected(false);
    ctx.state.subscribe((s, prev) => {
      if (s.regionId !== prev.regionId) showSelected(true);
    });
    el.dataset.ready = 'true'; // lets tests wait for the map
  });
}
