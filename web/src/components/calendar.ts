// S21: burning activity calendar. Years x months heatmap of the harmonized count for the current
// selection (the whole region, or the drawn area). Three colour modes, a legend, tooltips, hatching for
// missing data, yearly totals on the right, the typical month at the bottom, and keyboard navigation.
// Clicking a month sets the date range to that month.

import type { AppContext } from '../context';
import { anomalyPct, percentileOf, rankOf, type Selection, type SeriesMonth, yearTotals, ym } from '../data/selection';
import { MONTH_NAMES } from '../data/derive';
import type { ColorMode } from '../state';
import { formatCount, h } from '../dom';
import { ANOM_EDGES, ANOM_LABELS, anomStep, divColor, logEdge, logStep, PCT_EDGES, pctStep, SEQ_STEPS, seqColor } from './scales';
import { hideTip, showTip, showTipFor } from './tooltip';

const MODES: { id: ColorMode; label: string }[] = [
  { id: 'absolute', label: 'Count (log)' },
  { id: 'percentile', label: 'Percentile' },
  { id: 'anomaly', label: 'Anomaly' },
];

function styled<T extends HTMLElement>(el: T, prop: 'width' | 'height', value: string): T {
  el.style[prop] = value;
  return el;
}

const signed = (v: number) => `${v >= 0 ? '+' : '−'}${Math.round(Math.abs(v))}%`;
const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

export interface CellInfo {
  m: SeriesMonth;
  color: string | null; // null = no data (hatched)
  pct: number | null;
  anom: number | null;
}

/** Colour and numbers for every month of a selection in a mode. Exported for tests. */
export function cellInfos(sel: Selection, mode: ColorMode): CellInfo[] {
  const max = Math.max(0, ...sel.months.map((m) => m.countHarm ?? 0));
  return sel.months.map((m) => {
    const base = sel.baseline.find((b) => b.month === m.month);
    const pct = percentileOf(m.countHarm, m.month, sel.months, sel.basePeriod);
    const anom = anomalyPct(m.countHarm, base);
    let color: string | null = null;
    if (m.countHarm != null) {
      if (mode === 'absolute') color = seqColor(logStep(m.countHarm, max));
      else if (mode === 'percentile') color = m.countHarm === 0 ? seqColor(0) : pct == null ? null : seqColor(pctStep(pct));
      else color = anom == null ? (m.countHarm === 0 ? seqColor(0) : null) : divColor(anomStep(anom));
    }
    return { m, color, pct, anom };
  });
}

function tipLines(info: CellInfo, sel: Selection): string[] {
  const { m } = info;
  if (m.countHarm == null) return ['No data: no satellite data for this month.'];
  const lines = [`${formatCount(m.countHarm)} hotspots (MODIS-equivalent)`];
  if (m.countLow != null && m.countHigh != null && m.countHigh > m.countLow) lines.push(`Approximate range ${formatCount(m.countLow)}–${formatCount(m.countHigh)}`);
  const r = rankOf(m, sel.months);
  if (r && m.countHarm > 0) lines.push(`Rank ${r.rank} of ${r.of} ${MONTH_NAMES[m.month - 1]}s`);
  if (info.pct != null) lines.push(`${ordinal(Math.round(info.pct))} percentile`);
  lines.push(info.anom == null ? 'Anomaly: no baseline' : `${signed(info.anom)} vs typical ${MONTH_NAMES[m.month - 1]}`);
  lines.push(`Raw detections: MODIS ${formatCount(m.rawModis)}, VIIRS ${formatCount(m.rawViirs)}`);
  return lines;
}

function legend(mode: ColorMode, sel: Selection): HTMLElement {
  const max = Math.max(0, ...sel.months.map((m) => m.countHarm ?? 0));
  const sw = (color: string, label: string) => { const b = h('span', { class: 'swatch' }); b.style.background = color; return h('li', {}, b, label); };
  const hatch = h('li', {}, h('span', { class: 'swatch is-missing' }), 'No data');
  let items: HTMLElement[];
  if (mode === 'absolute') {
    items = [sw(seqColor(0), '0')];
    for (let i = 1; i < SEQ_STEPS; i++) {
      const lo = Math.floor(logEdge(i - 1, max)) + 1;
      const hi = Math.floor(logEdge(i, max));
      if (hi >= lo) items.push(sw(seqColor(i), lo === hi ? formatCount(lo) : `${formatCount(lo)}–${formatCount(hi)}`));
    }
  } else if (mode === 'percentile') {
    items = [sw(seqColor(0), '0 fires')];
    for (let i = 1; i < PCT_EDGES.length; i++) items.push(sw(seqColor(i), `${PCT_EDGES[i - 1]}–${PCT_EDGES[i]}`));
  } else {
    items = ANOM_LABELS.map((l, i) => sw(divColor(i), l));
  }
  const unit = mode === 'absolute' ? 'Hotspots per month' : mode === 'percentile'
    ? `Percentile among ${sel.basePeriod.start_year}–${sel.basePeriod.end_year} for the same month`
    : `Difference from the typical month (${sel.basePeriod.start_year}–${sel.basePeriod.end_year} mean)`;
  void ANOM_EDGES;
  return h('div', { class: 'cal-legend' }, h('p', { class: 'note' }, unit), h('ul', {}, ...items, hatch));
}

