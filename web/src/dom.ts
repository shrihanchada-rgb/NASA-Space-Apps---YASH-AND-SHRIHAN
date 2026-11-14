// Tiny helper to build DOM elements without innerHTML (text is always set safely).

type Child = Node | string | null | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const { class: className, ...rest } = props;
  if (className) el.className = className;
  Object.assign(el, rest);
  for (const c of children) if (c) el.append(c);
  return el;
}

const int = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** Format a count. null means "no data" and is never shown as 0. */
export function formatCount(value: number | null): string {
  return value == null ? 'No data' : int.format(value);
}
