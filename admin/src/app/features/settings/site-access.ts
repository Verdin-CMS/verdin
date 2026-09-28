import { ChangeDetectionStrategy, Component, Signal, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';

import { Auth } from '../../core/auth';
import { Features } from '../../core/features';
import { I18n } from '../../core/i18n/i18n';
import { MessageKey } from '../../core/i18n/keys';

/** Whether a site page can be used: its feature is on and the admin has `site.manage`. */
export type SiteAccess = 'loading' | 'forbidden' | 'off' | 'ok';

export type SiteFeature = 'redirects' | 'menus' | 'forms';

/**
 * The access to a site page, loading the feature catalog when the shell has not yet
 * (direct navigation). Call it in an injection context.
 */
export function siteAccess(feature: SiteFeature): Signal<SiteAccess> {
  const features = inject(Features);
  const auth = inject(Auth);
  if (features.catalog() === null) features.load().catch(() => features.catalog.set([]));
  return computed(() => {
    if (!auth.can('site.manage')) return 'forbidden';
    if (features.catalog() === null) return 'loading';
    return features.enabled(feature) ? 'ok' : 'off';
  });
}

/** What a site page shows instead of itself when it cannot be used. */
@Component({
  selector: 'vd-site-access',
  imports: [NgIcon, RouterLink, HlmAlertImports, HlmButtonImports, HlmSkeletonImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (access()) {
      @case ('loading') {
        <hlm-skeleton class="h-48 rounded-xl" />
      }
      @case ('forbidden') {
        <div hlmAlert>
          <ng-icon hlmAlertIcon name="lucideInfo" />
          <p hlmAlertDescription>{{ t('site.forbidden') }}</p>
        </div>
      }
      @case ('off') {
        <div hlmAlert>
          <ng-icon hlmAlertIcon name="lucideInfo" />
          <p hlmAlertTitle>{{ t('site.featureOff', { name: t(nameKey()) }) }}</p>
          <div hlmAlertDescription class="flex flex-col items-start gap-2">
            <span>{{ t('site.featureOffHint') }}</span>
            @if (canManageFeatures()) {
              <a hlmBtn size="sm" variant="outline" routerLink="/settings/features">
                <ng-icon name="lucidePuzzle" /> {{ t('site.openFeatures') }}
              </a>
            }
          </div>
        </div>
      }
    }
  `,
})
export class SiteAccessNotice {
  private readonly auth = inject(Auth);
  protected readonly t = inject(I18n).t;
  readonly access = input.required<SiteAccess>();
  readonly feature = input.required<SiteFeature>();
  protected readonly nameKey = computed(() => `features.${this.feature()}.name` as MessageKey);
  protected readonly canManageFeatures = computed(() => this.auth.can('features.manage'));
}
