import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NgIcon } from '@ng-icons/core';

import { I18n } from '../../core/i18n/i18n';
import { MessageKey } from '../../core/i18n/keys';
import { Logo } from '../../shared/components/logo';
import { PreferencesMenu } from '../../shared/components/preferences-menu';

/** Selling points on the brand panel of the auth pages. */
export const AUTH_FEATURES: readonly { icon: string; text: MessageKey }[] = [
  { icon: 'lucideBlocks', text: 'auth.feature.model' },
  { icon: 'lucideRocket', text: 'auth.feature.api' },
  { icon: 'lucideShieldCheck', text: 'auth.feature.access' },
];

/** The layout of the public auth pages: the brand panel and a centered column. */
@Component({
  selector: 'vd-auth-frame',
  imports: [NgIcon, Logo, PreferencesMenu],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bg-background relative grid min-h-svh lg:grid-cols-2">
      <div class="absolute end-4 top-4 z-10"><vd-preferences-menu /></div>

      <aside
        class="from-primary/15 via-primary/5 to-background relative hidden flex-col overflow-hidden border-e bg-linear-to-br p-10 lg:flex"
      >
        <vd-logo size="lg" />
        <div class="mt-auto flex max-w-md flex-col gap-8">
          <h2 class="text-3xl font-semibold tracking-tight text-balance">
            {{ t('auth.tagline') }}
          </h2>
          <ul class="flex flex-col gap-4">
            @for (feature of features; track feature.text) {
              <li class="flex items-start gap-3">
                <span
                  class="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-lg"
                >
                  <ng-icon [name]="feature.icon" size="16" />
                </span>
                <span class="text-muted-foreground pt-1.5 text-sm">{{ t(feature.text) }}</span>
              </li>
            }
          </ul>
        </div>
      </aside>

      <main class="flex items-center justify-center p-6 sm:p-10">
        <div class="flex w-full max-w-sm flex-col gap-6">
          <vd-logo size="lg" class="self-center lg:hidden" />
          <ng-content />
        </div>
      </main>
    </div>
  `,
})
export class AuthFrame {
  protected readonly t = inject(I18n).t;
  protected readonly features = AUTH_FEATURES;
}
