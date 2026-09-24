/** Custom Signal Forms controls for values native inputs do not map directly. */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import { FormValueControl } from '@angular/forms/signals';
import { NgIcon } from '@ng-icons/core';
import type { BrnOverlayState } from '@spartan-ng/brain/overlay';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCalendar } from '@spartan-ng/helm/calendar';
import { HlmPopoverImports } from '@spartan-ng/helm/popover';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { HlmSwitchImports } from '@spartan-ng/helm/switch';
import { HlmTextareaImports } from '@spartan-ng/helm/textarea';

import { I18n, parseDate } from '../../../core/i18n/i18n';

/** Numbers that may be empty (`null`). `bigint` keeps the value as a string. */
@Component({
  selector: 'vd-number-control',
  imports: [HlmInputImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <input
      hlmInput
      [id]="inputId()"
      [attr.inputmode]="integer() ? 'numeric' : 'decimal'"
      [value]="text()"
      [disabled]="disabled()"
      [attr.aria-invalid]="invalid() || parseError() || null"
      (input)="onInput($any($event.target).value)"
      (blur)="touch.emit()"
    />
    @if (parseError()) {
      <p class="text-destructive mt-1 text-sm">{{ i18n.t('content.controls.number') }}</p>
    }
  `,
})
export class NumberControl implements FormValueControl<number | string | null> {
  protected readonly i18n = inject(I18n);
  readonly value = model<number | string | null>(null);
  readonly disabled = input(false);
  readonly invalid = input(false);
  readonly touch = output<void>();
  readonly inputId = input<string>('');
  readonly integer = input(false);
  /** Keep the value as a string (bigintegers exceed JavaScript numbers). */
  readonly bigint = input(false);

  protected readonly parseError = signal(false);
  protected readonly text = computed(() => {
    const value = this.value();
    return value === null || value === undefined ? '' : String(value);
  });

  protected onInput(text: string): void {
    const trimmed = text.trim();
    if (trimmed === '') {
      this.parseError.set(false);
      this.value.set(null);
      return;
    }
    const valid = this.integer()
      ? /^-?\d+$/.test(trimmed)
      : /^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(trimmed);
    this.parseError.set(!valid);
    if (valid) this.value.set(this.bigint() ? trimmed : Number(trimmed));
  }
}

@Component({
  selector: 'vd-switch-control',
  imports: [HlmSwitchImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-switch
      [inputId]="inputId()"
      [checked]="value()"
      [disabled]="disabled()"
      (checkedChange)="value.set($event); touch.emit()"
    />
  `,
})
export class SwitchControl implements FormValueControl<boolean> {
  readonly value = model(false);
  readonly disabled = input(false);
  readonly touch = output<void>();
  readonly inputId = input<string | null>(null);
}

@Component({
  selector: 'vd-enum-control',
  imports: [HlmNativeSelectImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-native-select
      [selectId]="inputId()"
      [value]="value() ?? ''"
      [disabled]="disabled()"
      (valueChange)="value.set($event ? $event : null); touch.emit()"
    >
      <option hlmNativeSelectOption value="">—</option>
      @for (option of options(); track option) {
        <option hlmNativeSelectOption [value]="option">{{ option }}</option>
      }
    </hlm-native-select>
  `,
})
export class EnumControl implements FormValueControl<string | null> {
  readonly value = model<string | null>(null);
  readonly disabled = input(false);
  readonly touch = output<void>();
  readonly inputId = input<string>('');
  readonly options = input<string[]>([]);
}

/** A date picked on a locale-aware calendar (first day of week, month names). */
@Component({
  selector: 'vd-calendar-button',
  imports: [NgIcon, HlmButtonImports, HlmPopoverImports, HlmCalendar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-popover sideOffset="4" align="start" [state]="state()" (stateChanged)="state.set($event)">
      <button
        hlmBtn
        hlmPopoverTrigger
        type="button"
        variant="outline"
        class="w-full justify-start font-normal"
        [id]="inputId()"
        [disabled]="disabled()"
        [attr.aria-invalid]="invalid() || null"
      >
        <ng-icon name="lucideCalendar" class="text-muted-foreground" />
        <span class="truncate" [class.text-muted-foreground]="!date()">
          {{ date() ? i18n.formatDate(date(), 'date') : i18n.t('calendar.pick') }}
        </span>
      </button>
      <hlm-popover-content class="w-auto p-3" *hlmPopoverPortal="let ctx">
        <hlm-calendar
          captionLayout="dropdown"
          [date]="date() ?? undefined"
          [defaultFocusedDate]="date() ?? today"
          (dateChange)="pick($event)"
        />
      </hlm-popover-content>
    </hlm-popover>
  `,
})
export class CalendarButton {
  protected readonly i18n = inject(I18n);
  readonly date = input<Date | null>(null);
  readonly disabled = input(false);
  readonly invalid = input(false);
  readonly inputId = input<string>('');
  readonly picked = output<Date>();

  protected readonly today = new Date();
  protected readonly state = signal<BrnOverlayState | null>(null);

  protected pick(date: Date): void {
    this.picked.emit(date);
    this.state.set('closed');
  }
}

/** `YYYY-MM-DD` calendar dates. */
@Component({
  selector: 'vd-date-control',
  imports: [NgIcon, HlmButtonImports, CalendarButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex items-center gap-2">
      <vd-calendar-button
        class="min-w-0 flex-1"
        [inputId]="inputId()"
        [date]="date()"
        [disabled]="disabled()"
        [invalid]="invalid()"
        (picked)="value.set(toIsoDate($event)); touch.emit()"
      />
      @if (value() && !disabled()) {
        <button
          hlmBtn
          type="button"
          variant="ghost"
          size="icon"
          [attr.aria-label]="i18n.t('common.clear')"
          (click)="value.set(null); touch.emit()"
        >
          <ng-icon name="lucideX" />
        </button>
      }
    </div>
  `,
})
export class DateControl implements FormValueControl<string | null> {
  protected readonly i18n = inject(I18n);
  readonly value = model<string | null>(null);
  readonly disabled = input(false);
  readonly invalid = input(false);
  readonly touch = output<void>();
  readonly inputId = input<string>('');

  protected readonly date = computed(() => {
    const value = this.value();
    return value ? parseDate(value) : null;
  });

  protected toIsoDate(date: Date): string {
    return toIsoDate(date);
  }
}

/** ISO 8601 instants (UTC), edited as a local date on the calendar plus a local time. */
@Component({
  selector: 'vd-datetime-control',
  imports: [NgIcon, HlmButtonImports, HlmInputImports, CalendarButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex items-center gap-2">
      <vd-calendar-button
        class="min-w-0 flex-1"
        [inputId]="inputId()"
        [date]="local()"
        [disabled]="disabled()"
        [invalid]="invalid()"
        (picked)="setDate($event)"
      />
      <input
        hlmInput
        type="time"
        step="1"
        class="w-32"
        [attr.aria-label]="i18n.t('calendar.time')"
        [value]="time()"
        [disabled]="disabled()"
        (change)="setTime($any($event.target).value)"
        (blur)="touch.emit()"
      />
      @if (value() && !disabled()) {
        <button
          hlmBtn
          type="button"
          variant="ghost"
          size="icon"
          [attr.aria-label]="i18n.t('common.clear')"
          (click)="value.set(null); touch.emit()"
        >
          <ng-icon name="lucideX" />
        </button>
      }
    </div>
  `,
})
export class DateTimeControl implements FormValueControl<string | null> {
  protected readonly i18n = inject(I18n);
  readonly value = model<string | null>(null);
  readonly disabled = input(false);
  readonly invalid = input(false);
  readonly touch = output<void>();
  readonly inputId = input<string>('');

  protected readonly local = computed(() => {
    const value = this.value();
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  });
  protected readonly time = computed(() => {
    const date = this.local();
    if (!date) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  });

  protected setDate(day: Date): void {
    const current = this.local();
    const next = new Date(day);
    if (current) next.setHours(current.getHours(), current.getMinutes(), current.getSeconds(), 0);
    else next.setHours(0, 0, 0, 0);
    this.value.set(next.toISOString());
    this.touch.emit();
  }

  protected setTime(text: string): void {
    const [hours = 0, minutes = 0, seconds = 0] = text.split(':').map(Number);
    const next = this.local() ? new Date(this.local()!) : new Date();
    if (!this.local()) next.setSeconds(0, 0);
    next.setHours(hours, minutes, seconds, 0);
    this.value.set(text ? next.toISOString() : this.value());
  }
}

/** Local calendar date as `YYYY-MM-DD`. */
export function toIsoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Free JSON, edited as text; the value only changes when the text parses. */
@Component({
  selector: 'vd-json-control',
  imports: [HlmTextareaImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <textarea
      hlmTextarea
      rows="6"
      class="font-mono text-xs"
      [id]="inputId()"
      [value]="text()"
      [disabled]="disabled()"
      (input)="onInput($any($event.target).value)"
      (blur)="touch.emit()"
    ></textarea>
    @if (parseError()) {
      <p class="text-destructive mt-1 text-sm">
        {{ i18n.t('content.controls.json', { error: parseError() }) }}
      </p>
    }
  `,
})
export class JsonControl implements FormValueControl<unknown> {
  protected readonly i18n = inject(I18n);
  readonly value = model<unknown>(null);
  readonly disabled = input(false);
  readonly touch = output<void>();
  readonly inputId = input<string>('');

  protected readonly text = signal('');
  protected readonly parseError = signal<string | null>(null);
  private lastEmitted: unknown = undefined;

  constructor() {
    // Reformat when the value changes from outside (load, reset), not while typing.
    effect(() => {
      const value = this.value();
      if (value !== this.lastEmitted) {
        this.text.set(value === null || value === undefined ? '' : JSON.stringify(value, null, 2));
        this.parseError.set(null);
      }
    });
  }

  protected onInput(text: string): void {
    this.text.set(text);
    if (text.trim() === '') {
      this.parseError.set(null);
      this.emit(null);
      return;
    }
    try {
      this.emit(JSON.parse(text));
      this.parseError.set(null);
    } catch (error) {
      this.parseError.set(
        error instanceof Error ? error.message : this.i18n.t('content.controls.unparsable'),
      );
    }
  }

  private emit(value: unknown): void {
    this.lastEmitted = value;
    this.value.set(value);
  }
}
