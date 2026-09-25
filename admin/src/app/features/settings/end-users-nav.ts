import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NgIcon } from '@ng-icons/core';

import { I18n } from '../../core/i18n/i18n';
import { MessageKey } from '../../core/i18n/keys';

interface Tab {
  path: string;
  label: MessageKey;
  icon: string;
}

const TABS: Tab[] = [
  { path: '/settings/end-users/users', label: 'endUsers.tab.users', icon: 'lucideUsers' },
  { path: '/settings/end-users/roles', label: 'endUsers.tab.roles', icon: 'lucideShieldCheck' },
  { path: '/settings/end-users/settings', label: 'endUsers.tab.settings', icon: 'lucideSettings2' },
];

/** The tabs of Settings → End users, as links (each tab is a route). */
@Component({
  selector: 'vd-end-users-nav',
  imports: [NgIcon, RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav
      class="bg-muted text-muted-foreground inline-flex h-9 w-fit items-center rounded-lg p-[3px]"
      [attr.aria-label]="t('endUsers.title')"
    >
      @for (tab of tabs; track tab.path) {
        <a
          [routerLink]="tab.path"
          routerLinkActive="bg-background text-foreground shadow-sm"
          ariaCurrentWhenActive="page"
          class="text-foreground/60 hover:text-foreground focus-visible:ring-ring/50 inline-flex h-full items-center gap-1.5 rounded-md px-3 text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:ring-[3px]"
        >
          <ng-icon [name]="tab.icon" size="16" />
          {{ t(tab.label) }}
        </a>
      }
    </nav>
  `,
})
export class EndUsersNav {
  protected readonly t = inject(I18n).t;
  protected readonly tabs = TABS;
}
