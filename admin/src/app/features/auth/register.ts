import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormField, FormRoot, email, form, minLength, required } from '@angular/forms/signals';
import { Router } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';

import { ApiFailure } from '../../core/api';
import { Auth } from '../../core/auth';

@Component({
  selector: 'vd-register',
  imports: [
    FormRoot,
    FormField,
    NgIcon,
    HlmCardImports,
    HlmFieldImports,
    HlmInputImports,
    HlmButtonImports,
    HlmAlertImports,
    HlmSpinnerImports,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bg-muted flex min-h-svh items-center justify-center p-6">
      <section hlmCard class="w-full max-w-md">
        <div hlmCardHeader>
          <h1 hlmCardTitle class="flex items-center gap-2">
            <ng-icon name="lucideLeaf" /> Welcome to Verdin
          </h1>
          <p hlmCardDescription>Create the first administrator. It gets every permission.</p>
        </div>
        <div hlmCardContent>
          <form
            [formRoot]="registerForm"
            (submit)="$event.preventDefault(); register()"
            class="flex flex-col gap-4"
          >
            <div class="grid grid-cols-2 gap-4">
              <div hlmField>
                <label hlmFieldLabel for="firstname">First name</label>
                <input hlmInput id="firstname" [formField]="registerForm.firstname" />
              </div>
              <div hlmField>
                <label hlmFieldLabel for="lastname">Last name</label>
                <input hlmInput id="lastname" [formField]="registerForm.lastname" />
              </div>
            </div>
            <div hlmField>
              <label hlmFieldLabel for="email">Email</label>
              <input
                hlmInput
                id="email"
                type="email"
                autocomplete="username"
                [formField]="registerForm.email"
              />
            </div>
            <div hlmField>
              <label hlmFieldLabel for="password">Password</label>
              <input
                hlmInput
                id="password"
                type="password"
                autocomplete="new-password"
                [formField]="registerForm.password"
              />
              <p hlmFieldDescription>At least 8 characters.</p>
              @if (registerForm.password().touched()) {
                @for (error of registerForm.password().errors(); track error.kind) {
                  <hlm-field-error>{{ error.message }}</hlm-field-error>
                }
              }
            </div>
            @if (error()) {
              <div hlmAlert variant="destructive">
                <p hlmAlertDescription>{{ error() }}</p>
              </div>
            }
            <button hlmBtn type="submit" [disabled]="busy() || registerForm().invalid()">
              @if (busy()) {
                <hlm-spinner />
              }
              Create account
            </button>
          </form>
        </div>
      </section>
    </div>
  `,
})
export class RegisterPage {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);

  protected readonly model = signal({ firstname: '', lastname: '', email: '', password: '' });
  protected readonly registerForm = form(this.model, (path) => {
    required(path.email);
    email(path.email);
    required(path.password);
    minLength(path.password, 8, { message: 'Use at least 8 characters.' });
  });
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async register(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const { firstname, lastname, email, password } = this.model();
      await this.auth.register({
        email,
        password,
        firstname: firstname || undefined,
        lastname: lastname || undefined,
      });
      await this.router.navigateByUrl('/');
    } catch (error) {
      const failure = ApiFailure.from(error);
      this.error.set(
        failure.status === 403
          ? 'An administrator already exists. Log in instead.'
          : failure.message,
      );
    } finally {
      this.busy.set(false);
    }
  }
}
