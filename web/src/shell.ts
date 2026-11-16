// The parts every page shares, in Yashneil's Califire style: top bar with the page menu, footer,
// and the selection (dates, drawn area, colour mode) carried between pages in the web address.
// His "Latest" pages (public/latest/) are his own static files with their own copy of this menu.

import type { BBox } from './data/types';
import type { AppState, ColorMode } from './state';

export const PAGES: { id: string; href: string; label: string; carriesSelection: boolean }[] = [
  { id: 'overview', href: 'index.html', label: 'Overview', carriesSelection: true },
  { id: 'archive', href: 'archive.html', label: 'Archive', carriesSelection: true },
  { id: 'map', href: 'map.html', label: 'Map', carriesSelection: true },
  { id: 'compare', href: 'compare.html', label: 'Compare', carriesSelection: true },
  { id: 'latest', href: 'latest/index.html', label: 'Latest', carriesSelection: false },
  { id: 'download', href: 'download.html', label: 'Download', carriesSelection: true },
  { id: 'methodology', href: 'methodology.html', label: 'Methodology', carriesSelection: false },
];

const COLOR_MODES: ColorMode[] = ['absolute', 'percentile', 'anomaly'];
const isDate = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Selection read from the address (?start=YYYY-MM-DD&end=…&area=w,s,e,n&colors=…). Invalid parts are ignored. */
export function readSelection(search: string): Partial<AppState> {
  const q = new URLSearchParams(search);
  const out: Partial<AppState> = {};
  const start = q.get('start');
  const end = q.get('end');
  if (isDate(start) && isDate(end) && start <= end) {
    out.startDate = start;
    out.endDate = end;
  }
  const area = q.get('area')?.split(',').map(Number);
  if (area && area.length === 4 && area.every(Number.isFinite) && area[0]! < area[2]! && area[1]! < area[3]!) out.drawnBox = area as BBox;
  const colors = q.get('colors') as ColorMode | null;
  if (colors && COLOR_MODES.includes(colors)) out.colorMode = colors;
  return out;
}

/** The address query for a selection. Defaults (whole range, no area, count colours) are left out. */
export function selectionQuery(s: Pick<AppState, 'startDate' | 'endDate' | 'drawnBox' | 'colorMode'>, coverage: { start: string; end: string }): string {
  const q = new URLSearchParams();
  if (s.startDate && s.endDate && (s.startDate !== coverage.start || s.endDate !== coverage.end)) {
    q.set('start', s.startDate);
    q.set('end', s.endDate);
  }
  if (s.drawnBox) q.set('area', s.drawnBox.map((v) => String(Math.round(v * 1e4) / 1e4)).join(','));
  if (s.colorMode && s.colorMode !== 'absolute') q.set('colors', s.colorMode);
  const text = q.toString();
  return text ? `?${text}` : '';
}

/** Top bar with the menu. `updated` is the short data note on the right. */
export function renderTopbar(el: HTMLElement, current: string, updated: string): void {
  const inner = document.createElement('div');
  inner.className = 'wrap topbar-inner';
  const brand = document.createElement('a');
  brand.className = 'brand';
  brand.href = 'index.html';
  brand.setAttribute('aria-label', 'Califire, back to the overview');
  const word = document.createElement('span');
  word.className = 'brand-word';
  word.textContent = 'Califire';
  brand.append(word);
  const nav = document.createElement('nav');
  nav.className = 'topnav';
  nav.setAttribute('aria-label', 'Pages');
  for (const p of PAGES) {
    const a = document.createElement('a');
    a.href = p.href;
    a.textContent = p.label;
    a.dataset.page = p.id;
    if (p.id === current) a.setAttribute('aria-current', 'page');
    nav.append(a);
  }
  const up = document.createElement('span');
  up.className = 'updated num';
  up.textContent = updated;
  inner.append(brand, nav, up);
  el.replaceChildren(inner);
}

/** Keep the selection in the address and in the menu links, so moving between pages keeps it. */
export function syncSelectionLinks(query: string): void {
  try {
    history.replaceState(null, '', `${location.pathname}${query}${location.hash}`);
  } catch {
    /* some embedded viewers forbid it; the links below still work */
  }
  const ours = new Set(PAGES.filter((p) => p.carriesSelection).map((p) => p.href));
  document.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
    const raw = a.getAttribute('href') ?? '';
    const path = raw.split('?')[0]!.split('#')[0]!;
    if (ours.has(path)) a.setAttribute('href', path + query);
  });
}

export function renderFooter(el: HTMLElement, citation: string): void {
  const left = document.createElement('div');
  left.textContent = `Source: NASA FIRMS, MODIS and VIIRS products. ${citation}`;
  const right = document.createElement('div');
  right.className = 'footer-right';
  right.append('Califire · Built by Yashneil Gajjala & Shrihan Chada');
  right.append(document.createElement('br'));
  const a = document.createElement('a');
  a.href = 'methodology.html';
  a.textContent = 'Methodology & sources';
  right.append(a);
  el.replaceChildren(left, right);
}
