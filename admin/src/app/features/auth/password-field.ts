import { ChangeDetectionStrategy, Component, inject, input, model, signal } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { HlmInputGroupImports } from '@spartan-ng/helm/input-group';

import { I18n } from '../../core/i18n/i18n';

/** A password input with a show/hide button. */
@Component({
  selector: 'vd-password-field',
  imports: [NgIcon, HlmInputGroupImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div hlmInputGroup>
      <input
        hlmInputGroupInput
        [id]="inputId()"
        [type]="visible() ? 'text' : 'password'"
        [attr.autocomplete]="autocomplete()"
        [attr.aria-invalid]="invalid() || null"
        [attr.aria-describedby]="describedBy() || null"
        [required]="required()"
        [value]="value()"
        (input)="value.set($any($event.target).value)"
      />
      <div hlmInputGroupAddon align="inline-end">
        <button
          hlmInputGroupButton
          type="button"
          size="icon-xs"
          [attr.aria-label]="visible() ? t('auth.password.hide') : t('auth.password.show')"
          [attr.aria-pressed]="visible()"
          (click)="visible.set(!visible())"
        >
          <ng-icon [name]="visible() ? 'lucideEyeOff' : 'lucideEye'" />
        </button>
      </div>
    </div>
  `,
})
export class PasswordField {
  protected readonly t = inject(I18n).t;
  readonly inputId = input.required<string>();
  readonly value = model('');
  readonly autocomplete = input<'current-password' | 'new-password'>('new-password');
  readonly invalid = input(false);
  readonly required = input(true);
  readonly describedBy = input<string | null>(null);
  protected readonly visible = signal(false);
}
