// A labelled empty section for a feature that is built in a later checklist step.

import { h } from '../dom';
import { icon } from '../icons';

export function mountPlaceholder(el: HTMLElement, title: string, step: string, description: string, iconName: string): void {
  el.replaceChildren(
    h('div', { class: 'empty' },
      h('div', { class: 'empty-icon' }, icon(iconName)),
      h('div', {},
        h('h2', {}, title, h('span', { class: 'step-tag' }, `planned · ${step}`)),
        h('p', { class: 'note' }, description),
      ),
    ),
  );
}
