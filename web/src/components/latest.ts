// Latest (home page): Yashneil's day-by-day calendar (yashneil75/califire, MIT): title, stats line,
// month grid, month totals, strongest days, day details and forecast cells. Same structure and look,
// our numbers: the harmonized daily count (MODIS-equivalent hotspots) and our forecast file.
// Whole California by default; a drawn area (Map page) narrows every number to that area.

import type { AppContext } from '../context';
import { MONTH_NAMES } from '../data/derive';
import {
  areaDays, biggestDay, type DayValue, daysOfMonth, dayNight, daysWithData, LEGEND_STOPS, percentileInCalendarMonth,
  rampColor, rampPosition, regionDays, strongestDays, strongestInMonth, trailing12,
} from '../data/latest';
import { loadForecast, loadHotspotMonth } from '../data/loader';
import type { Forecast } from '../data/types';
import { formatCount, h } from '../dom';

const fmt = (n: number, digits = 1) => n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const longDate = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const shortDate = (d: string, year = true) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' });
const monthTitle = (m: string) => `${new Date(m + '-01T00:00:00Z').toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' })} ${m.slice(0, 4)}`;
const addMonths = (m: string, n: number) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1)).toISOString().slice(0, 7);

/** Which satellites feed a day's count (matches the harmonization rules, docs/validation/README.md). */
function eraOf(date: string, viirsEnd: string | null): string {
  if (date < '2002-07-04') return 'MODIS Terra only (scaled to Terra + Aqua)';
  if (date < '2012-01-20') return 'MODIS Terra + Aqua';
  if (viirsEnd && date > viirsEnd) return `MODIS only (the VIIRS archive ends ${viirsEnd})`;
  return 'MODIS and S-NPP VIIRS, harmonized';
}

