import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { HlmSwitchImports } from '@spartan-ng/helm/switch';

import { ApiFailure, RUNTIME_CONFIG } from '../../core/api';
import { Auth } from '../../core/auth';
import { EmailTestResult, EndUsers } from '../../core/end-users';
import { Feature, Features } from '../../core/features';
import { I18n } from '../../core/i18n/i18n';
import { MessageKey } from '../../core/i18n/keys';
import { PageHeader } from '../../shared/components/page-header';
import {
  mcpCommand,
  mcpUrl,
  normalizeOrigin,
  readDisabled,
  readOrigins,
  readPreviewSettings,
  ssoFormsFrom,
} from '../../core/feature-settings';
import { GraphqlSettingsDialog } from './graphql-settings';
import { PreviewSettingsDialog } from './preview-settings';
import { SsoSettingsDialog } from './sso-settings';

const ICONS: Record<string, string> = {
  media: 'lucideImage',
  openapi: 'lucideBookOpen',
  graphql: 'lucideWaypoints',
  webhooks: 'lucideWebhook',
  i18n: 'lucideLanguages',
  history: 'lucideHistory',
  importer: 'lucideImport',
  users: 'lucideUsers',
  email: 'lucideMail',
  plugins: 'lucidePuzzle',
  sso: 'lucideKeyRound',
  audit: 'lucideScrollText',
  review: 'lucideListChecks',
  releases: 'lucideCalendarClock',
  preview: 'lucideEye',
  mcp: 'lucideBot',
  ai: 'lucideSparkles',
};

