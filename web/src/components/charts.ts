// S22: charts for the current selection (whole region or drawn area) and date range.
//   1. Monthly series with the approximate range (band)
//   2. Yearly totals (partial years hatched)
//   3. Seasonal cycle: typical range per calendar month, with the selected year on top
// Hand-written SVG. Every chart has a hover/focus tooltip and a "Show as table" view.

import type { AppContext } from '../context';
import { daysBetween, MONTH_NAMES } from '../data/derive';
import { isoDay } from '../data/latest';
import { loadHotspots } from '../data/loader';
import { monthsInRange, pointInSnappedBox, type Selection, type SeriesMonth, yearTotals } from '../data/selection';
import { formatCount, h } from '../dom';
import { hideTip, showTip } from './tooltip';

const NS = 'http://www.w3.org/2000/svg';

function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, ...kids: (Node | null)[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of kids) if (c) el.append(c);
  return el;
}

function text(x: number, y: number, t: string, attrs: Record<string, string | number> = {}): SVGTextElement {
  const el = s('text', { x, y, ...attrs });
  el.textContent = t;
  return el;
}

/** 3-5 round tick values from 0 to at least max. */
export function niceTicks(max: number): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].map((f) => f * mag).find((v) => v >= raw) ?? 10 * mag);
  const out: number[] = [];
  for (let v = 0; v < max + step * 0.999; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

interface Frame { w: number; h: number; left: number; right: number; top: number; bottom: number }

function axes(svg: SVGSVGElement, f: Frame, ticks: number[], yMax: number): (v: number) => number {
  const y = (v: number) => f.top + (f.h - f.top - f.bottom) * (1 - v / yMax);
  for (const t of ticks) {
    svg.append(s('line', { x1: f.left, x2: f.w - f.right, y1: y(t), y2: y(t), class: 'grid-line' }));
    svg.append(text(f.left - 6, y(t) + 4, compact.format(t), { class: 'axis-label', 'text-anchor': 'end' }));
  }
  return y;
}

function svgRoot(f: Frame, label: string): SVGSVGElement {
  const svg = s('svg', { viewBox: `0 0 ${f.w} ${f.h}`, width: f.w, height: f.h, role: 'img', class: 'chart-svg' });
  svg.setAttribute('aria-label', label);
  return svg;
}

function table(caption: string, head: string[], rows: (string | number)[][]): HTMLElement {
  return h('details', { class: 'chart-table' },
    h('summary', {}, 'Show as table'),
    h('div', { class: 'table-wrap' },
      h('table', {},
        h('caption', {}, caption),
        h('thead', {}, h('tr', {}, ...head.map((c) => h('th', { scope: 'col' }, c)))),
        h('tbody', {}, ...rows.map((r) => h('tr', {}, ...r.map((c, i) => (i === 0 ? h('th', { scope: 'row' }, String(c)) : h('td', {}, String(c)))))))),
    ),
  );
}

function card(title: string, note: string, chart: Node, extra: HTMLElement | null, tbl: HTMLElement): HTMLElement {
  return h('figure', { class: 'chart-card' },
    h('figcaption', {}, h('h3', { class: 'chart-title' }, title), h('p', { class: 'note' }, note)),
    h('div', { class: 'chart-box' }, chart), extra, tbl);
}

// ---------- 1. monthly series (daily for short date ranges) ----------

/** One point of the line chart: a month, or a day for short date ranges. */
export interface LinePoint { key: string; label: string; tick: string | null; v: number | null; lo: number | null; hi: number | null }

export const DAILY_CHART_MAX_DAYS = 92;

function monthPoints(months: SeriesMonth[]): LinePoint[] {
  return months.map((m, i) => ({
    key: `${m.year}-${String(m.month).padStart(2, '0')}`, label: `${MONTH_NAMES[m.month - 1]} ${m.year}`,
    tick: m.month === 1 || i === 0 ? (months.length <= 24 ? `${MONTH_NAMES[m.month - 1]} ${m.year}` : String(m.year)) : null,
    v: m.countHarm, lo: m.countLow, hi: m.countHigh,
  }));
}

/** Daily points from {date: value} (null = no satellite data). */
export function dayPoints(days: [string, number | null][]): LinePoint[] {
  return days.map(([d, v], i) => {
    const day = Number(d.slice(8));
    const label = new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    return { key: d, label, tick: i === 0 || day === 1 || day === 15 ? label.replace(/, \d{4}$/, '') : null, v, lo: null, hi: null };
  });
}

function monthlyChart(sel: Selection, months: SeriesMonth[], width: number): HTMLElement {
  return lineChart(sel, monthPoints(months), width, 'Monthly hotspots',
    `${months[0] ? `${MONTH_NAMES[months[0].month - 1]} ${months[0].year}` : ''} – ${months.at(-1) ? `${MONTH_NAMES[months.at(-1)!.month - 1]} ${months.at(-1)!.year}` : ''} · MODIS-equivalent count`, 'Month');
}

function lineChart(sel: Selection, pts: LinePoint[], width: number, title: string, note: string, unit: 'Month' | 'Day'): HTMLElement {
  const months = pts;
  const f: Frame = { w: width, h: 240, left: 44, right: 12, top: 12, bottom: 28 };
  const hasBand = months.some((m) => m.hi != null && m.lo != null && m.hi > m.lo);
  const yMax = Math.max(1, ...months.map((m) => Math.max(m.hi ?? 0, m.v ?? 0)));
  const ticks = niceTicks(yMax);
  const top = ticks[ticks.length - 1] ?? yMax;
  const svg = svgRoot(f, `${title}: harmonized hotspots for ${sel.label}`);
  const y = axes(svg, f, ticks, top);
  const n = months.length;
  const x = (i: number) => f.left + (n <= 1 ? 0.5 : i / (n - 1)) * (f.w - f.left - f.right);

  // band and line, broken where data is missing
  let band: string[] = [];
  let lower: string[] = [];
  let line = '';
  const flushBand = () => {
    if (band.length) svg.append(s('path', { d: `M${band.join('L')}L${lower.reverse().join('L')}Z`, class: 'band' }));
    band = [];
    lower = [];
  };
  months.forEach((m, i) => {
    if (m.v == null) { flushBand(); line += ' '; return; }
    band.push(`${x(i)},${y(m.hi ?? m.v)}`);
    lower.push(`${x(i)},${y(m.lo ?? m.v)}`);
    line += `${line.endsWith(' ') || line === '' ? 'M' : 'L'}${x(i)},${y(m.v)}`;
  });
  flushBand();
  if (hasBand) svg.querySelectorAll('.band').forEach((b) => svg.prepend(b));
  svg.append(s('path', { d: line.trim(), class: 'series-line' }));
  // short series: a dot on every point, so one month or a few days still show
  if (n <= 62) months.forEach((m, i) => { if (m.v != null) svg.append(s('circle', { cx: x(i), cy: y(m.v), r: n === 1 ? 4 : 2.5, class: 'series-dot' })); });
  // missing months marked on the axis
  months.forEach((m, i) => { if (m.v == null) svg.append(s('rect', { x: x(i) - 2, y: f.h - f.bottom + 2, width: 4, height: 6, class: 'missing-mark' })); });
  // x labels: thinned so they do not overlap
  const ticked = months.map((m, i) => [m, i] as const).filter(([m]) => m.tick != null);
  const every = Math.max(1, Math.ceil(ticked.length / Math.max(2, Math.floor((f.w - f.left) / 70))));
  ticked.forEach(([m, i], k) => {
    if (k % every === 0) svg.append(text(x(i), f.h - 8, m.tick!, { class: 'axis-label', 'text-anchor': i === 0 ? 'start' : 'middle' }));
  });
  // hover / keyboard
  const cross = s('line', { y1: f.top, y2: f.h - f.bottom, class: 'crosshair', visibility: 'hidden' });
  const dot = s('circle', { r: 4.5, class: 'hover-dot', visibility: 'hidden' });
  svg.append(cross, dot);
  const hit = s('rect', { x: f.left, y: f.top, width: f.w - f.left - f.right, height: f.h - f.top - f.bottom, class: 'hit', tabindex: 0 });
  hit.setAttribute('aria-label', `${title}. Use left and right arrow keys to read ${unit === 'Day' ? 'days' : 'months'}.`);
  svg.append(hit);
  let cur = n - 1;
  const show = (i: number, cx?: number, cy?: number) => {
    const m = months[i];
    if (!m) return;
    cur = i;
    cross.setAttribute('x1', String(x(i)));
    cross.setAttribute('x2', String(x(i)));
    cross.setAttribute('visibility', 'visible');
    if (m.v != null) {
      dot.setAttribute('cx', String(x(i)));
      dot.setAttribute('cy', String(y(m.v)));
      dot.setAttribute('visibility', 'visible');
    } else dot.setAttribute('visibility', 'hidden');
    const r = svg.getBoundingClientRect();
    const lines = m.v == null ? ['No data'] : [`${formatCount(m.v)} hotspots`,
      ...(m.lo != null && m.hi != null && m.hi > m.lo ? [`Range ${formatCount(m.lo)}–${formatCount(m.hi)}`] : [])];
    showTip(cx ?? r.left + x(i) * (r.width / f.w), cy ?? r.top + y(m.v ?? 0) * (r.height / f.h), m.label, lines);
  };
  const hide = () => { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); hideTip(); };
  hit.addEventListener('mousemove', (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * f.w;
    show(Math.max(0, Math.min(n - 1, Math.round(((px - f.left) / (f.w - f.left - f.right)) * (n - 1)))), e.clientX, e.clientY);
  });
  hit.addEventListener('mouseleave', hide);
  hit.addEventListener('focus', () => show(cur));
  hit.addEventListener('blur', hide);
  hit.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      show(Math.max(0, Math.min(n - 1, cur + (e.key === 'ArrowLeft' ? -1 : 1))));
    }
  });
  const key = h('p', { class: 'chart-key' },
    h('span', { class: 'key-line' }), 'Harmonized count',
    hasBand ? h('span', { class: 'key-band' }) : null, hasBand ? 'Approximate range' : null,
    months.some((m) => m.v == null) ? h('span', { class: 'key-missing' }) : null,
    months.some((m) => m.v == null) ? 'No data' : null);
  return card(title, note, svg, key,
    table(`${title}, harmonized`, [unit, 'Hotspots', 'Low', 'High'], months.map((m) => [m.key, formatCount(m.v), formatCount(m.lo), formatCount(m.hi)])));
}

