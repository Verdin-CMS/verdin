import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { HlmFieldImports } from '@spartan-ng/helm/field';

import { MAX_PASSWORD, MIN_PASSWORD, passwordProblem } from '../../core/account';
import { I18n } from '../../core/i18n/i18n';
import { PasswordField } from './password-field';

/** A new password and its confirmation; `password` emits the valid one (else `null`). */
@Component({
  selector: 'vd-new-password',
  imports: [HlmFieldImports, PasswordField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-4' },
  template: `
    <div hlmField>
      <label hlmFieldLabel [for]="idPrefix() + '-password'">{{
        label() ?? t('account.password.new')
      }}</label>
      <vd-password-field
        [inputId]="idPrefix() + '-password'"
        [describedBy]="idPrefix() + '-password-hint'"
        [invalid]="!!password() && problem() === 'short'"
        [value]="password()"
        (valueChange)="set($event, confirmation())"
      />
      <p hlmFieldDescription [id]="idPrefix() + '-password-hint'">
        {{ t('account.password.hint', { min: min, max: max }) }}
      </p>
    </div>
    <div hlmField>
      <label hlmFieldLabel [for]="idPrefix() + '-confirmation'">{{
        t('account.password.confirm')
      }}</label>
      <vd-password-field
        [inputId]="idPrefix() + '-confirmation'"
        [describedBy]="mismatch() ? idPrefix() + '-confirmation-error' : null"
        [invalid]="mismatch()"
        [value]="confirmation()"
        (valueChange)="set(password(), $event)"
      />
      @if (mismatch()) {
        <hlm-field-error forceShow [id]="idPrefix() + '-confirmation-error'">{{
          t('account.password.mismatch')
        }}</hlm-field-error>
      }
    </div>
  `,
})
export class NewPassword {
  protected readonly t = inject(I18n).t;
  protected readonly min = MIN_PASSWORD;
  protected readonly max = MAX_PASSWORD;
  readonly idPrefix = input('new');
  readonly label = input<string | null>(null);
  /** The password when it is valid and confirmed, else `null`. */
  readonly changed = output<string | null>();
  protected readonly password = signal('');
  protected readonly confirmation = signal('');
  protected readonly problem = computed(() =>
    passwordProblem(this.password(), this.confirmation()),
  );
  protected readonly mismatch = computed(
    () => !!this.confirmation() && this.problem() === 'mismatch',
  );

  protected set(password: string, confirmation: string): void {
    this.password.set(password);
    this.confirmation.set(confirmation);
    this.changed.emit(passwordProblem(password, confirmation) ? null : password);
  }

  /** Empties both inputs. */
  reset(): void {
    this.set('', '');
  }
}
