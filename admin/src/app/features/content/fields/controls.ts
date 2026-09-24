/** Custom Signal Forms controls for values native inputs do not map directly. */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import { FormValueControl } from '@angular/forms/signals';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { HlmSwitchImports } from '@spartan-ng/helm/switch';
import { HlmTextareaImports } from '@spartan-ng/helm/textarea';

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
      <p class="text-destructive mt-1 text-sm">Enter a number.</p>
    }
  `,
})
export class NumberControl implements FormValueControl<number | string | null> {
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

/** ISO 8601 (UTC) ↔ the browser's local `datetime-local` input. */
@Component({
  selector: 'vd-datetime-control',
  imports: [HlmInputImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <input
      hlmInput
      type="datetime-local"
      step="1"
      [id]="inputId()"
      [value]="local()"
      [disabled]="disabled()"
      (change)="onChange($any($event.target).value)"
      (blur)="touch.emit()"
    />
  `,
})
export class DateTimeControl implements FormValueControl<string | null> {
  readonly value = model<string | null>(null);
  readonly disabled = input(false);
  readonly touch = output<void>();
  readonly inputId = input<string>('');

  protected readonly local = computed(() => {
    const value = this.value();
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const offset = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 19);
  });

  protected onChange(local: string): void {
    this.value.set(local ? new Date(local).toISOString() : null);
  }
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
      <p class="text-destructive mt-1 text-sm">Invalid JSON: {{ parseError() }}</p>
    }
  `,
})
export class JsonControl implements FormValueControl<unknown> {
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
      this.parseError.set(error instanceof Error ? error.message : 'unparsable');
    }
  }

  private emit(value: unknown): void {
    this.lastEmitted = value;
    this.value.set(value);
  }
}
