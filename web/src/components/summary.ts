// Figures for the current selection: the whole region (from daily/monthly files),
// or a drawn area (from hotspot points).

import type { AppContext } from '../context';
import { boxAreaKm2, boxesOverlap, MONTH_NAMES, monthPeaks, summarizePoints, summarizeRange } from '../data/derive';
import { loadHotspots } from '../data/loader';
import type { BBox, Hotspot } from '../data/types';
import { formatCount, h } from '../dom';

const pct = (v: number | null) => (v == null ? 'No data' : `${Math.round(v * 100)}%`);
const row = (label: string, value: string, hint?: string) =>
  h('div', { class: 'stat' }, h('dt', {}, label, hint ? h('span', { class: 'hint' }, hint) : null), h('dd', {}, value));

export function mountSummary(el: HTMLElement, ctx: AppContext): void {
  let token = 0; // ignore answers from older selections

  function regionView(): HTMLElement[] | null {
    const { regionId, startDate, endDate } = ctx.state.get();
    const { regionData } = ctx.loaded.get();
    const region = ctx.regions.features.find((f) => f.properties.region_id === regionId)?.properties;
    if (!region || !regionData || !startDate || !endDate) return null;
    const s = summarizeRange(regionData.daily, startDate, endDate);
    if (!s) return [h('p', { class: 'note' }, 'No data for these dates. Pick dates inside the covered period.')];
    const peaks = monthPeaks(regionData.monthly, s.start, s.end);
    const monthNote = peaks.wholeMonths ? undefined : 'whole months that overlap the dates';
    return [
      h('p', { class: 'summary-region' }, `${region.name} · ${formatCount(region.area_km2)} km²`),
      h('p', { class: 'note' }, `${s.start} to ${s.end}`),
      h('dl', { class: 'stats' },
        row('Hotspots (harmonized)', formatCount(s.countHarm)),
        row('Peak month', peaks.peakMonth ? `${MONTH_NAMES[peaks.peakMonth.month - 1]} ${peaks.peakMonth.year} (${formatCount(peaks.peakMonth.count)})` : 'None', monthNote),
        row('Peak year', peaks.peakYear ? `${peaks.peakYear.year} (${formatCount(peaks.peakYear.count)})` : 'None', peaks.peakYear && peaks.peakYear.monthsWithData < 12 ? `${peaks.peakYear.monthsWithData} months with data` : monthNote),
        row('Fire radiative power (MW)', formatCount(s.frpSum)),
        row('High-confidence detections', pct(peaks.shareHighConfidence), monthNote),
        row('Days with no data', formatCount(s.daysMissing)),
      ),
      rawDetails(s.rawModis, s.rawViirs),
    ];
  }

  function rawDetails(modis: number | null, viirs: number | null): HTMLElement {
    return h('details', { class: 'raw' },
      h('summary', {}, 'Raw detections by sensor'),
      h('dl', { class: 'stats' }, row('MODIS (Terra + Aqua)', formatCount(modis)), row('VIIRS (all satellites)', formatCount(viirs))),
      h('p', { class: 'note' }, 'Raw counts are not comparable between sensors: VIIRS sees more, smaller fires. The harmonized count above is.'),
    );
  }

  async function boxView(box: BBox, mine: number): Promise<HTMLElement[]> {
    const { startDate, endDate } = ctx.state.get();
    if (!startDate || !endDate) return [];
    const startYear = Number(startDate.slice(0, 4));
    const endYear = Number(endDate.slice(0, 4));
    const touching = ctx.regions.features.filter((f) => boxesOverlap(f.properties.bbox, box));
    const files: Promise<Hotspot[]>[] = [];
    for (const f of touching) for (let y = startYear; y <= endYear; y++) files.push(loadHotspots(f.properties.region_id, y));
    const points = (await Promise.all(files)).flat();
    if (mine !== token) return [];
    const s = summarizePoints(points, box, startDate, endDate);
    const clear = h('button', { type: 'button', class: 'chip', textContent: 'Clear drawn area' });
    clear.addEventListener('click', () => ctx.state.set({ drawnBox: null }));
    const coverage = touching.length
      ? `Uses hotspot points from: ${touching.map((f) => f.properties.name).join(', ')}.`
      : 'This area is outside every region with data.';
    return [
      h('p', { class: 'summary-region' }, `Drawn area · ${formatCount(boxAreaKm2(box))} km²`),
      h('p', { class: 'note' }, `${startDate} to ${endDate}`),
      h('dl', { class: 'stats' },
        row('Hotspots (harmonized)', touching.length ? formatCount(s.countHarm) : 'No data', 'sum of point weights'),
        row('Fire radiative power (MW)', touching.length ? formatCount(s.frpSum) : 'No data'),
        row('High-confidence detections', s.total ? pct(s.highConfidence / s.total) : touching.length ? '0 detections' : 'No data'),
      ),
      rawDetails(touching.length ? s.rawModis : null, touching.length ? s.rawViirs : null),
      h('p', { class: 'note' }, `${coverage} Days with no data cannot be shown for drawn areas; missing days count as no detections here.`),
      clear,
    ];
  }

  async function render(): Promise<void> {
    const mine = ++token;
    const title = h('h2', {}, 'Summary');
    const { drawnBox } = ctx.state.get();
    if (ctx.loaded.get().loading) return el.replaceChildren(title, h('p', { class: 'note' }, 'Loading…'));
    if (drawnBox) {
      el.replaceChildren(title, h('p', { class: 'note' }, 'Counting hotspots in the drawn area…'));
      try {
        const parts = await boxView(drawnBox, mine);
        if (mine === token) el.replaceChildren(title, ...parts);
      } catch (err) {
        if (mine === token) el.replaceChildren(title, h('p', { class: 'field-error' }, err instanceof Error ? err.message : 'Could not load hotspots.'));
      }
      return;
    }
    el.replaceChildren(title, ...(regionView() ?? [h('p', { class: 'note' }, 'Choose a region to see its fire activity.')]));
  }

  ctx.state.subscribe((s, prev) => {
    if (s.drawing !== prev.drawing && s.drawnBox === prev.drawnBox && s.regionId === prev.regionId) return;
    void render();
  });
  ctx.loaded.subscribe(() => void render());
  void render();
}
