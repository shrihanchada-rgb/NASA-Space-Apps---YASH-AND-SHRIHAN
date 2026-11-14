// Headline figures for the current selection: the whole region (from daily/monthly files),
// or a drawn area (from hotspot points).

import type { AppContext } from '../context';
import { boxAreaKm2, boxesOverlap, MONTH_NAMES, monthPeaks, summarizePoints, summarizeRange } from '../data/derive';
import { loadHotspots } from '../data/loader';
import type { BBox, Hotspot } from '../data/types';
import { formatCount, h } from '../dom';
import { icon } from '../icons';

const pct = (v: number | null) => (v == null ? 'No data' : `${Math.round(v * 100)}%`);

function kpi(label: string, value: string, opts: { hint?: string; unit?: string; primary?: boolean } = {}): HTMLElement {
  return h('div', { class: `kpi${opts.primary ? ' is-primary' : ''}` },
    h('p', { class: 'kpi-label' }, label),
    h('p', { class: 'kpi-value' }, value, opts.unit && value !== 'No data' ? h('span', { class: 'unit' }, opts.unit) : null),
    opts.hint ? h('p', { class: 'kpi-hint' }, opts.hint) : null,
  );
}

const inline = (label: string, value: string) => h('p', { class: 'inline-stat' }, `${label} `, h('strong', {}, value));

function rawDetails(modis: number | null, viirs: number | null): HTMLElement {
  return h('details', { class: 'raw' },
    h('summary', {}, 'Raw detections by sensor'),
    h('div', { class: 'raw-body' },
      inline('MODIS (Terra + Aqua):', formatCount(modis)),
      inline('VIIRS (all satellites):', formatCount(viirs)),
      h('p', { class: 'note' }, 'Raw counts are not comparable between sensors: VIIRS sees more, smaller fires. The harmonized count is.'),
    ),
  );
}

function head(title: string, meta: string, extra?: HTMLElement): HTMLElement {
  return h('div', { class: 'summary-head' }, h('h1', { class: 'summary-title' }, title), h('p', { class: 'summary-meta' }, meta), extra ?? null);
}

export function mountSummary(el: HTMLElement, ctx: AppContext): void {
  let token = 0; // ignore answers from older selections

  function regionView(): HTMLElement[] | null {
    const { regionId, startDate, endDate } = ctx.state.get();
    const { regionData } = ctx.loaded.get();
    const region = ctx.regions.features.find((f) => f.properties.region_id === regionId)?.properties;
    if (!region || !regionData || !startDate || !endDate) return null;
    const s = summarizeRange(regionData.daily, startDate, endDate);
    if (!s) return [head(region.name, `${startDate} – ${endDate}`), h('p', { class: 'note' }, 'No data for these dates. Pick dates inside the covered period.')];
    const p = monthPeaks(regionData.monthly, s.start, s.end);
    const monthHint = p.wholeMonths ? undefined : 'Whole months overlapping the dates';
    return [
      head(region.name, `${s.start} – ${s.end} · ${formatCount(region.area_km2)} km²`),
      h('div', { class: 'kpis' },
        kpi('Hotspots (harmonized)', formatCount(s.countHarm), { primary: true, hint: 'MODIS-equivalent count' }),
        kpi('Peak month', p.peakMonth ? `${MONTH_NAMES[p.peakMonth.month - 1]} ${p.peakMonth.year}` : 'None',
          { hint: p.peakMonth ? `${formatCount(p.peakMonth.count)} hotspots` : monthHint }),
        kpi('Peak year', p.peakYear ? String(p.peakYear.year) : 'None',
          { hint: p.peakYear ? `${formatCount(p.peakYear.count)} hotspots${p.peakYear.monthsWithData < 12 ? ` · ${p.peakYear.monthsWithData} months` : ''}` : monthHint }),
        kpi('High confidence', pct(p.shareHighConfidence), { hint: monthHint ?? 'Share of detections' }),
      ),
      h('div', { class: 'summary-extra' },
        inline('Fire radiative power:', `${formatCount(s.frpSum)} MW`),
        inline('Days with no data:', formatCount(s.daysMissing)),
        rawDetails(s.rawModis, s.rawViirs),
      ),
    ];
  }

  async function boxView(box: BBox, mine: number): Promise<HTMLElement[]> {
    const { startDate, endDate } = ctx.state.get();
    if (!startDate || !endDate) return [];
    const touching = ctx.regions.features.filter((f) => boxesOverlap(f.properties.bbox, box));
    const files: Promise<Hotspot[]>[] = [];
    for (const f of touching) {
      for (let y = Number(startDate.slice(0, 4)); y <= Number(endDate.slice(0, 4)); y++) files.push(loadHotspots(f.properties.region_id, y));
    }
    const points = (await Promise.all(files)).flat();
    if (mine !== token) return [];
    const s = summarizePoints(points, box, startDate, endDate);
    const has = touching.length > 0;
    const clear = h('button', { type: 'button', class: 'chip' }, icon('close'), 'Clear drawn area');
    clear.addEventListener('click', () => ctx.state.set({ drawnBox: null }));
    return [
      head('Drawn area', `${startDate} – ${endDate} · ${formatCount(boxAreaKm2(box))} km²`, clear),
      h('div', { class: 'kpis' },
        kpi('Hotspots (harmonized)', has ? formatCount(s.countHarm) : 'No data', { primary: true, hint: 'Sum of point weights' }),
        kpi('Detections', has ? formatCount(s.total) : 'No data', { hint: 'All sensors, raw' }),
        kpi('Fire radiative power', has ? formatCount(s.frpSum) : 'No data', { unit: 'MW' }),
        kpi('High confidence', s.total ? pct(s.highConfidence / s.total) : has ? '—' : 'No data', { hint: 'Share of detections' }),
      ),
      h('div', { class: 'summary-extra' },
        rawDetails(has ? s.rawModis : null, has ? s.rawViirs : null),
        h('p', { class: 'note' }, has
          ? `From hotspot points in ${touching.map((f) => f.properties.name).join(', ')}. Missing days cannot be detected for drawn areas.`
          : 'This area is outside every region with data.'),
      ),
    ];
  }

  async function render(): Promise<void> {
    const mine = ++token;
    const { drawnBox } = ctx.state.get();
    if (ctx.loaded.get().loading) return el.replaceChildren(h('p', { class: 'note' }, 'Loading…'));
    if (drawnBox) {
      el.replaceChildren(h('p', { class: 'note' }, 'Counting hotspots in the drawn area…'));
      try {
        const parts = await boxView(drawnBox, mine);
        if (mine === token) el.replaceChildren(...parts);
      } catch (err) {
        if (mine === token) el.replaceChildren(h('p', { class: 'field-error' }, err instanceof Error ? err.message : 'Could not load hotspots.'));
      }
      return;
    }
    el.replaceChildren(...(regionView() ?? [h('p', { class: 'note' }, 'Choose a region to see its fire activity.')]));
  }

  ctx.state.subscribe((s, prev) => {
    if (s.drawing !== prev.drawing && s.drawnBox === prev.drawnBox && s.regionId === prev.regionId) return;
    void render();
  });
  ctx.loaded.subscribe(() => void render());
  void render();
}