/** Settings → Features: switch optional parts of Verdin on and off, live. */
@Component({
  selector: 'vd-features',
  imports: [
    NgIcon,
    RouterLink,
    HlmAlertImports,
    HlmBadgeImports,
    HlmButtonImports,
    HlmDialogImports,
    HlmFieldImports,
    HlmInputImports,
    HlmSkeletonImports,
    HlmSpinnerImports,
    HlmSwitchImports,
    PageHeader,
    PreviewSettingsDialog,
    SsoSettingsDialog,
    GraphqlSettingsDialog,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-8">
      <vd-page-header [title]="t('features.title')" [description]="t('features.subtitle')">
        <span eyebrow class="text-primary flex items-center gap-1.5 text-xs font-medium">
          <ng-icon name="lucidePuzzle" size="14" /> {{ t('shell.settings') }}
        </span>
      </vd-page-header>

      @if (!canManage()) {
        <div hlmAlert>
          <ng-icon hlmAlertIcon name="lucideInfo" />
          <p hlmAlertDescription>{{ t('features.readOnly') }}</p>
        </div>
      }

      @if (features() === null) {
        <div class="grid gap-4 md:grid-cols-2">
          @for (row of [1, 2]; track row) {
            <hlm-skeleton class="h-36 rounded-xl" />
          }
        </div>
      } @else {
        <section class="flex flex-col gap-3">
          <h2 class="text-muted-foreground text-sm font-medium">
            {{ t('features.section.available') }}
          </h2>
          <div class="grid gap-4 md:grid-cols-2">
            @for (feature of available(); track feature.id) {
              <article
                class="bg-card flex flex-col gap-4 rounded-xl border p-5 transition-colors"
                [class.border-primary/40]="feature.enabled"
              >
                <header class="flex items-start gap-3">
                  <span
                    class="inline-flex size-10 shrink-0 items-center justify-center rounded-lg"
                    [class]="
                      feature.enabled
                        ? 'bg-primary/10 text-primary'
                        : 'bg-muted text-muted-foreground'
                    "
                  >
                    <ng-icon [name]="icon(feature.id)" size="20" />
                  </span>
                  <div class="flex min-w-0 flex-1 flex-col gap-1">
                    <h3 class="font-medium">{{ name(feature.id) }}</h3>
                    <p class="text-muted-foreground text-sm">{{ description(feature.id) }}</p>
                  </div>
                  <hlm-switch
                    [checked]="feature.enabled"
                    [disabled]="!canManage() || busy() === feature.id"
                    [aria-label]="t('features.toggle', { name: name(feature.id) })"
                    (checkedChange)="set(feature, $event, feature.settings)"
                  />
                </header>

                @if (feature.id === 'graphql' && feature.enabled) {
                  <div class="flex flex-col gap-3 border-t pt-4">
                    <p class="text-muted-foreground font-mono text-xs">
                      {{ t('features.graphql.endpoint', { path: graphqlUrl }) }}
                    </p>
                    @for (option of graphqlOptions; track option.key) {
                      <label class="flex items-start gap-3">
                        <hlm-switch
                          [aria-label]="t(option.label)"
                          [checked]="setting(feature, option.key, option.default)"
                          [disabled]="!canManage() || busy() === feature.id"
                          (checkedChange)="setOption(feature, option.key, $event)"
                        />
                        <span class="flex flex-col">
                          <span class="text-sm font-medium">{{ t(option.label) }}</span>
                          <span class="text-muted-foreground text-xs">{{ t(option.hint) }}</span>
                        </span>
                      </label>
                    }
                    <div class="flex flex-col gap-2">
                      <p class="text-muted-foreground text-xs">
                        {{
                          t('features.graphql.disabledSummary', { count: disabledCount(feature) })
                        }}
                      </p>
                      @if (canManage()) {
                        <button
                          hlmBtn
                          size="sm"
                          variant="outline"
                          class="self-start"
                          (click)="graphqlOpen.set(true)"
                        >
                          <ng-icon name="lucideSettings" /> {{ t('features.graphql.configure') }}
                        </button>
                      }
                    </div>
                    @if (setting(feature, 'playground', false)) {
                      <a
                        hlmBtn
                        size="sm"
                        variant="outline"
                        class="self-start"
                        [href]="graphqlUrl"
                        target="_blank"
                        rel="noopener"
                      >
                        <ng-icon name="lucideExternalLink" /> {{ t('features.graphql.open') }}
                      </a>
                    }
                  </div>
                }

                @if (feature.id === 'mcp' && feature.enabled) {
                  <div class="flex flex-col gap-4 border-t pt-4">
                    <div class="flex flex-col gap-1.5">
                      <span class="text-sm font-medium">{{ t('features.mcp.endpoint') }}</span>
                      <div class="flex items-center gap-1">
                        <code
                          dir="ltr"
                          class="bg-muted min-w-0 flex-1 truncate rounded px-2 py-1 font-mono text-xs"
                          data-mcp-url
                          >{{ mcpEndpoint }}</code
                        >
                        <button
                          hlmBtn
                          size="icon-xs"
                          variant="ghost"
                          type="button"
                          [attr.aria-label]="t('features.mcp.copyUrl')"
                          [title]="t('features.mcp.copyUrl')"
                          (click)="copy(mcpEndpoint)"
                        >
                          <ng-icon name="lucideCopy" />
                        </button>
                      </div>
                    </div>
                    <div class="flex flex-col gap-1.5">
                      <span class="text-sm font-medium">{{ t('features.mcp.claudeCode') }}</span>
                      <div class="relative">
                        <pre
                          dir="ltr"
                          class="bg-muted overflow-x-auto rounded-md p-3 pe-10 font-mono text-xs whitespace-pre-wrap break-all"
                          >{{ mcpSnippet }}</pre>
                        <button
                          hlmBtn
                          size="icon-xs"
                          variant="ghost"
                          type="button"
                          class="absolute end-1.5 top-1.5"
                          [attr.aria-label]="t('features.mcp.copyCommand')"
                          [title]="t('features.mcp.copyCommand')"
                          (click)="copy(mcpSnippet)"
                        >
                          <ng-icon name="lucideCopy" />
                        </button>
                      </div>
                      <p class="text-muted-foreground text-xs">
                        {{ t('features.mcp.tokenHint') }}
                        @if (canManageTokens()) {
                          <a class="text-primary hover:underline" routerLink="/settings/tokens">{{
                            t('features.mcp.tokens')
                          }}</a>
                        }
                      </p>
                    </div>
                    <div class="flex flex-col gap-2">
                      <span class="text-sm font-medium" id="mcp-origins-label">{{
                        t('features.mcp.origins')
                      }}</span>
                      <p class="text-muted-foreground text-xs">
                        {{ t('features.mcp.originsHint') }}
                      </p>
                      <ul class="flex flex-col gap-1" aria-labelledby="mcp-origins-label">
                        @for (origin of mcpOrigins(feature); track origin) {
                          <li
                            class="bg-muted/40 flex items-center gap-2 rounded-md border py-1 ps-3 pe-1"
                          >
                            <span dir="ltr" class="min-w-0 flex-1 truncate font-mono text-xs">{{
                              origin
                            }}</span>
                            @if (canManage()) {
                              <button
                                hlmBtn
                                size="icon-xs"
                                variant="ghost"
                                type="button"
                                [disabled]="busy() === feature.id"
                                [attr.aria-label]="t('features.mcp.removeOrigin', { origin })"
                                [title]="t('features.mcp.removeOrigin', { origin })"
                                (click)="removeOrigin(feature, origin)"
                              >
                                <ng-icon name="lucideX" />
                              </button>
                            }
                          </li>
                        } @empty {
                          <li class="text-muted-foreground text-xs">
                            {{ t('features.mcp.noOrigins') }}
                          </li>
                        }
                      </ul>
                      @if (canManage()) {
                        <form
                          class="flex items-start gap-2"
                          (submit)="$event.preventDefault(); addOrigin(feature)"
                        >
                          <div
                            hlmField
                            class="flex-1"
                            [attr.data-invalid]="originError() ? true : null"
                          >
                            <label hlmFieldLabel for="mcp-origin" class="sr-only">{{
                              t('features.mcp.origin')
                            }}</label>
                            <input
                              dir="ltr"
                              hlmInput
                              id="mcp-origin"
                              type="url"
                              autocomplete="off"
                              placeholder="https://app.example.com"
                              class="h-8 font-mono text-xs"
                              [attr.aria-invalid]="originError() ? true : null"
                              [attr.aria-describedby]="originError() ? 'mcp-origin-error' : null"
                              [value]="originDraft()"
                              (input)="
                                originDraft.set($any($event.target).value); originError.set(null)
                              "
                            />
                            @if (originError(); as message) {
                              <hlm-field-error forceShow id="mcp-origin-error">{{
                                message
                              }}</hlm-field-error>
                            }
                          </div>
                          <button
                            hlmBtn
                            size="sm"
                            variant="outline"
                            type="submit"
                            [disabled]="busy() === feature.id || !originDraft().trim()"
                          >
                            <ng-icon name="lucidePlus" /> {{ t('features.mcp.addOrigin') }}
                          </button>
                        </form>
                      }
                    </div>
                  </div>
                }

                @if (feature.id === 'webhooks' && feature.enabled && canManageWebhooks()) {
                  <div class="flex flex-col gap-3 border-t pt-4">
                    <p class="text-muted-foreground text-xs">{{ t('features.webhooks.hint') }}</p>
                    <a
                      hlmBtn
                      size="sm"
                      variant="outline"
                      class="self-start"
                      routerLink="/settings/webhooks"
                    >
                      <ng-icon name="lucideWebhook" /> {{ t('features.webhooks.open') }}
                    </a>
                  </div>
                }

                @if (feature.id === 'users' && canManageEndUsers()) {
                  <div class="flex flex-col gap-3 border-t pt-4">
                    <p class="text-muted-foreground text-xs">{{ t('features.users.hint') }}</p>
                    <a
                      hlmBtn
                      size="sm"
                      variant="outline"
                      class="self-start"
                      routerLink="/settings/end-users/settings"
                    >
                      <ng-icon name="lucideContactRound" /> {{ t('features.users.open') }}
                    </a>
                  </div>
                }

                @if (feature.id === 'openapi' && feature.enabled) {
                  <div class="flex flex-col gap-3 border-t pt-4">
                    <label class="flex items-start gap-3">
                      <hlm-switch
                        [aria-label]="t('features.openapi.public')"
                        [checked]="!!feature.settings?.['public']"
                        [disabled]="!canManage() || busy() === feature.id"
                        (checkedChange)="
                          set(feature, true, { ...(feature.settings ?? {}), public: $event })
                        "
                      />
                      <span class="flex flex-col">
                        <span class="text-sm font-medium">{{ t('features.openapi.public') }}</span>
                        <span class="text-muted-foreground text-xs">{{
                          t('features.openapi.publicHint')
                        }}</span>
                      </span>
                    </label>
                    @if (feature.settings?.['public']) {
                      <div class="flex flex-wrap gap-2">
                        <a
                          hlmBtn
                          size="sm"
                          variant="outline"
                          [href]="docsUrl"
                          target="_blank"
                          rel="noopener"
                        >
                          <ng-icon name="lucideExternalLink" /> {{ t('features.openapi.open') }}
                        </a>
                        <a
                          hlmBtn
                          size="sm"
                          variant="ghost"
                          [href]="documentUrl"
                          target="_blank"
                          rel="noopener"
                        >
                          <ng-icon name="lucideDownload" /> {{ t('features.openapi.download') }}
                        </a>
                      </div>
                    }
                  </div>
                }

                @if (feature.id === 'preview' && canManage()) {
                  <div class="flex flex-col gap-3 border-t pt-4">
                    <p class="text-muted-foreground text-xs">
                      {{ t('features.preview.summary', { count: previewCount(feature) }) }}
                    </p>
                    <button
                      hlmBtn
                      size="sm"
                      variant="outline"
                      class="self-start"
                      (click)="previewOpen.set(true)"
                    >
                      <ng-icon name="lucideSettings" /> {{ t('features.preview.configure') }}
                    </button>
                  </div>
                }

                @if (feature.id === 'sso' && canManage()) {
                  <div class="flex flex-col gap-3 border-t pt-4">
                    <p class="text-muted-foreground text-xs">
                      {{ t('features.sso.summary', { count: ssoCount(feature) }) }}
                    </p>
                    <button
                      hlmBtn
                      size="sm"
                      variant="outline"
                      class="self-start"
                      (click)="ssoOpen.set(true)"
                    >
                      <ng-icon name="lucideSettings" /> {{ t('features.sso.configure') }}
                    </button>
                  </div>
                }

                @if (feature.id === 'audit' && canReadAudit()) {
                  <div class="flex flex-col gap-3 border-t pt-4">
                    <a
                      hlmBtn
                      size="sm"
                      variant="outline"
                      class="self-start"
                      routerLink="/settings/audit-logs"
                    >
                      <ng-icon name="lucideScrollText" /> {{ t('features.audit.open') }}
                    </a>
                  </div>
                }

                @if (feature.id === 'review' && feature.enabled && canManageWorkflows()) {
                  <div class="flex flex-col gap-3 border-t pt-4">
                    <a
                      hlmBtn
                      size="sm"
                      variant="outline"
                      class="self-start"
                      routerLink="/settings/review-workflows"
                    >
                      <ng-icon name="lucideListChecks" /> {{ t('features.review.open') }}
                    </a>
                  </div>
                }

                @if (feature.id === 'releases' && feature.enabled && canManageReleases()) {
                  <div class="flex flex-col gap-3 border-t pt-4">
                    <a hlmBtn size="sm" variant="outline" class="self-start" routerLink="/releases">
                      <ng-icon name="lucideCalendarClock" /> {{ t('features.releases.open') }}
                    </a>
                  </div>
                }
              </article>
            }
          </div>
        </section>

        @if (core().length) {
          <section class="flex flex-col gap-3">
            <h2 class="text-muted-foreground text-sm font-medium">
              {{ t('features.section.core') }}
            </h2>
            <div class="grid gap-4 md:grid-cols-2">
              @for (feature of core(); track feature.id) {
                <article class="bg-card flex flex-col gap-4 rounded-xl border p-5">
                  <header class="flex items-start gap-3">
                    <span
                      class="bg-primary/10 text-primary inline-flex size-10 shrink-0 items-center justify-center rounded-lg"
                    >
                      <ng-icon [name]="icon(feature.id)" size="20" />
                    </span>
                    <div class="flex min-w-0 flex-1 flex-col gap-1">
                      <h3 class="font-medium">{{ name(feature.id) }}</h3>
                      <p class="text-muted-foreground text-sm">{{ description(feature.id) }}</p>
                    </div>
                    <span hlmBadge variant="secondary">{{ t('features.core') }}</span>
                  </header>
                  @if (feature.id === 'email' && canManage()) {
                    <div class="flex flex-col gap-3 border-t pt-4">
                      <p class="text-muted-foreground text-xs">{{ t('features.email.hint') }}</p>
                      <button
                        hlmBtn
                        size="sm"
                        variant="outline"
                        class="self-start"
                        (click)="openEmailTest()"
                      >
                        <ng-icon name="lucideSend" /> {{ t('features.email.test') }}
                      </button>
                    </div>
                  }
                </article>
              }
            </div>
          </section>
        }

        <section class="flex flex-col gap-3">
          <h2 class="text-muted-foreground text-sm font-medium">
            {{ t('features.section.planned') }}
          </h2>
          <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            @for (feature of planned(); track feature.id) {
              <article class="flex items-start gap-3 rounded-xl border border-dashed p-4">
                <span
                  class="bg-muted text-muted-foreground inline-flex size-9 shrink-0 items-center justify-center rounded-lg"
                >
                  <ng-icon [name]="icon(feature.id)" size="18" />
                </span>
                <div class="flex min-w-0 flex-1 flex-col gap-1">
                  <div class="flex items-center gap-2">
                    <h3 class="text-sm font-medium">{{ name(feature.id) }}</h3>
                    @if (feature.planned) {
                      <span hlmBadge variant="outline" class="font-normal">
                        {{ t('features.planned', { version: feature.planned }) }}
                      </span>
                    }
                  </div>
                  <p class="text-muted-foreground text-xs">{{ description(feature.id) }}</p>
                </div>
              </article>
            }
          </div>
        </section>
      }
    </div>

    @if (featureById('preview'); as preview) {
      <vd-preview-settings
        [open]="previewOpen()"
        [feature]="preview"
        (closed)="previewOpen.set(false)"
      />
    }
    @if (featureById('graphql'); as graphql) {
      <vd-graphql-settings
        [open]="graphqlOpen()"
        [feature]="graphql"
        (closed)="graphqlOpen.set(false)"
      />
    }
    @if (featureById('sso'); as sso) {
      <vd-sso-settings [open]="ssoOpen()" [feature]="sso" (closed)="ssoOpen.set(false)" />
    }

    <hlm-dialog [state]="emailTest() ? 'open' : 'closed'" (closed)="emailTest.set(null)">
      <hlm-dialog-content *hlmDialogPortal="let ctx" class="sm:max-w-md">
        @if (emailTest(); as test) {
          <hlm-dialog-header>
            <h2 hlmDialogTitle>{{ t('features.email.testTitle') }}</h2>
            <p hlmDialogDescription>{{ t('features.email.testDescription') }}</p>
          </hlm-dialog-header>
          <div class="flex flex-col gap-4">
            <div hlmField>
              <label hlmFieldLabel for="email-test-to">{{ t('features.email.to') }}</label>
              <input
                dir="ltr"
                hlmInput
                id="email-test-to"
                type="email"
                autocomplete="email"
                [value]="test.to"
                (input)="emailTest.set({ to: $any($event.target).value })"
                (keydown.enter)="sendTestEmail()"
              />
            </div>
            @if (emailResult(); as result) {
              <div hlmAlert [variant]="result.sent ? 'default' : 'destructive'">
                <ng-icon
                  hlmAlertIcon
                  [name]="result.sent ? 'lucideCircleCheck' : 'lucideCircleAlert'"
                />
                <p hlmAlertTitle>
                  {{ result.sent ? t('features.email.sent') : t('features.email.notSent') }}
                </p>
                <div hlmAlertDescription class="flex flex-col gap-1">
                  <span>{{ t('features.email.provider', { provider: result.provider }) }}</span>
                  @if (result.from) {
                    <span>{{ t('features.email.from', { from: result.from }) }}</span>
                  }
                  @if (result.error) {
                    <span class="font-mono text-xs break-all">{{ result.error }}</span>
                  }
                  @if (result.provider === 'log') {
                    <span>{{ t('features.email.logHint') }}</span>
                  }
                </div>
              </div>
            }
            <p class="text-muted-foreground text-xs">{{ t('features.email.configHint') }}</p>
          </div>
          <hlm-dialog-footer>
            <button hlmBtn variant="outline" (click)="emailTest.set(null)">
              {{ t('common.close') }}
            </button>
            <button hlmBtn [disabled]="sending() || !test.to.trim()" (click)="sendTestEmail()">
              @if (sending()) {
                <hlm-spinner class="size-4" />
              } @else {
                <ng-icon name="lucideSend" />
              }
              {{ t('features.email.send') }}
            </button>
          </hlm-dialog-footer>
        }
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class FeaturesPage implements OnInit {
  private readonly catalog = inject(Features);
  private readonly auth = inject(Auth);
  private readonly config = inject(RUNTIME_CONFIG);
  private readonly endUsers = inject(EndUsers);
  protected readonly t = inject(I18n).t;

  protected readonly features = this.catalog.catalog;
  protected readonly busy = signal<string | null>(null);
  protected readonly canManage = computed(() => this.auth.can('features.manage'));
  protected readonly canManageWebhooks = computed(() => this.auth.can('webhooks.manage'));
  protected readonly canManageEndUsers = computed(() => this.auth.can('endusers.manage'));
  protected readonly canReadAudit = computed(() => this.auth.can('audit.read'));
  protected readonly canManageReleases = computed(() => this.auth.can('releases.manage'));
  protected readonly canManageWorkflows = computed(() => this.auth.can('workflows.manage'));
  protected readonly previewOpen = signal(false);
  protected readonly ssoOpen = signal(false);
  protected readonly graphqlOpen = signal(false);
  protected readonly canManageTokens = computed(() => this.auth.can('tokens.manage'));
  protected readonly originDraft = signal('');
  protected readonly originError = signal<string | null>(null);
  /** The test email dialog: `null` when closed. */
  protected readonly emailTest = signal<{ to: string } | null>(null);
  protected readonly emailResult = signal<EmailTestResult | null>(null);
  protected readonly sending = signal(false);
  protected readonly available = computed(() =>
    (this.features() ?? []).filter((feature) => feature.available && !feature.core),
  );
  protected readonly core = computed(() =>
    (this.features() ?? []).filter((feature) => feature.core),
  );
  protected readonly planned = computed(() =>
    (this.features() ?? []).filter((feature) => !feature.available),
  );

  protected readonly graphqlUrl = '/graphql';
  protected readonly graphqlOptions: {
    key: string;
    default: boolean;
    label: MessageKey;
    hint: MessageKey;
  }[] = [
    {
      key: 'playground',
      default: false,
      label: 'features.graphql.playground',
      hint: 'features.graphql.playgroundHint',
    },
    {
      key: 'introspection',
      default: true,
      label: 'features.graphql.introspection',
      hint: 'features.graphql.introspectionHint',
    },
  ];

  protected setOption(feature: Feature, key: string, value: boolean): void {
    void this.set(feature, true, { ...(feature.settings ?? {}), [key]: value });
  }

  protected setting(feature: Feature, key: string, fallback: boolean): boolean {
    const value = feature.settings?.[key];
    return typeof value === 'boolean' ? value : fallback;
  }

  protected readonly docsUrl = `${this.config.contentApiBase}/docs`;
  protected readonly mcpEndpoint = mcpUrl(this.config.contentApiBase, location.origin);
  protected readonly mcpSnippet = mcpCommand(this.mcpEndpoint);

  protected disabledCount(feature: Feature): number {
    return Object.keys(readDisabled(feature.settings)).length;
  }

  protected mcpOrigins(feature: Feature): string[] {
    return readOrigins(feature.settings);
  }

  protected async addOrigin(feature: Feature): Promise<void> {
    const origin = normalizeOrigin(this.originDraft());
    if (!origin) {
      this.originError.set(this.t('features.mcp.invalidOrigin'));
      return;
    }
    const origins = this.mcpOrigins(feature);
    if (origins.includes(origin)) {
      this.originError.set(this.t('features.mcp.duplicateOrigin'));
      return;
    }
    const saved = this.t('features.settingsSaved', { name: this.name(feature.id) });
    const settings = { ...(feature.settings ?? {}), allowedOrigins: [...origins, origin] };
    if (await this.set(feature, feature.enabled, settings, saved)) this.originDraft.set('');
  }

  protected removeOrigin(feature: Feature, origin: string): void {
    void this.set(
      feature,
      feature.enabled,
      {
        ...(feature.settings ?? {}),
        allowedOrigins: this.mcpOrigins(feature).filter((item) => item !== origin),
      },
      this.t('features.settingsSaved', { name: this.name(feature.id) }),
    );
  }

  protected async copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(this.t('common.copied'));
    } catch {
      toast.error(this.t('features.mcp.copyFailed'));
    }
  }
  protected readonly documentUrl = `${this.config.contentApiBase}/_openapi.json`;

  async ngOnInit(): Promise<void> {
    try {
      await this.catalog.load();
    } catch (error) {
      this.features.set([]);
      toast.error(ApiFailure.from(error).message);
    }
  }

  protected openEmailTest(): void {
    this.emailResult.set(null);
    this.emailTest.set({ to: this.auth.user()?.email ?? '' });
  }

  protected async sendTestEmail(): Promise<void> {
    const to = this.emailTest()?.to.trim();
    if (!to || this.sending()) return;
    this.sending.set(true);
    this.emailResult.set(null);
    try {
      const result = await this.endUsers.testEmail(to);
      this.emailResult.set(result);
      if (result.sent) toast.success(this.t('features.email.sentTo', { to }));
    } catch (error) {
      const failure = ApiFailure.from(error);
      toast.error(
        failure.status === 404 ? this.t('features.email.notConfigured') : failure.message,
      );
    } finally {
      this.sending.set(false);
    }
  }

  protected featureById(id: string): Feature | null {
    return (this.features() ?? []).find((feature) => feature.id === id) ?? null;
  }

  protected previewCount(feature: Feature): number {
    return Object.keys(readPreviewSettings(feature.settings).urls).length;
  }

  protected ssoCount(feature: Feature): number {
    return ssoFormsFrom(feature.settings).length;
  }

  protected icon(id: string): string {
    return ICONS[id] ?? 'lucidePuzzle';
  }

  protected name(id: string): string {
    return this.t(`features.${id}.name` as MessageKey);
  }

  protected description(id: string): string {
    return this.t(`features.${id}.description` as MessageKey);
  }

  protected async set(
    feature: Feature,
    enabled: boolean,
    settings: Record<string, unknown> | null,
    saved?: string,
  ): Promise<boolean> {
    this.busy.set(feature.id);
    try {
      await this.catalog.update(feature.id, enabled, settings);
      toast.success(
        saved ?? this.t(enabled ? 'features.on' : 'features.off', { name: this.name(feature.id) }),
      );
      return true;
    } catch (error) {
      toast.error(this.t('features.failed', { name: this.name(feature.id) }), {
        description: ApiFailure.from(error).message,
      });
      // Put the switch back.
      this.features.update((list) => (list ? [...list] : list));
      return false;
    } finally {
      this.busy.set(null);
    }
  }
}