export function mountCalendar(el: HTMLElement, ctx: AppContext): void {
  const seg = h('div', { class: 'segmented', role: 'group' });
  seg.setAttribute('aria-label', 'Calendar colour mode');
  const buttons = MODES.map((m) => {
    const b = h('button', { type: 'button', textContent: m.label });
    b.addEventListener('click', () => ctx.state.set({ colorMode: m.id }));
    b.dataset.mode = m.id;
    return b;
  });
  seg.append(...buttons);
  const title = h('h2', { id: 'calendar-title' }, 'Burning activity calendar');
  const sub = h('p', { class: 'note' });
  const body = h('div', { class: 'cal-body' });
  el.replaceChildren(h('div', { class: 'panel-head' }, h('div', {}, title, sub), seg), body);

  let focusKey: string | null = null; // year-month that has tabindex 0

  function render(): void {
    const sel = ctx.loaded.get().selection;
    const { colorMode, startDate, endDate } = ctx.state.get();
    buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === colorMode)));
    const err = ctx.loaded.get().selectionError;
    if (!sel) {
      sub.textContent = '';
      body.replaceChildren(h('p', { class: err ? 'field-error' : 'note' }, err ?? 'Loading…'));
      return;
    }
    sub.textContent = `${sel.label}${sel.kind === 'area' ? ` · ${sel.nCells} grid cells of 0.25°` : ''} · harmonized hotspots per month. Click a month to select it.`;
    const infos = cellInfos(sel, colorMode);
    const byKey = new Map(infos.map((i) => [ym(i.m), i]));
    const years = [...new Set(sel.months.map((m) => m.year))].sort((a, b) => a - b);
    const totals = new Map(yearTotals(sel.months).map((t) => [t.year, t]));
    const maxTotal = Math.max(1, ...[...totals.values()].map((t) => t.total ?? 0));
    const transitions = ctx.metadata.sensor_transitions;
    const keys = sel.months.map((m) => ym(m));
    const narrowed = !!startDate && !!endDate && (startDate.slice(0, 7) > keys[0]! || endDate.slice(0, 7) < keys[keys.length - 1]!);
    const inRange = (k: string) => narrowed && k >= startDate!.slice(0, 7) && k <= endDate!.slice(0, 7);
    if (!focusKey || !byKey.has(focusKey)) {
      const peak = infos.filter((i) => i.m.countHarm != null).sort((a, b) => (b.m.countHarm ?? 0) - (a.m.countHarm ?? 0))[0];
      focusKey = peak ? ym(peak.m) : ym(infos[0]!.m);
    }

    const grid = h('div', { class: 'cal-grid', role: 'grid' });
    grid.setAttribute('aria-labelledby', 'calendar-title');
    grid.setAttribute('aria-describedby', 'calendar-help');
    const headRow = h('div', { class: 'cal-row cal-head', role: 'row' },
      h('span', { class: 'cal-year', role: 'columnheader' }, 'Year'),
      ...MONTH_NAMES.map((n) => h('span', { class: 'cal-month', role: 'columnheader' }, n.slice(0, 1), h('span', { class: 'cal-month-rest' }, n.slice(1)))),
      h('span', { class: 'cal-total', role: 'columnheader' }, 'Year total'));
    grid.append(headRow);

    for (const y of years) {
      const marks = transitions.filter((t) => t.date.startsWith(String(y)));
      const yearCell = h('span', { class: 'cal-year', role: 'rowheader' }, String(y));
      if (marks.length) {
        const dot = h('span', { class: 'cal-mark', title: marks.map((t) => `${t.date}: ${t.label}`).join('\n') });
        dot.setAttribute('aria-label', marks.map((t) => t.label).join('; '));
        yearCell.append(dot);
      }
      const row = h('div', { class: 'cal-row', role: 'row' }, yearCell);
      for (let mo = 1; mo <= 12; mo++) {
        const key = ym({ year: y, month: mo });
        const info = byKey.get(key);
        if (!info) {
          row.append(h('span', { class: 'cal-cell is-outside', role: 'gridcell' }));
          continue;
        }
        const cell = h('button', { type: 'button', class: `cal-cell${info.color ? '' : ' is-missing'}${inRange(key) ? ' is-selected' : ''}`, role: 'gridcell' });
        if (info.color) cell.style.background = info.color;
        cell.dataset.key = key;
        cell.tabIndex = key === focusKey ? 0 : -1;
        const title = `${MONTH_NAMES[mo - 1]} ${y}`;
        const lines = tipLines(info, sel);
        cell.setAttribute('aria-label', `${title}: ${lines.join('. ')}`);
        cell.addEventListener('mouseenter', (e) => showTip(e.clientX, e.clientY, title, lines));
        cell.addEventListener('mousemove', (e) => showTip(e.clientX, e.clientY, title, lines));
        cell.addEventListener('mouseleave', hideTip);
        cell.addEventListener('focus', () => { focusKey = key; showTipFor(cell, title, lines); });
        cell.addEventListener('blur', hideTip);
        cell.addEventListener('click', () => {
          const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
          const { start, end } = ctx.metadata.time_coverage;
          const s = `${key}-01`;
          const e = `${key}-${String(last).padStart(2, '0')}`;
          ctx.state.set({ startDate: s < start ? start : s, endDate: e > end ? end : e });
        });
        row.append(cell);
      }
      const t = totals.get(y);
      const bar = h('span', { class: 'cal-total' },
        styled(h('span', { class: 'cal-bar' }), 'width', `${t?.total ? Math.max(2, (t.total / maxTotal) * 100) : 0}%`),
        h('span', { class: 'cal-total-num' }, t?.total == null ? '—' : `${formatCount(t.total)}${t.complete ? '' : '*'}`));
      row.append(bar);
      grid.append(row);
    }

    // Bottom row: the typical month (baseline mean), so the season is visible at a glance.
    const means = sel.baseline.map((b) => b.mean ?? 0);
    const maxMean = Math.max(1, ...means);
    const typRow = h('div', { class: 'cal-row cal-typical', role: 'row' },
      h('span', { class: 'cal-year', role: 'rowheader' }, 'Typical'),
      ...sel.baseline.map((b) => {
        const c = h('span', { class: 'cal-typ', role: 'gridcell' },
          styled(h('span', { class: 'cal-typ-bar' }), 'height', `${b.mean ? Math.max(2, (b.mean / maxMean) * 100) : 0}%`));
        const label = b.mean == null ? `${MONTH_NAMES[b.month - 1]}: no baseline` : `${MONTH_NAMES[b.month - 1]}: typical ${formatCount(b.mean)} hotspots (mean ${sel.basePeriod.start_year}–${sel.basePeriod.end_year})`;
        c.setAttribute('aria-label', label);
        c.title = label;
        return c;
      }),
      h('span', { class: 'cal-total note' }, 'mean per month'));
    grid.append(typRow);

    grid.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement;
      const key = target.dataset.key;
      if (!key) return;
      const [yy, mm] = key.split('-').map(Number) as [number, number];
      let y = yy;
      let m = mm;
      if (e.key === 'ArrowRight') m++;
      else if (e.key === 'ArrowLeft') m--;
      else if (e.key === 'ArrowDown') y++;
      else if (e.key === 'ArrowUp') y--;
      else if (e.key === 'Home') m = 1;
      else if (e.key === 'End') m = 12;
      else if (e.key === 'Escape') { hideTip(); return; }
      else return;
      e.preventDefault();
      if (m < 1) { m = 12; y--; }
      if (m > 12) { m = 1; y++; }
      const next = grid.querySelector<HTMLElement>(`[data-key="${ym({ year: y, month: m })}"]`);
      if (next) {
        target.tabIndex = -1;
        next.tabIndex = 0;
        next.focus();
      }
    });

    const partial = [...totals.values()].some((t) => t.total != null && !t.complete);
    const hadFocus = body.contains(document.activeElement);
    body.replaceChildren(
      legend(colorMode, sel),
      h('div', { class: 'cal-scroll' }, grid),
      h('p', { class: 'note', id: 'calendar-help' },
        'Hatched = no satellite data (not zero fires). ',
        partial ? '* = year with fewer than 12 months of data. ' : '',
        transitions.length ? 'A dot after a year marks a sensor change (hover for details). ' : '',
        'Keyboard: arrow keys move between months, Enter selects a month.'),
    );
    if (hadFocus) grid.querySelector<HTMLElement>(`[data-key="${focusKey}"]`)?.focus();
  }

  ctx.loaded.subscribe(render);
  ctx.state.subscribe((s, p) => {
    if (s.colorMode !== p.colorMode || s.startDate !== p.startDate || s.endDate !== p.endDate) render();
  });
  render();
}
