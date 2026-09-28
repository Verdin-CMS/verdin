/** Custom fields provided by plugins: a Web Component bound to a Signal Forms field. */

import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FormValueControl } from '@angular/forms/signals';

import { I18n } from '../../../core/i18n/i18n';
import { Attribute } from '../../../core/types';

/** No value in a change event. */
export const NO_VALUE: unique symbol = Symbol('no value');

/**
 * The new value a plugin element reports: a `change` event's `detail`, or else its target's
 * `value` property. `NO_VALUE` when the event carries neither.
 */
export function changeValue(event: Event): unknown {
  const detail = (event as CustomEvent).detail;
  if (detail !== undefined && detail !== null && 'detail' in event) return detail;
  const target = event.target as { value?: unknown } | null;
  if (target && 'value' in target) return target.value ?? null;
  if ('detail' in event && detail === null) return null;
  return NO_VALUE;
}

/** The element's properties Verdin sets. */
type PluginElement = HTMLElement & {
  value?: unknown;
  disabled?: boolean;
  attribute?: Attribute | null;
  locale?: string | null;
};

@Component({
  selector: 'vd-plugin-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-w-0' },
  template: `
    @if (failed()) {
      <p class="text-destructive text-sm">
        {{ i18n.t('content.fields.customFieldFailed', { element: element() }) }}
      </p>
    }
  `,
})
export class PluginFieldControl implements FormValueControl<unknown> {
  protected readonly i18n = inject(I18n);

  readonly value = model<unknown>(null);
  readonly disabled = input(false);
  readonly touch = output<void>();
  /** The custom element's tag name. */
  readonly element = input.required<string>();
  /** The attribute's definition, passed to the element. */
  readonly attribute = input<Attribute | null>(null);
  readonly locale = input<string | null>(null);
  readonly inputId = input('');

  protected readonly failed = signal(false);
  /** The element goes first in the host, before Angular's own nodes. */
  private readonly host: HTMLElement = inject(ElementRef).nativeElement;
  private readonly node = signal<PluginElement | null>(null);
  /** The last value the element reported, not written back to it. */
  private reported: { node: PluginElement; value: unknown } | null = null;

  constructor() {
    // Create the element (again when the tag changes).
    effect((onCleanup) => {
      const tag = this.element();
      let node: PluginElement;
      try {
        node = document.createElement(tag) as PluginElement;
      } catch {
        this.failed.set(true);
        return;
      }
      this.failed.set(false);
      const id = untracked(this.inputId);
      if (id) node.id = id;
      const listener = (event: Event) => {
        if (event.target !== node && !node.contains(event.target as Node)) return;
        const value = changeValue(event);
        if (value === NO_VALUE) return;
        this.reported = { node, value };
        this.value.set(value);
        this.touch.emit();
      };
      node.addEventListener('change', listener);
      this.host.prepend(node);
      this.node.set(node);
      onCleanup(() => {
        node.removeEventListener('change', listener);
        node.remove();
        this.node.set(null);
      });
    });
    // Keep the element's value in sync with the form (load, reset, other edits).
    effect(() => {
      const node = this.node();
      const value = this.value();
      if (!node) return;
      if (this.reported?.node === node && this.reported.value === value) return;
      this.reported = null;
      node.value = value;
    });
    effect(() => {
      const node = this.node();
      if (!node) return;
      node.disabled = this.disabled();
      node.attribute = this.attribute();
      node.locale = this.locale();
      node.toggleAttribute('disabled', this.disabled());
    });
  }
}
