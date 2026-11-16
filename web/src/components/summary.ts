// Headline figures for the current selection: the whole region (from daily/monthly files),
// or a drawn area (from hotspot points).

import type { AppContext } from '../context';
import { boxAreaKm2, MONTH_NAMES, monthPeaks, summarizeRange } from '../data/derive';
import { filterHotspots } from '../data/selection';
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
    const { startDate, endDate, regionId } = ctx.state.get();
    const region = ctx.regions.features.find((f) => f.properties.region_id === regionId)?.properties;
    if (!startDate || !endDate || !regionId || !region) return [];
    const files: Promise<Hotspot[]>[] = [];
    for (let y = Number(startDate.slice(0, 4)); y <= Number(endDate.slice(0, 4)); y++) files.push(loadHotspots(regionId, y));
    const points = filterHotspots((await Promise.all(files)).flat(), { box }, startDate, endDate);
    if (mine !== token) return [];
    const sel = ctx.loaded.get().selection;
    const has = !!sel && sel.kind === 'area' && (sel.nCells ?? 0) > 0;
    const t = { harm: 0, modis: 0, viirs: 0, frp: 0, high: 0 };
    for (const p of points) {
      t.harm += p.harmonized_weight;
      t.frp += p.frp;
      if (p.sensor === 'MODIS') t.modis++;
      else t.viirs++;
      if (p.confidence === 'high') t.high++;
    }
    const total = points.length;
    const clear = h('button', { type: 'button', class: 'chip' }, icon('close'), 'Clear drawn area');
    clear.addEventListener('click', () => ctx.state.set({ drawnBox: null }));
    const s = has ? summarizeRange(ctx.loaded.get().regionData!.daily, startDate, endDate) : null;
    return [
      head(`Drawn area in ${region.name}`, `${startDate} – ${endDate} · ${formatCount(boxAreaKm2(box))} km² box · ${sel?.nCells ?? 0} cells`, clear),
      h('div', { class: 'kpis' },
        kpi('Hotspots (harmonized)', has ? formatCount(t.harm) : 'No data', { primary: true, hint: 'MODIS-equivalent count in the area' }),
        kpi('Detections', has ? formatCount(total) : 'No data', { hint: 'All sensors, raw' }),
        kpi('Fire radiative power', has ? formatCount(t.frp) : 'No data', { unit: 'MW' }),
        kpi('High confidence', total ? pct(t.high / total) : has ? '—' : 'No data', { hint: 'Share of detections' }),
      ),
      h('div', { class: 'summary-extra' },
        has && s ? inline('Days with no data:', formatCount(s.daysMissing)) : null,
        rawDetails(has ? t.modis : null, has ? t.viirs : null),
        h('p', { class: 'note' }, has
          ? `Box ${box.map((v) => v.toFixed(2)).join(', ')} (W, S, E, N), snapped to the 0.25° data grid. Only the part inside ${region.name} has data. The calendar, charts and downloads below show this area.`
          : `This area is outside ${region.name}, so it has no data.`),
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
