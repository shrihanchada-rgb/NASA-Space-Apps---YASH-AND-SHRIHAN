// Region search + dropdown, quick date presets, and the custom date range.

import type { AppContext } from '../context';
import { datePresets } from '../data/derive';
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

  function onDates(): void {
    if (!from.value || !to.value) return;
    if (from.value > to.value) {
      error.textContent = 'The start date must be on or before the end date.';
      error.hidden = false;
      return;
    }
    error.hidden = true;
    state.set({ startDate: from.value, endDate: to.value });
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

  el.replaceChildren(
    h('h2', {}, 'Selection'),
    h('label', { htmlFor: 'region-search' }, 'Find a region'),
    search,
    h('label', { htmlFor: 'region-select' }, 'Region'),
    region,
    noMatch,
    h('p', { class: 'note' }, 'Or click a region on the map, or draw an area.'),
    h('h3', {}, 'Dates'),
    presetBox,
    h('div', { class: 'date-row' },
      h('div', {}, h('label', { htmlFor: 'date-start' }, 'From'), from),
      h('div', {}, h('label', { htmlFor: 'date-end' }, 'To'), to),
    ),
    error,
    h('p', { class: 'note' }, `Data covers ${start} to ${end}.`),
  );
  fillRegions();
  syncInputs();
}
