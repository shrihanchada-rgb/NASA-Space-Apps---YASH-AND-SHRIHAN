// Headline figures for the current selection: the whole region (from daily/monthly files),
// or a drawn area (from hotspot points).

import type { AppContext } from '../context';
import { boxAreaKm2, MONTH_NAMES, monthPeaks, summarizeRange } from '../data/derive';
import { monthsInRange, type SeriesMonth, yearTotals } from '../data/selection';
import type { BBox } from '../data/types';

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
          { hint: p.peakYear ? `${formatCount(p.peakYear.count)} hotspots${p.peakYear.monthsWithData < 12 ? ` · ${p.peakYear.monthsWithData} month${p.peakYear.monthsWithData === 1 ? "" : "s"}` : ''}` : monthHint }),
        kpi('High confidence', pct(p.shareHighConfidence), { hint: monthHint ?? 'Share of detections' }),
      ),
      h('div', { class: 'summary-extra' },
        inline('Fire radiative power:', `${formatCount(s.frpSum)} MW`),
        inline('Days with no data:', formatCount(s.daysMissing)),
        rawDetails(s.rawModis, s.rawViirs),
      ),
    ];
  }

  function boxView(box: BBox): HTMLElement[] {
    const { startDate, endDate, regionId } = ctx.state.get();
    const region = ctx.regions.features.find((f) => f.properties.region_id === regionId)?.properties;
    const sel = ctx.loaded.get().selection;
    if (!startDate || !endDate || !region) return [];
    const clear = h('button', { type: 'button', class: 'chip' }, icon('close'), 'Clear drawn area');
    clear.addEventListener('click', () => ctx.state.set({ drawnBox: null }));
    const err = ctx.loaded.get().selectionError;
    if (!sel || sel.kind !== 'area') return [head(`Drawn area in ${region.name}`, `${startDate} – ${endDate}`, clear), h('p', { class: err ? 'field-error' : 'note' }, err ?? 'Loading the area…')];
    const months = monthsInRange(sel.months, startDate, endDate);
    const known = months.filter((m) => m.countHarm != null);
    const sum = (f: (m: SeriesMonth) => number | null) => (known.length ? known.reduce((a, m) => a + (f(m) ?? 0), 0) : null);
    const harm = sum((m) => m.countHarm);
    const peak = known.reduce<SeriesMonth | null>((a, m) => (!a || (m.countHarm ?? 0) > (a.countHarm ?? 0) ? m : a), null);
    const years = yearTotals(months).filter((y) => y.total != null);
    const peakYear = years.reduce<(typeof years)[number] | null>((a, y) => (!a || (y.total ?? 0) > (a.total ?? 0) ? y : a), null);
    const s = summarizeRange(ctx.loaded.get().regionData!.daily, startDate, endDate);
    const p = monthPeaks(ctx.loaded.get().regionData!.monthly, startDate, endDate);
    const hint = p.wholeMonths ? undefined : 'Whole months overlapping the dates';
    return [
      head(`Drawn area in ${region.name}`, `${startDate} – ${endDate} · ${formatCount(boxAreaKm2(box))} km² box · ${sel.nCells} cells`, clear),
      h('div', { class: 'kpis' },
        kpi('Hotspots (harmonized)', formatCount(harm), { primary: true, hint: hint ?? 'MODIS-equivalent count in the area' }),
        kpi('Peak month', peak && (peak.countHarm ?? 0) > 0 ? `${MONTH_NAMES[peak.month - 1]} ${peak.year}` : 'None', { hint: peak && (peak.countHarm ?? 0) > 0 ? `${formatCount(peak.countHarm)} hotspots` : hint }),
        kpi('Peak year', peakYear && (peakYear.total ?? 0) > 0 ? String(peakYear.year) : 'None', { hint: peakYear && (peakYear.total ?? 0) > 0 ? `${formatCount(peakYear.total)} hotspots${peakYear.complete ? '' : ` · ${peakYear.monthsWithData} month${peakYear.monthsWithData === 1 ? "" : "s"}`}` : hint }),
        kpi('Detections', formatCount(sum((m) => (m.rawModis ?? 0) + (m.rawViirs ?? 0))), { hint: 'All sensors, raw' }),
      ),
      h('div', { class: 'summary-extra' },
        inline('Fire radiative power:', `${formatCount(sum((m) => m.frpSum))} MW`),
        s ? inline('Days with no data:', formatCount(s.daysMissing)) : null,
        rawDetails(sum((m) => m.rawModis), sum((m) => m.rawViirs)),
        h('p', { class: 'note' }, `Box ${box.map((v) => v.toFixed(2)).join(', ')} (W, S, E, N), snapped to the 0.25° data grid. Only the part inside ${region.name} has data. The calendar, charts, map and downloads below show this area.`),
      ),
    ];
  }

  async function render(): Promise<void> {
    const mine = ++token;
    const { drawnBox } = ctx.state.get();
    if (ctx.loaded.get().loading) return el.replaceChildren(h('p', { class: 'note' }, 'Loading…'));
    if (drawnBox) {
      if (mine === token) el.replaceChildren(...boxView(drawnBox));
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