export function mountLatest(el: HTMLElement, ctx: AppContext): void {
  el.classList.add('lt');
  let month: string | null = null; // YYYY-MM shown
  let forecast: Forecast | null = null;
  let token = 0;

  // ----- static structure (his layout) -----
  const title = h('h1', { class: 'splash-title' });
  const scope = h('p', { class: 'lt-scope-note' });
  const stat = (label: string) => {
    const dd = h('dd', { class: 'num' });
    const small = h('small');
    return { item: h('div', { class: 'sl-item' }, h('dt', {}, label), dd), dd, small };
  };
  const s1 = stat(''), s2 = stat(''), s3 = stat('');
  const statline = h('div', { class: 'wrap statline', role: 'region' }, h('dl', { class: 'statline-inner' }, s1.item, s2.item, s3.item));
  statline.setAttribute('aria-label', 'Key figures');

  const jump = h('input', { type: 'date', id: 'dateJump' });
  const prev = h('button', { type: 'button', textContent: '‹' });
  prev.setAttribute('aria-label', 'Previous month');
  const next = h('button', { type: 'button', textContent: '›' });
  next.setAttribute('aria-label', 'Next month');
  const monthLabel = h('div', { class: 'month-label num' });
  const grid = h('div', { class: 'lt-grid' });
  const legendRamp = h('span', { class: 'lt-legend-ramp' }, ...LEGEND_STOPS.map((c) => { const s = h('span'); s.style.background = c; return s; }));
  legendRamp.setAttribute('aria-hidden', 'true');
  const forecastNote = h('p', { class: 'forecast-note', hidden: true });
  const monthTotal = h('dd', { class: 'num' }), monthDays = h('dd', { class: 'num' }), monthPeak = h('dd', { class: 'num' });
  const strongLabel = h('div', { class: 'side-label' });
  const strongList = h('ul', { class: 'peak-list' });
  const epoch = h('p', { class: 'epoch-note' });

  const season = h('section', { class: 'wrap', id: 'season' },
    h('div', { class: 'lt-panel season' },
      h('div', { class: 'season-main' },
        h('div', { class: 'lt-panel-head' },
          h('div', {}, h('h2', { class: 'lt-panel-title', textContent: 'The month' }), h('p', { class: 'lt-panel-sub', textContent: 'Click any day for the breakdown.' })),
          h('div', { class: 'season-controls' },
            h('label', { class: 'date-jump', htmlFor: 'dateJump' }, h('span', { class: 'date-jump-label', textContent: 'Jump to a date' }), jump),
            h('div', { class: 'month-nav' }, prev, monthLabel, next))),
        h('div', { class: 'lt-weekdays', 'aria-hidden': 'true' } as Partial<HTMLDivElement>, ...['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => h('span', { textContent: d }))),
        grid,
        h('div', { class: 'lt-legend' }, h('span', { textContent: 'Less' }), legendRamp, h('span', { textContent: 'More' }),
          h('span', { textContent: 'Hatched = no satellite data · Dashed = outside the record' })),
        forecastNote),
      h('aside', { class: 'season-side' },
        h('div', {}, h('div', { class: 'side-label', textContent: 'Month totals' }),
          h('dl', { class: 'lt-kv' }, h('dt', { textContent: 'Hotspots (harmonized)' }), monthTotal, h('dt', { textContent: 'Days with data' }), monthDays, h('dt', { textContent: 'Biggest day' }), monthPeak)),
        h('div', {}, strongLabel, strongList),
        epoch)));

  // day drawer and forecast drawer (his dialogs)
  const backdrop = h('div', { class: 'drawer-backdrop' });
  const dDate = h('h2', { class: 'drawer-date' }), dStatus = h('div', { class: 'drawer-status' });
  const dBig = h('span', { class: 'n num' });
  const dDay = h('span', { class: 'dn-val num' }), dNight = h('span', { class: 'dn-val num' });
  const fillD = h('div', { class: 'dn-fill' }), fillN = h('div', { class: 'dn-fill' });
  const metaD = h('span'), metaN = h('span');
  const dFrp = h('dd', { class: 'num' }), dRaw = h('dd', { class: 'num' });
  const dVs = h('div', { class: 'vs-month' });
  const dClose = h('button', { type: 'button', class: 'drawer-close', textContent: '×' });
  dClose.setAttribute('aria-label', 'Close');
  const dnRow = (label: string, period: 'D' | 'N', fill: HTMLElement, val: HTMLElement) => {
    const r = h('div', { class: 'dn-row' }, h('span', { textContent: label }), h('div', { class: 'dn-track' }, fill), val);
    r.dataset.period = period;
    return r;
  };
  const metaRow = (period: 'D' | 'N', meta: HTMLElement) => {
    const r = h('div', { class: 'dn-row' }, h('span'), meta, h('span'));
    r.dataset.period = period;
    r.style.fontSize = '11px';
    r.style.color = 'var(--ink-2)';
    return r;
  };
  const drawer = h('aside', { class: 'drawer', role: 'dialog' },
    h('div', { class: 'drawer-head' }, h('div', {}, dDate, dStatus), dClose),
    h('div', { class: 'drawer-body' },
      h('div', { class: 'drawer-big' }, dBig, h('span', { class: 'u' }, 'hotspots, MODIS-equivalent · ', h('a', { class: 'textlink', href: 'methodology.html', textContent: 'what this is' }))),
      h('div', { class: 'dn-split' }, dnRow('Day', 'D', fillD, dDay), dnRow('Night', 'N', fillN, dNight), metaRow('D', metaD), metaRow('N', metaN)),
      h('dl', { class: 'lt-kv' }, h('dt', { textContent: 'Fire radiative power' }), dFrp, h('dt', { textContent: 'Raw detections, MODIS · VIIRS' }), dRaw),
      dVs));
  drawer.setAttribute('aria-modal', 'true');
  drawer.setAttribute('aria-hidden', 'true');

  const fBackdrop = h('div', { class: 'drawer-backdrop' });
  const fDate = h('h2', { class: 'drawer-date' }), fMedian = h('span', { class: 'n num' }), fRange = h('span'), fMeta = h('p', { class: 'forecast-meta' });
  const fClose = h('button', { type: 'button', class: 'drawer-close', textContent: '×' });
  fClose.setAttribute('aria-label', 'Close forecast');
  const fDrawer = h('aside', { class: 'drawer', role: 'dialog' },
    h('div', { class: 'drawer-head' }, h('div', {}, fDate, h('div', { class: 'drawer-status', textContent: 'Experimental forecast · not observed' })), fClose),
    h('div', { class: 'drawer-body' },
      h('div', { class: 'drawer-big' }, fMedian, h('span', { class: 'u', textContent: 'forecast median, harmonized hotspots' })),
      h('p', {}, h('strong', { textContent: 'Model range (10th–90th percentile):' }), h('br'), fRange),
      h('p', { class: 'forecast-disclaimer', textContent: 'This estimates satellite-detected activity, not wildfire ignition, spread, risk, or emergency conditions.' }),
      fMeta,
      h('p', {}, h('a', { class: 'textlink', href: 'methodology.html#m-forecast', textContent: 'How the forecast was tested →' }))));
  fDrawer.setAttribute('aria-modal', 'true');
  fDrawer.setAttribute('aria-hidden', 'true');

  el.replaceChildren(h('header', { class: 'wrap splash' }, title, scope), statline, season, backdrop, drawer, fBackdrop, fDrawer);

  // ----- dialogs -----
  let lastFocus: HTMLElement | null = null;
  const open = (d: HTMLElement, b: HTMLElement, focus: HTMLElement) => {
    lastFocus = document.activeElement as HTMLElement | null;
    d.classList.add('open'); b.classList.add('open'); d.setAttribute('aria-hidden', 'false'); focus.focus();
  };
  const close = () => {
    for (const d of [drawer, fDrawer]) { d.classList.remove('open'); d.setAttribute('aria-hidden', 'true'); }
    backdrop.classList.remove('open'); fBackdrop.classList.remove('open');
    lastFocus?.focus();
  };
  for (const x of [dClose, fClose, backdrop, fBackdrop]) x.addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  // ----- data for the shown month -----
  async function monthValues(m: string): Promise<{ days: Map<string, DayValue | null>; points: () => Promise<import('../data/types').Hotspot[]> }> {
    const rd = ctx.loaded.get().regionData!;
    const box = ctx.state.get().drawnBox;
    const regionId = ctx.state.get().regionId!;
    if (!box) return { days: regionDays(rd.daily, m), points: () => loadHotspotMonth(regionId, m) };
    const pts = await loadHotspotMonth(regionId, m);
    return { days: areaDays(rd.daily, m, pts, box), points: async () => pts };
  }

  async function openDay(date: string, v: DayValue, getPoints: () => Promise<import('../data/types').Hotspot[]>): Promise<void> {
    const rd = ctx.loaded.get().regionData!;
    const box = ctx.state.get().drawnBox;
    dDate.textContent = longDate(date);
    const viirsEnd = ctx.metadata.sources.filter((x) => x.source.startsWith('VIIRS')).map((x) => x.last_date).sort().at(-1) ?? null;
    dStatus.textContent = `${eraOf(date, viirsEnd)}${box ? ' · drawn area' : ''}`;
    dBig.textContent = fmt(v.count);
    dFrp.textContent = `${fmt(v.frp, 0)} MW`;
    dRaw.textContent = `${formatCount(v.rawModis)} · ${formatCount(v.rawViirs)}`;
    dDay.textContent = '…'; dNight.textContent = '…'; metaD.textContent = ''; metaN.textContent = '';
    fillD.style.width = '0%'; fillN.style.width = '0%';
    if (box) dVs.textContent = 'Rankings against other years are for all of California only (they need every day of the record).';
    else {
      const pct = percentileInCalendarMonth(rd.daily, date);
      const mName = new Date(date + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
      dVs.textContent = pct == null ? 'Not enough comparable days to rank.'
        : pct >= 100 ? `The busiest ${mName} day since 2000.` : `More active than ${pct}% of ${mName} days with data since 2000.`;
    }
    open(drawer, backdrop, dClose);
    try {
      const dn = dayNight(await getPoints(), date, box);
      const max = Math.max(dn.day, dn.night, 0.5);
      fillD.style.width = `${(dn.day / max) * 100}%`;
      fillN.style.width = `${(dn.night / max) * 100}%`;
      dDay.textContent = fmt(dn.day); dNight.textContent = fmt(dn.night);
      metaD.textContent = `${formatCount(dn.dayRows)} detection${dn.dayRows === 1 ? '' : 's'}`;
      metaN.textContent = `${formatCount(dn.nightRows)} detection${dn.nightRows === 1 ? '' : 's'}`;
    } catch {
      dDay.textContent = '–'; dNight.textContent = '–'; metaD.textContent = 'Could not load the detections.';
    }
  }

  function openForecast(date: string): void {
    const f = forecast?.predictions.find((p) => p.date === date);
    if (!f || !forecast) return;
    fDate.textContent = longDate(date);
    fMedian.textContent = fmt(f.median);
    fRange.textContent = `${fmt(f.q10)}–${fmt(f.q90)} harmonized hotspots`;
    fMeta.textContent = `Made from data up to ${forecast.origin_date} · ${forecast.model} · generated ${forecast.generated_utc.slice(0, 10)}`;
    open(fDrawer, fBackdrop, fClose);
  }

  // ----- rendering -----
  async function renderMonth(): Promise<void> {
    const mine = ++token;
    const rd = ctx.loaded.get().regionData;
    if (!rd || !month) return;
    const box = ctx.state.get().drawnBox;
    monthLabel.textContent = monthTitle(month);
    grid.replaceChildren(h('p', { class: 'forecast-off', textContent: 'Loading…' }));
    let values: Awaited<ReturnType<typeof monthValues>>;
    try {
      values = await monthValues(month);
    } catch (err) {
      if (mine === token) grid.replaceChildren(h('p', { class: 'field-error', textContent: err instanceof Error ? err.message : 'Could not load this month.' }));
      return;
    }
    if (mine !== token) return;
    const { days } = values;
    const max = biggestDay(rd.daily)?.count ?? 100;
    const preds = new Map((!box && forecast ? forecast.predictions : []).map((p) => [p.date, p]));
    const first = new Date(month + '-01T00:00:00Z');
    const cells: HTMLElement[] = [];
    for (let i = 0; i < (first.getUTCDay() + 6) % 7; i++) cells.push(h('div', { class: 'day-cell absent', 'aria-hidden': 'true' } as Partial<HTMLDivElement>));
    for (const date of daysOfMonth(month)) {
      const d = Number(date.slice(8));
      const v = days.get(date);
      const pred = preds.get(date);
      const cell = h('button', { type: 'button', class: 'day-cell' });
      cell.dataset.date = date;
      if (v) {
        const t = rampPosition(v.count, max);
        cell.style.background = v.count > 0 ? rampColor(t) : 'var(--paper)';
        if (t > 0.62) cell.style.color = '#f6efe0';
        cell.append(h('span', { class: 'dow', textContent: String(d) }), h('span', { class: 'act num', textContent: fmt(v.count) }), h('span', { class: 'frp num', textContent: `${fmt(v.frp, 0)} MW` }));
        cell.setAttribute('aria-label', `${date}: ${fmt(v.count)} harmonized hotspots, ${fmt(v.frp, 0)} megawatts`);
        cell.addEventListener('click', () => void openDay(date, v, values.points));
      } else if (pred) {
        cell.classList.add('forecast-cell');
        cell.append(h('span', { class: 'dow', textContent: String(d) }), h('span', { class: 'act num', textContent: fmt(pred.median) }), h('span', { class: 'forecast-label', textContent: 'FORECAST' }));
        cell.setAttribute('aria-label', `${date}: experimental forecast ${fmt(pred.median)} hotspots; not fire risk`);
        cell.addEventListener('click', () => openForecast(date));
      } else if (v === null) {
        cell.classList.add('is-outage');
        cell.disabled = true;
        cell.append(h('span', { class: 'dow', textContent: String(d) }), h('span', { class: 'act', textContent: '·' }));
        cell.setAttribute('aria-label', `${date}: no satellite data (not zero fires)`);
      } else {
        cell.classList.add('absent');
        cell.disabled = true;
        cell.append(h('span', { class: 'dow', textContent: String(d) }), h('span', { class: 'act', textContent: '·' }));
        cell.setAttribute('aria-label', `${date}: outside the record`);
      }
      cells.push(cell);
    }
    grid.replaceChildren(...cells);

    // month totals
    const known = [...days.values()].filter((v): v is DayValue => v != null);
    const peak = known.length ? [...days].filter((e): e is [string, DayValue] => e[1] != null).sort((a, b) => b[1].count - a[1].count)[0]! : null;
    monthTotal.textContent = known.length ? fmt(known.reduce((a, v) => a + v.count, 0)) : 'No data';
    monthDays.textContent = String(known.length);
    monthPeak.textContent = peak && peak[1].count > 0 ? `${shortDate(peak[0], false)} · ${fmt(peak[1].count)}` : '–';

    // strongest days: whole region over 24 months; an area over the month shown (it would need every day's points)
    const top = box ? strongestInMonth(days) : strongestDays(rd.daily);
    strongLabel.textContent = box ? `Strongest days in ${monthTitle(month)}, this area` : 'Strongest days, trailing 24 months';
    const tmax = top[0]?.count ?? 1;
    strongList.replaceChildren(...(top.length ? top.map((t) => {
      const bar = h('div', { class: 'peak-bar' });
      bar.style.width = `${Math.max(4, (t.count / tmax) * 100)}%`;
      return h('li', {}, h('span', { class: 'peak-date', textContent: shortDate(t.date) }), h('span', { class: 'peak-activity num', textContent: fmt(t.count) }), bar);
    }) : [h('li', { textContent: 'No hotspots this month.' })]));

    // forecast note
    const lastData = rd.daily.end;
    if (forecast && !box) {
      forecastNote.hidden = false;
      const inMonth = forecast.predictions.some((p) => p.date.startsWith(month!));
      const go = h('button', { type: 'button', class: 'link-button', textContent: inMonth ? '' : `Show the forecast (${shortDate(forecast.predictions[0]!.date, false)}–${shortDate(forecast.predictions[forecast.predictions.length - 1]!.date)})` });
      go.addEventListener('click', () => { month = forecast!.predictions[0]!.date.slice(0, 7); void renderMonth(); });
      forecastNote.replaceChildren(
        `Experimental forecast of the 7 days after our data ends (${lastData}), with Yashneil's Timestral-5M method. Detected activity, not fire risk. `,
        ...(inMonth ? [] : [go, ' ']),
        h('a', { class: 'textlink', href: 'methodology.html#m-forecast', textContent: 'Forecast method' }), '.');
    } else if (box && forecast) {
      forecastNote.hidden = false;
      forecastNote.replaceChildren('The experimental forecast is made for all of California only.');
    } else forecastNote.hidden = true;
  }

  function renderHeader(): void {
    const rd = ctx.loaded.get().regionData;
    const sel = ctx.loaded.get().selection;
    if (!rd) return;
    const box = ctx.state.get().drawnBox;
    title.innerHTML = '';
    title.append(box ? 'Your area, day by ' : 'California, day by ', h('em', { textContent: 'day' }), '.');
    scope.textContent = box
      ? `Drawn area ${box.map((v) => v.toFixed(2)).join(', ')} (W, S, E, N). Each day is the harmonized count of the hotspots inside it. Clear the area to see all of California.`
      : `Harmonized satellite hotspots (MODIS-equivalent) for all of California, ${rd.daily.start} to ${rd.daily.end}. Draw an area on the Map to see it here.`;
    const t12 = sel ? trailing12(sel.months) : null;
    s1.item.querySelector('dt')!.replaceChildren('Hotspots', h('br'), 'last 12 months of data');
    s1.dd.textContent = t12 ? fmt(t12.total, 0) : '…';
    if (box) {
      const best = sel?.months.filter((m) => m.countHarm != null).sort((a, b) => (b.countHarm ?? 0) - (a.countHarm ?? 0))[0];
      s2.item.querySelector('dt')!.textContent = 'Biggest month on record';
      s2.dd.replaceChildren(best ? fmt(best.countHarm ?? 0, 0) : '–', h('small', { textContent: best ? `${MONTH_NAMES[best.month - 1]} ${best.year}` : '' }));
    } else {
      const best = biggestDay(rd.daily);
      s2.item.querySelector('dt')!.textContent = 'Biggest day on record';
      s2.dd.replaceChildren(best ? fmt(best.count) : '–', h('small', { textContent: best ? shortDate(best.date) : '' }));
    }
    s3.item.querySelector('dt')!.textContent = 'Days with satellite data since 2000';
    s3.dd.textContent = formatCount(daysWithData(rd.daily));
    epoch.replaceChildren('Harmonized MODIS + VIIRS counts (method ', ctx.metadata.method_version, '). Days without satellite data are hatched, never zero. ',
      h('a', { class: 'textlink', href: 'methodology.html', textContent: 'Methodology' }), '.');
    jump.min = rd.daily.start;
    jump.max = forecast?.predictions.at(-1)?.date ?? rd.daily.end;
  }

  // ----- events -----
  prev.addEventListener('click', () => { if (month) { month = addMonths(month, -1); void renderMonth(); } });
  next.addEventListener('click', () => { if (month) { month = addMonths(month, 1); void renderMonth(); } });
  jump.addEventListener('change', () => { if (/^\d{4}-\d{2}-\d{2}$/.test(jump.value)) { month = jump.value.slice(0, 7); void renderMonth(); } });

  async function start(): Promise<void> {
    const rd = ctx.loaded.get().regionData;
    if (!rd) return;
    if (!forecast) forecast = await loadForecast(ctx.state.get().regionId!);
    if (!month) {
      const end = ctx.state.get().endDate ?? rd.daily.end;
      month = (end > rd.daily.end ? rd.daily.end : end).slice(0, 7);
      jump.value = rd.daily.end;
    }
    renderHeader();
    await renderMonth();
  }
  ctx.loaded.subscribe((l, p) => {
    if (l.regionData !== p.regionData) void start();
    else if (l.selection !== p.selection) { renderHeader(); void renderMonth(); }
  });
  void start();
}
