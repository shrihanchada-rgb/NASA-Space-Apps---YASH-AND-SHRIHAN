// A labelled empty section for a feature that is built in a later checklist step.

import { h } from '../dom';

export function mountPlaceholder(el: HTMLElement, title: string, step: string, description: string): void {
  el.classList.add('placeholder');
  el.replaceChildren(h('h2', {}, title), h('p', { class: 'note' }, `${description} (planned: step ${step})`));
}