// ---------- 2. yearly totals ----------

function yearlyChart(sel: Selection, months: SeriesMonth[], width: number): HTMLElement {
  const totals = yearTotals(months);
  const f: Frame = { w: width, h: 220, left: 44, right: 8, top: 12, bottom: 28 };
  const yMax = Math.max(1, ...totals.map((t) => t.total ?? 0));
  const ticks = niceTicks(yMax);
  const top = ticks[ticks.length - 1] ?? yMax;
  const svg = svgRoot(f, `Yearly harmonized hotspots for ${sel.label}`);
  const y = axes(svg, f, ticks, top);
  const slot = (f.w - f.left - f.right) / Math.max(1, totals.length);
  const bw = Math.max(3, Math.min(36, slot - 2));
  const pat = s('pattern', { id: 'hatch-partial', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
    s('rect', { width: 6, height: 6, class: 'bar-partial-bg' }), s('line', { x1: 0, y1: 0, x2: 0, y2: 6, class: 'bar-partial-line' }));
  svg.prepend(s('defs', {}, pat));
  const every = Math.max(1, Math.ceil(totals.length / Math.max(2, Math.floor((f.w - f.left) / 44))));
  totals.forEach((t, i) => {
    const cx = f.left + slot * (i + 0.5);
    if (t.total != null) {
      const top = y(t.total);
      const hgt = Math.max(0, y(0) - top);
      const r = Math.min(4, bw / 2, hgt);
      const d = `M${cx - bw / 2},${y(0)}V${top + r}Q${cx - bw / 2},${top} ${cx - bw / 2 + r},${top}H${cx + bw / 2 - r}Q${cx + bw / 2},${top} ${cx + bw / 2},${top + r}V${y(0)}Z`;
      const bar = s('path', { d, class: t.complete ? 'bar' : 'bar is-partial', tabindex: 0 });
      const lines = [`${formatCount(t.total)} hotspots`, t.complete ? 'Full year' : `${t.monthsWithData} month${t.monthsWithData === 1 ? "" : "s"} of data`];
      bar.setAttribute('aria-label', `${t.year}: ${lines.join(', ')}`);
      bar.addEventListener('mousemove', (e) => showTip(e.clientX, e.clientY, String(t.year), lines));
      bar.addEventListener('mouseleave', hideTip);
      bar.addEventListener('focus', () => { const b = bar.getBoundingClientRect(); showTip(b.right, b.top, String(t.year), lines); });
      bar.addEventListener('blur', hideTip);
      svg.append(bar);
    }
    if (i % every === 0) svg.append(text(cx, f.h - 8, totals.length > 12 ? `'${String(t.year).slice(2)}` : String(t.year), { class: 'axis-label', 'text-anchor': 'middle' }));
  });
  const partial = totals.some((t) => t.total != null && !t.complete);
  return card('Hotspots per year', 'Harmonized count, sum of the months with data',
    svg, partial ? h('p', { class: 'chart-key' }, h('span', { class: 'key-partial' }), 'Partial year (fewer than 12 months of data in the dates chosen)') : null,
    table('Hotspots per year', ['Year', 'Hotspots', 'Months with data'], totals.map((t) => [t.year, formatCount(t.total), t.monthsWithData])));
}

// ---------- 3. seasonal cycle ----------

function seasonalChart(sel: Selection, highlightYear: number, width: number): HTMLElement {
  const f: Frame = { w: width, h: 240, left: 44, right: 8, top: 12, bottom: 28 };
  const base = sel.baseline;
  const hl = sel.months.filter((m) => m.year === highlightYear);
  const yMax = Math.max(1, ...base.map((b) => b.p90 ?? 0), ...hl.map((m) => m.countHarm ?? 0));
  const ticks = niceTicks(yMax);
  const top = ticks[ticks.length - 1] ?? yMax;
  const svg = svgRoot(f, `Seasonal cycle for ${sel.label}`);
  const y = axes(svg, f, ticks, top);
  const slot = (f.w - f.left - f.right) / 12;
  const bw = Math.max(6, Math.min(26, slot * 0.55));
  base.forEach((b, i) => {
    const cx = f.left + slot * (i + 0.5);
    if (b.p10 != null && b.p90 != null && b.p25 != null && b.p75 != null && b.p50 != null) {
      svg.append(s('line', { x1: cx, x2: cx, y1: y(b.p10), y2: y(b.p90), class: 'whisker' }));
      svg.append(s('rect', { x: cx - bw / 2, y: y(b.p75), width: bw, height: Math.max(1, y(b.p25) - y(b.p75)), rx: 3, class: 'box' }));
      svg.append(s('line', { x1: cx - bw / 2, x2: cx + bw / 2, y1: y(b.p50), y2: y(b.p50), class: 'median' }));
    }
    const m = hl.find((x) => x.month === b.month);
    if (m && m.countHarm != null) svg.append(s('circle', { cx, cy: y(m.countHarm), r: 4.5, class: 'year-dot' }));
    const hit = s('rect', { x: cx - slot / 2, y: f.top, width: slot, height: f.h - f.top - f.bottom, class: 'hit', tabindex: 0 });
    const lines = b.p50 == null ? ['Not enough years for a typical range'] : [
      `Median ${formatCount(b.p50)}, middle half ${formatCount(b.p25)}–${formatCount(b.p75)}`,
      `10–90%: ${formatCount(b.p10)}–${formatCount(b.p90)} (${b.n_years} years)`,
      `${highlightYear}: ${m ? formatCount(m.countHarm) : 'not in data'}`];
    hit.setAttribute('aria-label', `${MONTH_NAMES[b.month - 1]}: ${lines.join('. ')}`);
    hit.addEventListener('mousemove', (e) => showTip(e.clientX, e.clientY, MONTH_NAMES[b.month - 1]!, lines));
    hit.addEventListener('mouseleave', hideTip);
    hit.addEventListener('focus', () => { const r = hit.getBoundingClientRect(); showTip(r.right, r.top + 20, MONTH_NAMES[b.month - 1]!, lines); });
    hit.addEventListener('blur', hideTip);
    svg.append(hit);
    svg.append(text(cx, f.h - 8, MONTH_NAMES[b.month - 1]!.slice(0, slot < 30 ? 1 : 3), { class: 'axis-label', 'text-anchor': 'middle' }));
  });
  return card('Seasonal cycle', `Typical month ${sel.basePeriod.start_year}–${sel.basePeriod.end_year}, with ${highlightYear} on top`,
    svg, h('p', { class: 'chart-key' }, h('span', { class: 'key-box' }), 'Middle half of years', h('span', { class: 'key-whisker' }), '10–90% of years',
      h('span', { class: 'key-median' }), 'Median', h('span', { class: 'key-dot' }), String(highlightYear)),
    table('Seasonal cycle', ['Month', 'Median', 'p25', 'p75', 'p10', 'p90', String(highlightYear)],
      base.map((b) => [MONTH_NAMES[b.month - 1]!, formatCount(b.p50), formatCount(b.p25), formatCount(b.p75), formatCount(b.p10), formatCount(b.p90),
        formatCount(hl.find((x) => x.month === b.month)?.countHarm ?? null)])));
}

/** Short date ranges: one point per day. Whole region from daily.json; a drawn area from its hotspot points. */
function dailyCardFactory(ctx: AppContext) {
  return (sel: Selection, start: string, end: string, width: number): HTMLElement => {
    const slot = h('div', {}, h('p', { class: 'note' }, 'Loading the days…'));
    const rd = ctx.loaded.get().regionData!;
    const note = `${start} – ${end} · MODIS-equivalent count per day`;
    const draw = (rows: [string, number | null][]) =>
      slot.replaceChildren(lineChart(sel, dayPoints(rows), width, 'Daily hotspots', note, 'Day'));
    const dates: string[] = [];
    for (let i = 0; i <= daysBetween(start, end); i++) dates.push(isoDay(start, i));
    const regionVal = (d: string) => {
      const i = daysBetween(rd.daily.start, d);
      return i >= 0 && i < rd.daily.columns.count_harm.length ? rd.daily.columns.count_harm[i] ?? null : null;
    };
    if (!sel.box) draw(dates.map((d) => [d, regionVal(d)]));
    else {
      const box = sel.box;
      loadHotspots(sel.regionId, start, end).then((pts) => {
        const sums = new Map<string, number>();
        for (const p of pts) if (pointInSnappedBox(p.latitude, p.longitude, box)) sums.set(p.date, (sums.get(p.date) ?? 0) + p.harmonized_weight);
        draw(dates.map((d) => [d, regionVal(d) == null ? null : Math.round((sums.get(d) ?? 0) * 100) / 100]));
      }).catch((err: unknown) => slot.replaceChildren(h('p', { class: 'field-error' }, err instanceof Error ? err.message : 'Could not load the days.')));
    }
    return slot;
  };
}

export function mountCharts(el: HTMLElement, ctx: AppContext): void {
  const dailyCard = dailyCardFactory(ctx);
  const body = h('div', { class: 'charts' });
  const sub = h('p', { class: 'note' });
  el.replaceChildren(h('div', { class: 'panel-head' }, h('div', {}, h('h2', {}, 'Charts'), sub)), body);
  let lastWidth = 0;

  function render(): void {
    const sel = ctx.loaded.get().selection;
    const { startDate, endDate } = ctx.state.get();
    if (!sel || !startDate || !endDate) {
      body.replaceChildren(h('p', { class: 'note' }, ctx.loaded.get().selectionError ?? 'Loading…'));
      return;
    }
    const months = monthsInRange(sel.months, startDate, endDate);
    sub.textContent = `${sel.label} · ${startDate} – ${endDate}`;
    if (!months.length) {
      body.replaceChildren(h('p', { class: 'note' }, 'No data for these dates.'));
      return;
    }
    const width = Math.max(260, Math.floor(body.clientWidth || el.clientWidth || 600));
    lastWidth = width;
    const half = width >= 760 ? Math.floor((width - 20) / 2) : width;
    const days = daysBetween(startDate, endDate) + 1;
    const first = days <= DAILY_CHART_MAX_DAYS ? dailyCard(sel, startDate, endDate, width) : monthlyChart(sel, months, width);
    body.replaceChildren(
      first,
      h('div', { class: 'chart-pair' },
        yearlyChart(sel, months, half),
        seasonalChart(sel, Number(endDate.slice(0, 4)), half)),
    );
  }

  new ResizeObserver(() => {
    if (Math.abs((body.clientWidth || 0) - lastWidth) > 24) render();
  }).observe(body);
  ctx.loaded.subscribe(render);
  ctx.state.subscribe((s, p) => { if (s.startDate !== p.startDate || s.endDate !== p.endDate) render(); });
  render();
}
