// S23: CSV downloads of the current selection (whole region or drawn area) and date range.
//   - Hotspots: every detection, with harmonized_weight (columns of README 3.1.8 / contract section 7)
//   - Monthly series and the calendar table
// Every file starts with # lines: what, where, dates, method, build date, citation.

import type { AppContext } from '../context';
import { calendarCsv, estimateRows, fileName, hotspotsCsv, monthlyCsv, ROW_CAP } from '../data/export';
import { loadHotspots } from '../data/loader';
import { filterHotspots, monthsInRange } from '../data/selection';
import { formatCount, h } from '../dom';
import { icon } from '../icons';

function save(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function mountDownloads(el: HTMLElement, ctx: AppContext): void {
  const body = h('div', { class: 'downloads' });
  const status = h('p', { class: 'note', role: 'status' });
  el.replaceChildren(h('div', { class: 'panel-head' }, h('h2', {}, 'Downloads')), body, status);

  function button(label: string, hint: string, run: () => Promise<void> | void): HTMLElement {
    const b = h('button', { type: 'button', class: 'dl-button' }, icon('download'), h('span', {}, h('strong', {}, label), h('span', { class: 'note' }, hint)));
    b.addEventListener('click', async () => {
      b.disabled = true;
      status.textContent = `Preparing ${label}…`;
      try {
        await run();
        status.textContent = `${label}: download started.`;
      } catch (err) {
        status.textContent = err instanceof Error ? err.message : 'The download failed.';
      } finally {
        b.disabled = false;
      }
    });
    return b;
  }

  async function hotspotRows(start: string, end: string) {
    const sel = ctx.loaded.get().selection!;
    const files = [];
    for (let y = Number(start.slice(0, 4)); y <= Number(end.slice(0, 4)); y++) files.push(loadHotspots(sel.regionId, y));
    return filterHotspots((await Promise.all(files)).flat(), sel, start, end);
  }

  function render(): void {
    const sel = ctx.loaded.get().selection;
    const { startDate, endDate } = ctx.state.get();
    if (!sel || !startDate || !endDate) {
      body.replaceChildren(h('p', { class: 'note' }, ctx.loaded.get().selectionError ?? 'Loading…'));
      return;
    }
    const meta = ctx.metadata;
    const months = monthsInRange(sel.months, startDate, endDate);
    const est = estimateRows(months);
    const where = sel.kind === 'area' ? 'the drawn area' : sel.label;
    const items: HTMLElement[] = [
      h('p', { class: 'note' }, `For ${where}, ${startDate} to ${endDate}. Files start with # lines giving the selection, method and citation.`),
    ];
    if (est <= ROW_CAP) {
      items.push(button('Hotspots CSV', `about ${formatCount(est)} detections, with harmonized weights`, async () => {
        const rows = await hotspotRows(startDate, endDate);
        save(fileName('hotspots', sel, startDate, endDate), hotspotsCsv(meta, sel, startDate, endDate, rows));
      }));
    } else {
      const years: number[] = [];
      for (let y = Number(startDate.slice(0, 4)); y <= Number(endDate.slice(0, 4)); y++) years.push(y);
      items.push(h('p', { class: 'note' }, `About ${formatCount(est)} detections: too many for one file. Download one file per year:`));
      items.push(h('div', { class: 'dl-years' }, ...years.map((y) => {
        const s = `${y}-01-01` < startDate ? startDate : `${y}-01-01`;
        const e = `${y}-12-31` > endDate ? endDate : `${y}-12-31`;
        const b = h('button', { type: 'button', class: 'chip' }, icon('download'), String(y));
        b.addEventListener('click', async () => {
          b.disabled = true;
          status.textContent = `Preparing hotspots ${y}…`;
          try {
            save(fileName('hotspots', sel, s, e), hotspotsCsv(meta, sel, s, e, await hotspotRows(s, e)));
            status.textContent = `Hotspots ${y}: download started.`;
          } catch (err) {
            status.textContent = err instanceof Error ? err.message : 'The download failed.';
          } finally {
            b.disabled = false;
          }
        });
        return b;
      })));
    }
    items.push(button('Monthly series CSV', `${months.length} months: harmonized count, range, raw counts`, () =>
      save(fileName('monthly', sel, startDate, endDate), monthlyCsv(meta, sel, startDate, endDate, months))));
    items.push(button('Calendar CSV', 'years × months table, as in the calendar', () =>
      save(fileName('calendar', sel, startDate, endDate), calendarCsv(meta, sel, startDate, endDate, months))));
    body.replaceChildren(...items);
  }

  ctx.loaded.subscribe(render);
  ctx.state.subscribe((s, p) => { if (s.startDate !== p.startDate || s.endDate !== p.endDate) render(); });
  render();
}
