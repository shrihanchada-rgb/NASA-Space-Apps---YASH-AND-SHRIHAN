// One floating tooltip shared by the calendar and the charts. Text only (built with h(), never innerHTML).

import { h } from '../dom';

let tip: HTMLDivElement | null = null;

function el(): HTMLDivElement {
  if (!tip) {
    tip = h('div', { class: 'tooltip', role: 'tooltip', id: 'chart-tooltip', hidden: true });
    document.body.append(tip);
  }
  return tip;
}

/** Show lines of text near a point (client coordinates). The first line is the title. */
export function showTip(x: number, y: number, title: string, lines: string[]): void {
  const t = el();
  t.replaceChildren(h('p', { class: 'tooltip-title' }, title), ...lines.map((l) => h('p', {}, l)));
  t.hidden = false;
  const pad = 12;
  const r = t.getBoundingClientRect();
  let left = x + pad;
  let top = y + pad;
  if (left + r.width > window.innerWidth - 8) left = Math.max(8, x - r.width - pad);
  if (top + r.height > window.innerHeight - 8) top = Math.max(8, y - r.height - pad);
  t.style.left = `${left}px`;
  t.style.top = `${top}px`;
}

/** Show the tooltip next to an element (used for keyboard focus). */
export function showTipFor(target: Element, title: string, lines: string[]): void {
  const r = target.getBoundingClientRect();
  showTip(r.right, r.bottom, title, lines);
}

export function hideTip(): void {
  if (tip) tip.hidden = true;
}
