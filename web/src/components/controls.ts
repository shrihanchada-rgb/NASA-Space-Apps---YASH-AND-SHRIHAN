// Region and date range selection. Step S20 adds: search, draw-on-map, date presets.

import type { AppContext } from '../context';
import { h } from '../dom';

export function mountControls(el: HTMLElement, ctx: AppContext): void {
  const { metadata, regions, state } = ctx;
  const { start, end } = metadata.time_coverage;

  const region = h('select', { id: 'region-select' });
  for (const f of regions.features) {
    region.append(h('option', { value: f.properties.region_id }, f.properties.name));
  }
  region.value = state.get().regionId ?? '';
  region.addEventListener('change', () => state.set({ regionId: region.value }));

  const from = h('input', { id: 'date-start', type: 'date', min: start, max: end, value: state.get().startDate ?? start });
  const to = h('input', { id: 'date-end', type: 'date', min: start, max: end, value: state.get().endDate ?? end });
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

  el.replaceChildren(
    h('h2', {}, 'Selection'),
    h('label', { htmlFor: 'region-select' }, 'Region'),
    region,
    h('label', { htmlFor: 'date-start' }, 'From'),
    from,
    h('label', { htmlFor: 'date-end' }, 'To'),
    to,
    error,
    h('p', { class: 'note' }, `Data covers ${start} to ${end}.`),
  );
}
