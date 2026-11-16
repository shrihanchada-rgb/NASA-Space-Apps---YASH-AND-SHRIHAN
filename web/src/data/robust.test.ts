import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStore, onStoreError } from '../state';
import { DataError, loadHotspotMonth } from './loader';

describe('store: one failing listener does not stop the others', () => {
  it('runs every listener and reports the error', () => {
    const errors: unknown[] = [];
    onStoreError((e) => errors.push(e));
    const s = createStore({ n: 0 });
    let seen = 0;
    s.subscribe(() => { throw new Error('broken panel'); });
    s.subscribe((st) => { seen = st.n; });
    s.set({ n: 5 });
    expect(seen).toBe(5);
    expect(errors).toHaveLength(1);
  });
});

describe('loader: failures give clear errors, never hang', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('a missing month file (404) means no detections', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Not found', { status: 404 })));
    expect(await loadHotspotMonth('T1', '1999-01')).toEqual([]);
  });

  it('a server error is a DataError naming the file', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('oops', { status: 500 })));
    await expect(loadHotspotMonth('T2', '1999-02')).rejects.toThrow(/hotspots\/1999-02\.csv \(HTTP 500\)/);
  });

  it('no connection is a DataError, and the failure is not cached', async () => {
    const f = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    vi.stubGlobal('fetch', f);
    await expect(loadHotspotMonth('T3', '1999-03')).rejects.toBeInstanceOf(DataError);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Not found', { status: 404 })));
    expect(await loadHotspotMonth('T3', '1999-03')).toEqual([]); // retried, not stuck on the old failure
  });

  it('a stalled download times out', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_u: string, init?: RequestInit) => new Promise((_res, rej) => {
      init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
    })));
    const p = loadHotspotMonth('T4', '1999-04');
    const check = expect(p).rejects.toThrow(/took too long/);
    await vi.advanceTimersByTimeAsync(121_000);
    await check;
    vi.useRealTimers();
  });
});
