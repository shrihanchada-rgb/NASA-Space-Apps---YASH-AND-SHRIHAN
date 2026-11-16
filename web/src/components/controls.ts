// Region search + dropdown, quick date presets, and the custom date range.

import type { AppContext } from '../context';
import { datePresets } from '../data/derive';
import { clampBox, snapBox } from '../data/selection';
import type { BBox } from '../data/types';
import { h } from '../dom';

export function mountControls(el: HTMLElement, ctx: AppContext): void {
  const { metadata, regions, state, loaded } = ctx;
  const { start, end } = metadata.time_coverage;

  // --- region: search filters the dropdown ---
  const search = h('input', { id: 'region-search', type: 'search', placeholder: 'Type to filter regions', autocomplete: 'off' });
  const region = h('select', { id: 'region-select' });
  const noMatch = h('p', { class: 'note', hidden: true }, 'No region matches.');

  function fillRegions(): void {
    const q = search.value.trim().toLowerCase();
    const matches = regions.features.filter(({ properties: p }) =>
      `${p.name} ${p.country} ${p.region_id}`.toLowerCase().includes(q),
    );
    region.replaceChildren(...matches.map((f) => h('option', { value: f.properties.region_id }, f.properties.name)));
    noMatch.hidden = matches.length > 0;
    region.disabled = matches.length === 0;
    const current = state.get().regionId;
    if (matches.some((f) => f.properties.region_id === current)) region.value = current ?? '';
    else if (matches[0] && q) state.set({ regionId: matches[0].properties.region_id, drawnBox: null });
  }
  search.addEventListener('input', fillRegions);
  region.addEventListener('change', () => state.set({ regionId: region.value, drawnBox: null }));

  // --- dates ---
  const from = h('input', { id: 'date-start', type: 'date', min: start, max: end });
  const to = h('input', { id: 'date-end', type: 'date', min: start, max: end });
  const error = h('p', { class: 'field-error', hidden: true });
  error.setAttribute('role', 'alert');

  const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z'));
  function onDates(): void {
    if (!from.value || !to.value) return;
    if (!isDate(from.value) || !isDate(to.value)) {
      error.textContent = 'Enter full dates (year, month and day).';
      error.hidden = false;
      return;
    }
    if (from.value > to.value) {
      error.textContent = 'The start date must be on or before the end date.';
      error.hidden = false;
      return;
    }
    if (to.value < start || from.value > end) {
      error.textContent = `There is no data for these dates. The data covers ${start} to ${end}.`;
      error.hidden = false;
      return;
    }
    // Dates partly outside the data are moved to its edges (no requests for files that cannot exist).
    const s = from.value < start ? start : from.value;
    const e = to.value > end ? end : to.value;
    if (s !== from.value || e !== to.value) {
      error.textContent = `Moved to the dates with data: ${s} to ${e}.`;
      error.hidden = false;
    } else error.hidden = true;
    state.set({ startDate: s, endDate: e });
    from.value = s;
    to.value = e;
  }
  from.addEventListener('change', onDates);
  to.addEventListener('change', onDates);

  // --- presets (the fire season preset depends on the region, so rebuilt when data loads) ---
  const presetBox = h('div', { class: 'presets', role: 'group' });
  presetBox.setAttribute('aria-label', 'Quick date ranges');

  function renderPresets(): void {
    const { startDate, endDate } = state.get();
    const presets = datePresets(metadata.time_coverage, loaded.get().regionData?.baseline ?? null);
    presetBox.replaceChildren(
      ...presets.map((p) => {
        const active = p.start === startDate && p.end === endDate;
        const b = h('button', { type: 'button', class: 'chip', textContent: p.label });
        b.dataset.preset = p.id;
        b.setAttribute('aria-pressed', String(active));
        b.addEventListener('click', () => {
          error.hidden = true;
          state.set({ startDate: p.start, endDate: p.end });
        });
        return b;
      }),
    );
  }

  function syncInputs(): void {
    const s = state.get();
    from.value = s.startDate ?? start;
    to.value = s.endDate ?? end;
    renderPresets();
  }
  state.subscribe(syncInputs);
  loaded.subscribe(renderPresets);

  // --- an area by coordinates: the keyboard alternative to drawing on the map ---
  const num = (id: string, label: string, ph: string) => {
    const input = h('input', { id, type: 'number', step: '0.25', placeholder: ph, inputMode: 'decimal' });
    return { input, wrap: h('div', {}, h('label', { htmlFor: id }, label), input) };
  };
  const w = num('area-w', 'West', '-122.5'), s = num('area-s', 'South', '37.0'), e = num('area-e', 'East', '-121.0'), n = num('area-n', 'North', '38.5');
  const areaError = h('p', { class: 'field-error', hidden: true });
  areaError.setAttribute('role', 'alert');
  const regionBounds = (): BBox | null => regions.features.find((f) => f.properties.region_id === state.get().regionId)?.properties.bbox ?? null;
  const apply = h('button', { type: 'button', class: 'chip' }, 'Use this area');
  const clearArea = h('button', { type: 'button', class: 'chip' }, 'Whole region');
  apply.addEventListener('click', () => {
    const v = [w, s, e, n].map((x) => Number(x.input.value));
    if ([w, s, e, n].some((x) => x.input.value.trim() === '') || v.some((x) => !Number.isFinite(x))) {
      areaError.textContent = 'Enter all four numbers (degrees; west and east are negative in California).';
      areaError.hidden = false;
      return;
    }
    const [W, S, E, N] = v as [number, number, number, number];
    if (W >= E || S >= N || S < -90 || N > 90 || W < -180 || E > 180) {
      areaError.textContent = 'West must be less than east, and south less than north.';
      areaError.hidden = false;
      return;
    }
    const bounds = regionBounds();
    const inside = bounds ? clampBox([W, S, E, N], bounds) : ([W, S, E, N] as BBox);
    if (!inside) {
      areaError.textContent = 'That area is outside California. Enter coordinates inside the outline.';
      areaError.hidden = false;
      return;
    }
    areaError.hidden = true;
    state.set({ drawnBox: snapBox(inside), drawing: false });
  });
  clearArea.addEventListener('click', () => state.set({ drawnBox: null }));
  const areaBox = h('details', { class: 'area-form' },
    h('summary', {}, 'Enter an area by coordinates'),
    h('div', { class: 'area-grid' }, w.wrap, e.wrap, s.wrap, n.wrap),
    areaError,
    h('div', { class: 'presets' }, apply, clearArea),
    h('p', { class: 'note field-help' }, 'The area snaps outward to the 0.25° data grid (about 25 km), like a drawn area.'));
  function syncArea(): void {
    const b = state.get().drawnBox;
    if (b) [w, s, e, n].forEach((x, i) => { x.input.value = String(b[i]); });
    clearArea.setAttribute('aria-pressed', String(!b));
  }
  state.subscribe((st, prev) => { if (st.drawnBox !== prev.drawnBox) syncArea(); });

  el.replaceChildren(
    h('h2', {}, 'Selection'),
    h('label', { htmlFor: 'region-search' }, 'Find a region'),
    search,
    h('label', { htmlFor: 'region-select' }, 'Region'),
    region,
    noMatch,
    h('p', { class: 'note field-help' }, 'Shows the whole region. Draw an area on the map to narrow everything to that area.'),
    areaBox,
    h('h3', {}, 'Dates'),
    presetBox,
    h('div', { class: 'date-row' },
      h('div', {}, h('label', { htmlFor: 'date-start' }, 'From'), from),
      h('div', {}, h('label', { htmlFor: 'date-end' }, 'To'), to),
    ),
    error,
    h('p', { class: 'note field-help' }, `Data covers ${start} to ${end}.`),
  );
  fillRegions();
  syncInputs();
  syncArea();
}
