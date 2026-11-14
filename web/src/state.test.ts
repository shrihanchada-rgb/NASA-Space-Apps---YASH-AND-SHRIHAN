import { describe, expect, it, vi } from 'vitest';
import { createStore } from './state';

describe('createStore', () => {
  it('notifies subscribers with the new and previous state', () => {
    const store = createStore({ a: 1, b: 'x' });
    const fn = vi.fn();
    store.subscribe(fn);
    store.set({ a: 2 });
    expect(fn).toHaveBeenCalledWith({ a: 2, b: 'x' }, { a: 1, b: 'x' });
  });

  it('does not notify when nothing changed', () => {
    const store = createStore({ a: 1 });
    const fn = vi.fn();
    store.subscribe(fn);
    store.set({ a: 1 });
    expect(fn).not.toHaveBeenCalled();
  });

  it('stops notifying after unsubscribe', () => {
    const store = createStore({ a: 1 });
    const fn = vi.fn();
    store.subscribe(fn)();
    store.set({ a: 2 });
    expect(fn).not.toHaveBeenCalled();
  });
});
