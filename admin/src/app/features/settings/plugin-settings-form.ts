import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { HlmSwitchImports } from '@spartan-ng/helm/switch';
import { HlmTextareaImports } from '@spartan-ng/helm/textarea';

import { I18n } from '../../core/i18n/i18n';
import {
  PluginSettingField,
  SettingProblem,
  SettingValue,
  settingProblem,
  settingsFormValues,
  settingsFromForm,
} from '../../core/plugins';

/**
 * The settings form a plugin declares (`[[settings]]`), with client-side checks that mirror
 * the server's. Emits the settings object to save; the parent shows the server's answer.
 */
@Component({
  selector: 'vd-plugin-settings-form',
  imports: [
    NgIcon,
    HlmAlertImports,
    HlmButtonImports,
    HlmDialogImports,
    HlmFieldImports,
    HlmInputImports,
    HlmNativeSelectImports,
    HlmSpinnerImports,
    HlmSwitchImports,
    HlmTextareaImports,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="flex flex-col gap-5" novalidate (submit)="$event.preventDefault(); submit()">
      <div class="-mx-1 flex max-h-[60vh] flex-col gap-5 overflow-y-auto px-1">
        @for (field of fields(); track field.key) {
          @let id = 'plugin-setting-' + field.key;
          @let problem = shownProblem(field);
          @let ariaDesc = describedBy(field, problem);
          @if (field.type === 'boolean') {
            <div class="flex items-start gap-3">
              <hlm-switch
                class="mt-0.5"
                [inputId]="id"
                [checked]="values()[field.key] === true"
                [aria-label]="field.label"
                [aria-describedby]="ariaDesc"
                (checkedChange)="set(field, $event)"
              />
              <div class="flex flex-col gap-0.5">
                <label class="text-sm font-medium" [for]="id">{{ field.label }}</label>
                @if (field.description) {
                  <p class="text-muted-foreground text-xs" [id]="id + '-hint'">
                    {{ field.description }}
                  </p>
                }
              </div>
            </div>
          } @else {
            <div hlmField [attr.data-invalid]="problem ? true : null">
              <label hlmFieldLabel [for]="id">
                {{ field.label }}
                @if (field.required) {
                  <span class="text-destructive" aria-hidden="true">*</span>
                }
              </label>
              @switch (field.type) {
                @case ('text') {
                  <textarea
                    hlmTextarea
                    rows="4"
                    [id]="id"
                    [required]="field.required"
                    [attr.aria-invalid]="problem ? true : null"
                    [attr.aria-describedby]="ariaDesc"
                    [attr.placeholder]="placeholder(field)"
                    [value]="text(field)"
                    (input)="set(field, $any($event.target).value)"
                    (blur)="touch(field)"
                  ></textarea>
                }
                @case ('select') {
                  <hlm-native-select
                    [selectId]="id"
                    [value]="text(field)"
                    (valueChange)="set(field, $event ?? ''); touch(field)"
                  >
                    @if (!field.required || field.default !== null) {
                      <option hlmNativeSelectOption value="">
                        {{
                          field.default !== null && field.default !== undefined
                            ? t('settings.plugins.form.defaultOption', {
                                value: '' + field.default,
                              })
                            : t('settings.plugins.form.noneOption')
                        }}
                      </option>
                    } @else if (!text(field)) {
                      <option hlmNativeSelectOption value="" disabled>
                        {{ t('settings.plugins.form.choose') }}
                      </option>
                    }
                    @for (option of field.options; track option) {
                      <option hlmNativeSelectOption [value]="option">{{ option }}</option>
                    }
                  </hlm-native-select>
                }
                @default {
                  <input
                    hlmInput
                    [id]="id"
                    [type]="inputType(field)"
                    [attr.inputmode]="
                      field.type === 'integer'
                        ? 'numeric'
                        : field.type === 'number'
                          ? 'decimal'
                          : null
                    "
                    [attr.step]="
                      field.type === 'integer' ? 1 : field.type === 'number' ? 'any' : null
                    "
                    [attr.min]="isNumber(field) ? field.min : null"
                    [attr.max]="isNumber(field) ? field.max : null"
                    [required]="field.required"
                    [attr.aria-invalid]="problem ? true : null"
                    [attr.aria-describedby]="ariaDesc"
                    [attr.placeholder]="placeholder(field)"
                    [value]="text(field)"
                    (input)="set(field, $any($event.target).value)"
                    (blur)="touch(field)"
                  />
                }
              }
              @if (field.description) {
                <p class="text-muted-foreground text-xs" [id]="id + '-hint'">
                  {{ field.description }}
                </p>
              }
              @if (problem) {
                <p class="text-destructive text-sm" [id]="id + '-error'">
                  {{ problemText(problem) }}
                </p>
              }
            </div>
          }
        }
      </div>

      @if (serverError()) {
        <div hlmAlert variant="destructive" role="alert">
          <ng-icon hlmAlertIcon name="lucideCircleAlert" />
          <p hlmAlertTitle>{{ t('settings.plugins.form.rejected') }}</p>
          <p hlmAlertDescription>{{ serverError() }}</p>
        </div>
      }

      <hlm-dialog-footer>
        <button hlmBtn type="button" variant="outline" (click)="cancelled.emit()">
          {{ t('common.cancel') }}
        </button>
        <button hlmBtn type="submit" [disabled]="saving()">
          @if (saving()) {
            <hlm-spinner class="size-4" />
          }
          {{ t('common.save') }}
        </button>
      </hlm-dialog-footer>
    </form>
  `,
})
export class PluginSettingsForm implements OnInit {
  protected readonly t = inject(I18n).t;

  readonly fields = input.required<PluginSettingField[]>();
  readonly settings = input<Record<string, unknown>>({});
  readonly saving = input(false);
  /** The server's refusal (400 message). */
  readonly serverError = input<string | null>(null);

  readonly saved = output<Record<string, unknown>>();
  readonly cancelled = output<void>();

  protected readonly values = signal<Record<string, SettingValue>>({});
  /** Fields left once (or all, after a submit): their problems show. */
  private readonly touched = signal<ReadonlySet<string>>(new Set());
  protected readonly problems = computed(() => {
    const values = this.values();
    const problems: Record<string, SettingProblem> = {};
    for (const field of this.fields()) {
      const problem = settingProblem(field, values[field.key]);
      if (problem) problems[field.key] = problem;
    }
    return problems;
  });

  ngOnInit(): void {
    this.values.set(settingsFormValues(this.fields(), this.settings()));
  }

  protected text(field: PluginSettingField): string {
    const value = this.values()[field.key];
    return typeof value === 'string' ? value : '';
  }

  protected set(field: PluginSettingField, value: SettingValue): void {
    this.values.update((values) => ({ ...values, [field.key]: value }));
  }

  protected touch(field: PluginSettingField): void {
    this.touched.update((keys) => new Set([...keys, field.key]));
  }

  protected shownProblem(field: PluginSettingField): SettingProblem | null {
    return this.touched().has(field.key) ? (this.problems()[field.key] ?? null) : null;
  }

  protected describedBy(field: PluginSettingField, problem: SettingProblem | null): string | null {
    const id = 'plugin-setting-' + field.key;
    const ids = [field.description ? `${id}-hint` : '', problem ? `${id}-error` : ''].filter(
      Boolean,
    );
    return ids.length ? ids.join(' ') : null;
  }

  protected isNumber(field: PluginSettingField): boolean {
    return field.type === 'number' || field.type === 'integer';
  }

  protected inputType(field: PluginSettingField): string {
    return this.isNumber(field) ? 'number' : field.type === 'url' ? 'url' : 'text';
  }

  protected placeholder(field: PluginSettingField): string | null {
    return field.default !== null && field.default !== undefined && field.type !== 'boolean'
      ? String(field.default)
      : null;
  }

  protected problemText(problem: SettingProblem): string {
    switch (problem.kind) {
      case 'required':
        return this.t('settings.plugins.form.required');
      case 'number':
        return this.t('settings.plugins.form.number');
      case 'integer':
        return this.t('settings.plugins.form.integer');
      case 'url':
        return this.t('settings.plugins.form.url');
      case 'option':
        return this.t('settings.plugins.form.option');
      case 'min':
        return problem.length
          ? this.t('settings.plugins.form.minLength', { count: problem.bound })
          : this.t('settings.plugins.form.min', { min: problem.bound });
      case 'max':
        return problem.length
          ? this.t('settings.plugins.form.maxLength', { count: problem.bound })
          : this.t('settings.plugins.form.max', { max: problem.bound });
    }
  }

  protected submit(): void {
    this.touched.set(new Set(this.fields().map((field) => field.key)));
    if (Object.keys(this.problems()).length) {
      // Focus the first invalid field.
      const first = this.fields().find((field) => this.problems()[field.key]);
      if (first) document.getElementById('plugin-setting-' + first.key)?.focus();
      return;
    }
    this.saved.emit(settingsFromForm(this.fields(), this.values()));
  }
}
