// Methodology page: two small charts drawn from the published data files, so they always match the data.
import './styles.css';
import type { Metadata, Monthly } from './data/types';
import { renderAreaBar, renderFooter, renderTopbar } from './shell';

const base = `${import.meta.env.BASE_URL}data/`;
const NS = 'http://www.w3.org/2000/svg';

async function json<T>(path: string): Promise<T> {
  const r = await fetch(base + path);
  if (!r.ok) throw new Error(`Could not load ${path} (HTTP ${r.status})`);
  return (await r.json()) as T;
}

function el(tag: string, attrs: Record<string, string | number>, text?: string): SVGElement {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text != null) e.textContent = text;
  return e;
}

const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const fmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const MODIS = '#1f6fb5';

function yearsChart(svg: SVGSVGElement, monthly: Monthly): void {
  const by = new Map<number, { modis: number; viirs: number; harm: number }>();
  for (const m of monthly.months) {
    const y = by.get(m.year) ?? { modis: 0, viirs: 0, harm: 0 };
    y.modis += m.count_raw_modis ?? 0;
    y.viirs += m.count_raw_viirs ?? 0;
    y.harm += m.count_harm ?? 0;
    by.set(m.year, y);
  }
  const years = [...by.keys()].sort((a, b) => a - b);
  const W = 720, H = 300, L = 72, R = 90, T = 12, B = 26;
  // Log scale: VIIRS is 3-5 times MODIS, so on a linear scale the MODIS and harmonized lines would be squashed.
  const vals = [...by.values()].flatMap((v) => [v.modis, v.viirs, v.harm]).filter((v) => v > 0);
  const lo = Math.floor(Math.log10(Math.min(...vals)));
  const hi = Math.ceil(Math.log10(Math.max(...vals)));
  const x = (y: number) => L + ((y - years[0]!) / (years[years.length - 1]! - years[0]!)) * (W - L - R);
  const yv = (v: number) => T + (H - T - B) * (1 - (Math.log10(Math.max(v, 10 ** lo)) - lo) / (hi - lo));
  for (let e = lo; e <= hi; e++) {
    svg.append(el('line', { x1: L, x2: W - R, y1: yv(10 ** e), y2: yv(10 ** e), stroke: css('--border') }));
    svg.append(el('text', { x: L - 6, y: yv(10 ** e) + 4, 'text-anchor': 'end' }, fmt.format(10 ** e)));
  }
  for (const y of years) if (y % 5 === 0) svg.append(el('text', { x: x(y), y: H - 6, 'text-anchor': 'middle' }, String(y)));
  const series: ['viirs' | 'modis' | 'harm', string, string, number][] = [
    ['viirs', css('--subtle') || '#888', 'VIIRS raw', 1.5], ['modis', MODIS, 'MODIS raw', 2], ['harm', css('--accent'), 'Harmonized', 2.5],
  ];
  const last = years[years.length - 2]!; // last full year, for the labels
  const labels: { y: number; text: string; color: string }[] = [];
  for (const [key, color, label, w] of series) {
    const pts = years.filter((y) => by.get(y)![key] > 0).map((y) => `${x(y).toFixed(1)},${yv(by.get(y)![key]).toFixed(1)}`).join(' ');
    svg.append(el('polyline', { points: pts, fill: 'none', stroke: color, 'stroke-width': w, 'stroke-linejoin': 'round' }));
    labels.push({ y: yv(by.get(last)![key]) + 4, text: label, color });
  }
  labels.sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) labels[i]!.y = Math.max(labels[i]!.y, labels[i - 1]!.y + 14); // no overlap
  for (const l of labels) svg.append(el('text', { x: x(years[years.length - 1]!) + 8, y: l.y, class: 'lbl', style: `fill:${l.color}` }, l.text));
}

interface Check { months: { year: number; month: number; modis_observed: number; modis_equivalent_from_snpp: number }[] }

