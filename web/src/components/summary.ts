// Totals for the selected region and date range. Step S20 adds: peak month, peak year, % high confidence.

import type { AppContext } from '../context';
import { summarizeRange } from '../data/derive';
import { formatCount, h } from '../dom';

export function mountSummary(el: HTMLElement, ctx: AppContext): void {
  function render(): void {
    const { regionId, startDate, endDate } = ctx.state.get();
    const { regionData, loading } = ctx.loaded.get();
    const region = ctx.regions.features.find((f) => f.properties.region_id === regionId)?.properties;
    const title = h('h2', {}, 'Summary');

    if (loading) return el.replaceChildren(title, h('p', { class: 'note' }, 'Loading…'));
    if (!region || !regionData || !startDate || !endDate) {
      return el.replaceChildren(title, h('p', { class: 'note' }, 'Choose a region to see its fire activity.'));
    }

    const s = summarizeRange(regionData.daily, startDate, endDate);
    if (!s) {
      return el.replaceChildren(title, h('p', { class: 'note' }, 'No data for these dates. Pick dates inside the covered period.'));
    }

    const row = (label: string, value: string) => h('div', { class: 'stat' }, h('dt', {}, label), h('dd', {}, value));
    el.replaceChildren(
      title,
      h('p', { class: 'summary-region' }, `${region.name} · ${formatCount(region.area_km2)} km²`),
      h('p', { class: 'note' }, `${s.start} to ${s.end}`),
      h(
        'dl',
        { class: 'stats' },
        row('Hotspots (harmonized)', formatCount(s.countHarm)),
        row('Raw MODIS detections', formatCount(s.rawModis)),
        row('Raw VIIRS detections', formatCount(s.rawViirs)),
        row('Fire radiative power (MW)', formatCount(s.frpSum)),
        row('Days with no data', formatCount(s.daysMissing)),
      ),
    );
  }

  ctx.state.subscribe(render);
  ctx.loaded.subscribe(render);
  render();
}
