// S27: "How does this fire compare?" The chosen dates (up to one year) against the same calendar dates
// in every other year: rank, percentile, and the most similar past episodes.
// Whole region: daily data. Drawn area: whole months (the grid is monthly).

import type { AppContext } from '../context';
import { type Comparison, compareWindow, dailyWindow, MAX_MISSING_SHARE, MAX_WINDOW_DAYS, monthWindow, type WindowStat } from '../data/compare';
import { daysBetween, MONTH_NAMES, monthPeaks } from '../data/derive';
import { formatCount, h } from '../dom';

const SVG = 'http://www.w3.org/2000/svg';
const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

function addDays(date: string, n: number): string {
  return new Date(Date.parse(date + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

function windowLabel(w: WindowStat, unit: 'day' | 'month'): string {
  if (unit === 'month') {
    const a = `${MONTH_NAMES[Number(w.start.slice(5, 7)) - 1]} ${w.start.slice(0, 4)}`;
    const b = `${MONTH_NAMES[Number(w.end.slice(5, 7)) - 1]} ${w.end.slice(0, 4)}`;
    return a === b ? a : `${a} – ${b}`;
  }
  return `${w.start} – ${w.end}`;
}

/** One bar per year, selected year in the accent colour. */
function yearBars(c: Comparison): SVGSVGElement {
  const all = [...c.others, c.selected].sort((a, b) => a.year - b.year);
  const max = Math.max(1, ...all.map((w) => w.count));
  const W = 640, H = 150, padL = 44, padB = 22, padT = 8;
  const bw = (W - padL) / all.length;
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'cmp-bars', role: 'img' });
  root.setAttribute('aria-label', `Harmonized hotspots in the same dates of each year, ${all[0]!.year} to ${all[all.length - 1]!.year}. The chosen year is highlighted.`);
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max);
  for (const t of [0, max / 2, max]) {
    root.append(svg('line', { x1: padL, x2: W, y1: y(t), y2: y(t), class: 'cmp-grid' }));
    const lab = svg('text', { x: padL - 6, y: y(t) + 4, 'text-anchor': 'end', class: 'cmp-axis' });
    lab.textContent = formatCount(t);
    root.append(lab);
  }
  all.forEach((w, i) => {
    const x = padL + i * bw;
    const r = svg('rect', { x: x + bw * 0.15, width: Math.max(1, bw * 0.7), y: y(w.count), height: Math.max(0, H - padB - y(w.count)),
      class: w === c.selected ? 'cmp-bar is-selected' : 'cmp-bar' });
    const tip = svg('title', {});
    tip.textContent = `${windowLabel(w, c.unit)}: ${formatCount(w.count)} hotspots`;
    r.append(tip);
    root.append(r);
    if (all.length <= 14 || w.year % 5 === 0 || w === c.selected) {
      const lab = svg('text', { x: x + bw / 2, y: H - 6, 'text-anchor': 'middle', class: w === c.selected ? 'cmp-axis is-selected' : 'cmp-axis' });
      lab.textContent = String(w.year);
      root.append(lab);
    }
  });
  return root;
}

