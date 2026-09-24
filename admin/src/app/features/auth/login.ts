import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormField, FormRoot, email, form, required, submit } from '@angular/forms/signals';
import { ActivatedRoute, Router } from '@angular/router';
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
  selector: 'vd-login',
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
      <section hlmCard class="w-full max-w-sm">
        <div hlmCardHeader>
          <h1 hlmCardTitle class="flex items-center gap-2"><ng-icon name="lucideLeaf" /> Verdin</h1>
          <p hlmCardDescription>Log in to the admin panel.</p>
        </div>
        <div hlmCardContent>
          <form
            [formRoot]="loginForm"
            (submit)="$event.preventDefault(); login()"
            class="flex flex-col gap-4"
          >
            <div hlmField>
              <label hlmFieldLabel for="email">Email</label>
              <input
                hlmInput
                id="email"
                type="email"
                autocomplete="username"
                [formField]="loginForm.email"
              />
            </div>
            <div hlmField>
              <label hlmFieldLabel for="password">Password</label>
              <input
                hlmInput
                id="password"
                type="password"
                autocomplete="current-password"
                [formField]="loginForm.password"
              />
            </div>
            @if (error()) {
              <div hlmAlert variant="destructive">
                <p hlmAlertDescription>{{ error() }}</p>
              </div>
            }
            <button hlmBtn type="submit" [disabled]="busy() || loginForm().invalid()">
              @if (busy()) {
                <hlm-spinner />
              }
              Log in
            </button>
          </form>
        </div>
      </section>
    </div>
  `,
})
export class LoginPage implements OnInit {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly model = signal({ email: '', password: '' });
  protected readonly loginForm = form(this.model, (path) => {
    required(path.email);
    email(path.email);
    required(path.password);
  });
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    if (!(await this.auth.hasAdmin())) await this.router.navigateByUrl('/register');
  }

  protected async login(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    await submit(this.loginForm, async () => {
      try {
        await this.auth.login(this.model().email, this.model().password);
        await this.router.navigateByUrl(this.route.snapshot.queryParamMap.get('next') ?? '/');
      } catch (error) {
        const failure = ApiFailure.from(error);
        this.error.set(
          failure.status === 429
            ? 'Too many attempts. Wait a minute and try again.'
            : failure.message,
        );
      }
      return undefined;
    });
    this.busy.set(false);
  }
}
