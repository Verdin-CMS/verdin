import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { NgIcon } from '@ng-icons/core';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDropdownMenuImports } from '@spartan-ng/helm/dropdown-menu';
import { HlmSidebarImports } from '@spartan-ng/helm/sidebar';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmAvatarImports } from '@spartan-ng/helm/avatar';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';

import { ApiFailure } from '../core/api';
import { Auth } from '../core/auth';
import { Features } from '../core/features';
import { I18n } from '../core/i18n/i18n';
import { PluginExtensions } from '../core/plugin-extensions';
import { Schema } from '../core/schema';
import { Unseen, formatBadge } from '../core/unseen';
import { Logo } from '../shared/components/logo';
import { PreferencesMenu } from '../shared/components/preferences-menu';

@Component({
  selector: 'vd-shell',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    NgIcon,
    HlmSidebarImports,
    HlmDropdownMenuImports,
    HlmButtonImports,
    HlmSpinnerImports,
    HlmAlertImports,
    HlmAvatarImports,
    HlmBadgeImports,
    Logo,
    PreferencesMenu,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div hlmSidebarWrapper>
      <hlm-sidebar [side]="sidebarSide()">
        <div hlmSidebarHeader>
          <a routerLink="/" class="flex items-center gap-2 rounded-md px-1.5 py-1.5">
            <vd-logo />
          </a>
        </div>
        <div hlmSidebarContent>
          <div hlmSidebarGroup>
            <ul hlmSidebarMenu>
              <li hlmSidebarMenuItem>
                <a
                  hlmSidebarMenuButton
                  routerLink="/"
                  routerLinkActive
                  [routerLinkActiveOptions]="{ exact: true }"
                  #home="routerLinkActive"
                  [isActive]="home.isActive"
                >
                  <ng-icon name="lucideLayoutDashboard" />
                  <span>{{ t('shell.home') }}</span>
                </a>
              </li>
            </ul>
          </div>
          <div hlmSidebarGroup>
            <div hlmSidebarGroupLabel>{{ t('shell.collections') }}</div>
            <div hlmSidebarGroupContent>
              <ul hlmSidebarMenu>
                @for (type of schema.collections(); track type.uid) {
                  <li hlmSidebarMenuItem class="[&:has(>[data-sidebar=menu-badge])>a]:pe-8">
                    <a
                      hlmSidebarMenuButton
                      [routerLink]="['/content', type.uid]"
                      routerLinkActive
                      #collection="routerLinkActive"
                      [isActive]="collection.isActive"
                    >
                      <ng-icon name="lucideFileText" />
                      <span>{{ type.displayName }}</span>
                    </a>
                    @if (badge(type.uid); as text) {
                      <span
                        hlmSidebarMenuBadge
                        role="img"
                        class="bg-primary/10 text-primary"
                        [attr.aria-label]="t('shell.unseen', { count: unseen.counts()[type.uid] })"
                        >{{ text }}</span
                      >
                    }
                  </li>
                } @empty {
                  <li class="text-muted-foreground px-2 text-sm">{{ t('shell.noTypes') }}</li>
                }
              </ul>
            </div>
          </div>
          @if (schema.singles().length) {
            <div hlmSidebarGroup>
              <div hlmSidebarGroupLabel>{{ t('shell.singleTypes') }}</div>
              <div hlmSidebarGroupContent>
                <ul hlmSidebarMenu>
                  @for (type of schema.singles(); track type.uid) {
                    <li hlmSidebarMenuItem class="[&:has(>[data-sidebar=menu-badge])>a]:pe-8">
                      <a
                        hlmSidebarMenuButton
                        [routerLink]="['/single', type.uid]"
                        routerLinkActive
                        #single="routerLinkActive"
                        [isActive]="single.isActive"
                      >
                        <ng-icon name="lucideFile" />
                        <span>{{ type.displayName }}</span>
                      </a>
                      @if (badge(type.uid); as text) {
                        <span
                          hlmSidebarMenuBadge
                          role="img"
                          class="bg-primary/10 text-primary"
                          [attr.aria-label]="
                            t('shell.unseen', { count: unseen.counts()[type.uid] })
                          "
                          >{{ text }}</span
                        >
                      }
                    </li>
                  }
                </ul>
              </div>
            </div>
          }
          @if (auth.can('media.read')) {
            <div hlmSidebarGroup>
              <ul hlmSidebarMenu>
                <li hlmSidebarMenuItem>
                  <a
                    hlmSidebarMenuButton
                    routerLink="/media"
                    routerLinkActive
                    #media="routerLinkActive"
                    [isActive]="media.isActive"
                  >
                    <ng-icon name="lucideImage" />
                    <span>{{ t('media.title') }}</span>
                  </a>
                </li>
              </ul>
            </div>
          }
          @if (auth.can('releases.manage') && features.enabled('releases')) {
            <div hlmSidebarGroup>
              <ul hlmSidebarMenu>
                <li hlmSidebarMenuItem>
                  <a
                    hlmSidebarMenuButton
                    routerLink="/releases"
                    routerLinkActive
                    #releases="routerLinkActive"
                    [isActive]="releases.isActive"
                  >
                    <ng-icon name="lucideCalendarClock" />
                    <span>{{ t('shell.releases') }}</span>
                  </a>
                </li>
              </ul>
            </div>
          }
          <div hlmSidebarGroup>
            <div hlmSidebarGroupLabel>{{ t('shell.settings') }}</div>
            <div hlmSidebarGroupContent>
              <ul hlmSidebarMenu>
                @if (schema.devMode() && auth.can('schema.manage')) {
                  <li hlmSidebarMenuItem>
                    <a
                      hlmSidebarMenuButton
                      routerLink="/builder"
                      routerLinkActive
                      #builder="routerLinkActive"
                      [isActive]="builder.isActive"
                    >
                      <ng-icon name="lucideBlocks" />
                      <span>{{ t('shell.builder') }}</span>
                    </a>
                  </li>
                }
                @if (auth.can('users.manage')) {
                  <li hlmSidebarMenuItem>
                    <a
                      hlmSidebarMenuButton
                      routerLink="/settings/users"
                      routerLinkActive
                      #users="routerLinkActive"
                      [isActive]="users.isActive"
                    >
                      <ng-icon name="lucideUsers" />
                      <span>{{ t('shell.users') }}</span>
                    </a>
                  </li>
                }
                @if (auth.can('roles.manage')) {
                  <li hlmSidebarMenuItem>
                    <a
                      hlmSidebarMenuButton
                      routerLink="/settings/roles"
                      routerLinkActive
                      #roles="routerLinkActive"
                      [isActive]="roles.isActive"
                    >
                      <ng-icon name="lucideShieldCheck" />
                      <span>{{ t('shell.roles') }}</span>
                    </a>
                  </li>
                  <li hlmSidebarMenuItem>
                    <a
                      hlmSidebarMenuButton
                      routerLink="/settings/public"
                      routerLinkActive
                      #public="routerLinkActive"
                      [isActive]="public.isActive"
                    >
                      <ng-icon name="lucideGlobe" />
                      <span>{{ t('shell.publicAccess') }}</span>
                    </a>
                  </li>
                }
                @if (auth.can('endusers.manage')) {
                  <li hlmSidebarMenuItem>
                    <a
                      hlmSidebarMenuButton
                      routerLink="/settings/end-users"
                      routerLinkActive
                      #endUsers="routerLinkActive"
                      [isActive]="endUsers.isActive"
                    >
                      <ng-icon name="lucideContactRound" />
                      <span>{{ t('shell.endUsers') }}</span>
                    </a>
                  </li>
                }
                @if (auth.can('tokens.manage')) {
                  <li hlmSidebarMenuItem>
                    <a
                      hlmSidebarMenuButton
                      routerLink="/settings/tokens"
                      routerLinkActive
                      #tokens="routerLinkActive"
                      [isActive]="tokens.isActive"
                    >
                      <ng-icon name="lucideKeyRound" />
                      <span>{{ t('shell.apiTokens') }}</span>
                    </a>
                  </li>
                }
                @if (auth.can('webhooks.manage') && features.enabled('webhooks')) {
                  <li hlmSidebarMenuItem>
                    <a
                      hlmSidebarMenuButton
                      routerLink="/settings/webhooks"
                      routerLinkActive
                      #webhooks="routerLinkActive"
                      [isActive]="webhooks.isActive"
                    >
                      <ng-icon name="lucideWebhook" />
                      <span>{{ t('shell.webhooks') }}</span>
                    </a>
                  </li>
                }
                @if (auth.can('workflows.manage') && features.enabled('review')) {
                  <li hlmSidebarMenuItem>
                    <a
                      hlmSidebarMenuButton
                      routerLink="/settings/review-workflows"
                      routerLinkActive
                      #reviewWorkflows="routerLinkActive"
                      [isActive]="reviewWorkflows.isActive"
                    >
                      <ng-icon name="lucideListChecks" />
                      <span>{{ t('shell.reviewWorkflows') }}</span>
                    </a>
                  </li>
                }
                @if (auth.can('audit.read')) {
                  <li hlmSidebarMenuItem>
                    <a
                      hlmSidebarMenuButton
                      routerLink="/settings/audit-logs"
                      routerLinkActive
                      #audit="routerLinkActive"
                      [isActive]="audit.isActive"
                    >
                      <ng-icon name="lucideScrollText" />
                      <span>{{ t('shell.auditLogs') }}</span>
                    </a>
                  </li>
                }
                @if (auth.can('plugins.manage')) {
                  <li hlmSidebarMenuItem>
                    <a
                      hlmSidebarMenuButton
                      routerLink="/settings/plugins"
                      routerLinkActive
                      #plugins="routerLinkActive"
                      [isActive]="plugins.isActive"
                    >
                      <ng-icon name="lucidePlug" />
                      <span>{{ t('shell.plugins') }}</span>
                    </a>
                  </li>
                }
                <li hlmSidebarMenuItem>
                  <a
                    hlmSidebarMenuButton
                    routerLink="/settings/internationalization"
                    routerLinkActive
                    #locales="routerLinkActive"
                    [isActive]="locales.isActive"
                  >
                    <ng-icon name="lucideLanguages" />
                    <span>{{ t('shell.locales') }}</span>
                  </a>
                </li>
                @if (auth.can('features.manage')) {
                  <li hlmSidebarMenuItem>
                    <a
                      hlmSidebarMenuButton
                      routerLink="/settings/features"
                      routerLinkActive
                      #features="routerLinkActive"
                      [isActive]="features.isActive"
                    >
                      <ng-icon name="lucidePuzzle" />
                      <span>{{ t('shell.features') }}</span>
                    </a>
                  </li>
                }
              </ul>
            </div>
          </div>
        </div>
        <div hlmSidebarFooter>
          <ul hlmSidebarMenu>
            <li hlmSidebarMenuItem>
              <button
                hlmSidebarMenuButton
                size="lg"
                [hlmDropdownMenuTrigger]="account"
                align="start"
                side="top"
              >
                <hlm-avatar size="sm">
                  <span hlmAvatarFallback class="bg-primary/10 text-primary text-xs font-medium">{{
                    initials()
                  }}</span>
                </hlm-avatar>
                <span class="flex min-w-0 flex-col text-start leading-tight">
                  <span class="truncate text-sm font-medium" data-testid="account-name">{{
                    displayName()
                  }}</span>
                  <span class="text-muted-foreground truncate text-xs">{{
                    auth.user()?.email
                  }}</span>
                </span>
                <ng-icon name="lucideChevronsUpDown" class="ms-auto" />
              </button>
              <ng-template #account>
                <hlm-dropdown-menu class="w-56">
                  <hlm-dropdown-menu-label
                    class="text-muted-foreground truncate text-xs font-normal"
                    >{{ auth.user()?.email }}</hlm-dropdown-menu-label
                  >
                  <hlm-dropdown-menu-separator />
                  <button hlmDropdownMenuItem (click)="openProfile()">
                    <ng-icon name="lucideUserRound" />
                    {{ t('account.menu') }}
                  </button>
                  <hlm-dropdown-menu-separator />
                  <button hlmDropdownMenuItem (click)="auth.logout()">
                    <ng-icon name="lucideLogOut" />
                    {{ t('shell.logout') }}
                  </button>
                </hlm-dropdown-menu>
              </ng-template>
            </li>
          </ul>
        </div>
      </hlm-sidebar>
      <main hlmSidebarInset>
        <header
          class="bg-background/80 supports-backdrop-filter:bg-background/60 sticky top-0 z-10 flex h-14 items-center gap-2 border-b px-4 backdrop-blur"
        >
          <button hlmSidebarTrigger [srOnlyText]="t('shell.toggleSidebar')"></button>
          <div class="ms-auto flex items-center gap-2">
            @if (schema.info(); as info) {
              <span
                hlmBadge
                variant="outline"
                class="hidden gap-1.5 font-normal sm:inline-flex"
                [title]="info.database"
              >
                <span
                  class="size-1.5 rounded-full"
                  [class.bg-amber-500]="info.mode === 'development'"
                  [class.bg-primary]="info.mode === 'production'"
                ></span>
                {{
                  t(
                    info.mode === 'development' ? 'shell.mode.development' : 'shell.mode.production'
                  )
                }}
                · v{{ info.version }}
              </span>
            }
            <vd-preferences-menu />
          </div>
        </header>
        <div class="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
          @if (auth.twoFactorPending()) {
            <!-- Only the profile works until the second factor is set up. -->
            <router-outlet />
          } @else if (error()) {
            <div hlmAlert variant="destructive">
              <p hlmAlertTitle>{{ t('shell.schemaError') }}</p>
              <p hlmAlertDescription>{{ error() }}</p>
            </div>
          } @else if (!schema.loaded()) {
            <hlm-spinner />
          } @else {
            <router-outlet />
          }
        </div>
      </main>
    </div>
  `,
})
export class Shell implements OnInit {
  protected readonly auth = inject(Auth);
  protected readonly schema = inject(Schema);
  protected readonly features = inject(Features);
  protected readonly unseen = inject(Unseen);
  private readonly extensions = inject(PluginExtensions);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  /** The sidebar sits at the start of the reading direction. */
  protected readonly sidebarSide = computed(() =>
    this.i18n.direction() === 'rtl' ? 'right' : 'left',
  );
  protected readonly error = signal<string | null>(null);

  protected readonly displayName = computed(() => {
    const user = this.auth.user();
    const name = [user?.firstname, user?.lastname].filter(Boolean).join(' ');
    return name || user?.email || '';
  });
  protected readonly initials = computed(() => {
    const user = this.auth.user();
    const parts = [user?.firstname, user?.lastname].filter((part): part is string => !!part);
    const letters = parts.length ? parts.map((part) => part[0]) : [user?.email?.[0] ?? '?'];
    return letters.join('').slice(0, 2).toUpperCase();
  });

  protected openProfile(): void {
    void this.router.navigateByUrl('/profile');
  }

  /** The unseen badge of a type, or `null` (none, or badges turned off). */
  protected badge(uid: string): string | null {
    return this.unseen.enabled() ? formatBadge(this.unseen.counts()[uid]) : null;
  }

  private started = false;

  constructor() {
    // While the admin's role waits for a second factor every other route is refused: load
    // the navigation once they have one.
    effect(() => {
      if (this.auth.twoFactorPending() || this.started) return;
      this.started = true;
      untracked(() => void this.start());
    });
  }

  ngOnInit(): void {
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        if (this.started) this.unseen.refresh();
      });
  }

  private async start(): Promise<void> {
    // Optional parts of the navigation; without the catalog they stay hidden.
    this.features.load().catch(() => undefined);
    // Plugin widgets and fields; failures leave them out.
    void this.extensions.load();
    this.unseen.start(this.destroyRef);
    try {
      await this.schema.load();
    } catch (error) {
      this.error.set(ApiFailure.from(error).message);
    }
  }
}