export function mountCompare(el: HTMLElement, ctx: AppContext): void {
  const body = h('div', { class: 'compare' });
  el.replaceChildren(
    h('div', { class: 'panel-head' }, h('h2', {}, 'Compare with past years')),
    body,
  );

  const setDates = (startDate: string, endDate: string) => ctx.state.set({ startDate, endDate });

  function shortcuts(): HTMLElement {
    const cov = ctx.metadata.time_coverage;
    const rd = ctx.loaded.get().regionData;
    const chips: HTMLElement[] = [];
    const last = h('button', { type: 'button', class: 'chip' }, 'Last 30 days of data');
    last.addEventListener('click', () => setDates(addDays(cov.end, -29), cov.end));
    chips.push(last);
    const { startDate, endDate } = ctx.state.get();
    if (rd && startDate && endDate) {
      const p = monthPeaks(rd.monthly, startDate, endDate).peakMonth;
      if (p) {
        const s = `${p.year}-${String(p.month).padStart(2, '0')}-01`;
        const e = addDays(new Date(Date.UTC(p.year, p.month, 1)).toISOString().slice(0, 10), -1);
        const b = h('button', { type: 'button', class: 'chip' }, `Busiest month in the dates (${MONTH_NAMES[p.month - 1]} ${p.year})`);
        b.addEventListener('click', () => setDates(s, e));
        chips.push(b);
      }
    }
    return h('div', { class: 'chips' }, ...chips);
  }

  function render(): void {
    const { startDate, endDate } = ctx.state.get();
    const { regionData, selection } = ctx.loaded.get();
    if (!regionData || !selection || !startDate || !endDate) {
      body.replaceChildren(h('p', { class: 'note' }, ctx.loaded.get().selectionError ?? 'Loading…'));
      return;
    }
    const intro = h('p', { class: 'note' },
      'Choose the dates of a fire (up to one year). They are compared with the same calendar dates in every other year of the record. ',
      `Near-real-time data is not included, so the newest date you can compare is ${ctx.metadata.time_coverage.end}.`);
    const days = daysBetween(startDate, endDate) + 1;
    if (days > MAX_WINDOW_DAYS) {
      body.replaceChildren(intro, h('p', {}, `The chosen dates span ${formatCount(days)} days. Pick ${MAX_WINDOW_DAYS} days or fewer to compare, or start from:`), shortcuts());
      return;
    }
    const area = selection.kind === 'area';
    const c = area
      ? compareWindow((s, e) => monthWindow(selection.months, s, e), 'month', startDate, endDate, ctx.metadata.time_coverage)
      : compareWindow((s, e) => dailyWindow(regionData.daily, s, e), 'day', startDate, endDate, regionData.daily);
    if (!c) {
      body.replaceChildren(intro, h('p', {}, 'These dates are not fully inside the data. Pick dates inside the covered period.'), shortcuts());
      return;
    }
    const where = area ? 'this area' : selection.label;
    const sel = c.selected;
    const pctText = c.percentile == null ? 'Too few other years to give a percentile.'
      : `Higher than ${Math.round(c.percentile)}% of the other ${c.others.length} years.`;
    const warn = sel.missingShare > 0
      ? h('p', { class: 'note' }, `${Math.round(sel.missingShare * 100)}% of the chosen ${c.unit === 'day' ? 'days' : 'months'} have no satellite data (outage), so the count is a lower bound.`)
      : null;

    const table = h('table', {},
      h('caption', {}, 'Most similar past episodes (closest harmonized count in the same dates)'),
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Dates'), h('th', { scope: 'col' }, 'Hotspots'), h('th', { scope: 'col' }, 'vs chosen'),
        h('th', { scope: 'col' }, 'FRP (MW)'), h('th', { scope: 'col' }, c.unit === 'day' ? 'Busiest day' : 'Busiest month'), h('th', { scope: 'col' }, ''))),
      h('tbody', {}, ...c.similar.map((w) => {
        const go = h('button', { type: 'button', class: 'link-button' }, 'Show');
        go.setAttribute('aria-label', `Show ${windowLabel(w, c.unit)}`);
        go.addEventListener('click', () => setDates(w.start, w.end));
        const ratio = sel.count > 0 ? `${w.count >= sel.count ? '+' : '−'}${Math.round(Math.abs(w.count / sel.count - 1) * 100)}%` : '–';
        return h('tr', {},
          h('th', { scope: 'row' }, windowLabel(w, c.unit)),
          h('td', {}, formatCount(w.count)), h('td', {}, ratio), h('td', {}, formatCount(w.frp)),
          h('td', {}, w.peakDate ?? '–'), h('td', {}, go));
      })),
    );

    const parts: (HTMLElement | null)[] = [
      intro,
      h('div', { class: 'kpis' },
        h('div', { class: 'kpi is-primary' }, h('p', { class: 'kpi-label' }, `Chosen dates in ${where}`),
          h('p', { class: 'kpi-value' }, formatCount(sel.count)), h('p', { class: 'kpi-hint' }, `${windowLabel(sel, c.unit)} · harmonized hotspots`)),
        h('div', { class: 'kpi' }, h('p', { class: 'kpi-label' }, 'Rank among years'),
          h('p', { class: 'kpi-value' }, `${ordinal(c.rank)}`, h('span', { class: 'unit' }, `of ${c.of}`)), h('p', { class: 'kpi-hint' }, pctText)),
        h('div', { class: 'kpi' }, h('p', { class: 'kpi-label' }, 'Fire radiative power'),
          h('p', { class: 'kpi-value' }, formatCount(sel.frp), h('span', { class: 'unit' }, 'MW')), h('p', { class: 'kpi-hint' }, 'Sum over detections, all sensors')),
        h('div', { class: 'kpi' }, h('p', { class: 'kpi-label' }, c.unit === 'day' ? 'Busiest day' : 'Busiest month'),
          h('p', { class: 'kpi-value' }, sel.peakDate ?? '–'), h('p', { class: 'kpi-hint' }, `${formatCount(sel.peakCount)} hotspots`)),
      ),
      warn,
      h('div', { class: 'cmp-chart' }, yearBars(c)),
      c.similar.length ? h('div', { class: 'table-wrap' }, table) : h('p', { class: 'note' }, 'No other year has data for these dates.'),
      h('p', { class: 'note' },
        area ? 'Drawn area: compared by whole months, because the area data is monthly. ' : '',
        `Years where more than ${Math.round(MAX_MISSING_SHARE * 100)}% of the dates have no satellite data are left out`,
        c.skipped.length ? ` (${c.skipped.join(', ')}).` : '.',
        ' Counts before 2012 are MODIS only; later counts blend MODIS and VIIRS (see Methods).'),
    ];
    body.replaceChildren(...parts.filter((x): x is HTMLElement => x != null));
  }

  ctx.loaded.subscribe(render);
  ctx.state.subscribe((s, p) => { if (s.startDate !== p.startDate || s.endDate !== p.endDate) render(); });
  render();
}