function overlapChart(svg: SVGSVGElement, check: Check): void {
  const pts = check.months.filter((m) => m.modis_observed > 0 && m.modis_equivalent_from_snpp > 0);
  const W = 720, H = 340, L = 56, R = 20, T = 12, B = 34;
  const lo = 1, hi = Math.log10(Math.max(...pts.map((p) => Math.max(p.modis_observed, p.modis_equivalent_from_snpp))) * 1.2);
  const sx = (v: number) => L + ((Math.log10(v) - lo) / (hi - lo)) * (W - L - R);
  const sy = (v: number) => T + (H - T - B) * (1 - (Math.log10(v) - lo) / (hi - lo));
  for (const v of [10, 100, 1000, 10000]) {
    if (Math.log10(v) > hi) continue;
    svg.append(el('line', { x1: sx(v), x2: sx(v), y1: T, y2: H - B, stroke: css('--border') }));
    svg.append(el('line', { x1: L, x2: W - R, y1: sy(v), y2: sy(v), stroke: css('--border') }));
    svg.append(el('text', { x: sx(v), y: H - B + 16, 'text-anchor': 'middle' }, fmt.format(v)));
    svg.append(el('text', { x: L - 6, y: sy(v) + 4, 'text-anchor': 'end' }, fmt.format(v)));
  }
  const top = 10 ** hi;
  svg.append(el('line', { x1: sx(10), y1: sy(10), x2: sx(top), y2: sy(top), stroke: css('--muted'), 'stroke-dasharray': '4 3' }));
  for (const p of pts) svg.append(el('circle', { cx: sx(p.modis_observed), cy: sy(p.modis_equivalent_from_snpp), r: 3.2, fill: css('--accent'), 'fill-opacity': 0.75 }));
  svg.append(el('text', { x: W - R, y: H - 2, 'text-anchor': 'end' }, 'Observed MODIS per month →'));
  svg.append(el('text', { x: L + 4, y: T + 12 }, '↑ S-NPP converted'));
}

async function main(): Promise<void> {
  const meta = await json<Metadata>('metadata.json');
  renderTopbar(document.getElementById('topbar')!, 'methodology', `Data to ${meta.time_coverage.end} · Method ${meta.method_version}`);
  renderFooter(document.getElementById('footer')!, `${meta.citation} Map imagery: NASA GIBS.`);
  renderAreaBar(document.getElementById('area-bar')!, null, null, false);
  const region = meta.regions[0]!;
  document.getElementById('build-line')!.textContent =
    `California, ${meta.time_coverage.start} to ${meta.time_coverage.end}. Data built ${meta.build_date}, method ${meta.method_version}.${meta.is_sample ? ' SAMPLE DATA: numbers are invented.' : ''}`;
  document.getElementById('citation')!.textContent = meta.citation;
  document.getElementById('method-version')!.textContent = meta.method_version;
  if (meta.validation.r2 != null) document.getElementById('v-r2')!.textContent = meta.validation.r2.toFixed(3);
  if (meta.validation.median_abs_pct_error != null) document.getElementById('v-err')!.textContent = `${meta.validation.median_abs_pct_error}%`;
  const [monthly, check] = await Promise.all([
    json<Monthly>(`regions/${region}/monthly.json`),
    json<Check>(`regions/${region}/harmonization_check.json`).catch(() => null),
  ]);
  yearsChart(document.getElementById('chart-years') as unknown as SVGSVGElement, monthly);
  if (check) overlapChart(document.getElementById('chart-overlap') as unknown as SVGSVGElement, check);
  else document.getElementById('chart-overlap')!.closest('figure')!.remove();
}

main().catch((e: unknown) => {
  const p = document.createElement('p');
  p.className = 'field-error';
  p.textContent = e instanceof Error ? e.message : 'Could not load the data for the charts.';
  document.getElementById('main')!.prepend(p);
});
