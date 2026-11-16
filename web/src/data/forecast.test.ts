import { afterEach, expect, it, vi } from 'vitest';
import { loadForecast } from './loader';

afterEach(() => vi.unstubAllGlobals());
function payload(region: string) {
  return { kind: 'experimental_forecast', region_id: region, origin_date: '2026-08-31',
    generated_utc: '2026-11-16T04:00:00Z', model: 'mistralai/Timestral-5M',
    predictions: Array.from({ length: 7 }, (_, i) => ({ date: `2026-09-0${i + 1}`, q10: 1, median: 2, q90: 3 })) };
}
function serve(value: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(value))));
}
it('loads the seven-day forecast from this site', async () => {
  const f = payload('FC-GOOD'); serve(f);
  expect(await loadForecast('FC-GOOD')).toEqual(f);
});
it('withholds an empty forecast instead of breaking the calendar', async () => {
  const f = payload('FC-EMPTY'); f.predictions = []; serve(f);
  expect(await loadForecast('FC-EMPTY')).toBeNull();
});
it('withholds a forecast for another region', async () => {
  serve(payload('OTHER'));
  expect(await loadForecast('FC-WRONG')).toBeNull();
});
it('withholds dates that overlap the observed archive', async () => {
  const f = payload('FC-DATES'); f.predictions[0]!.date = f.origin_date; serve(f);
  expect(await loadForecast('FC-DATES')).toBeNull();
});
