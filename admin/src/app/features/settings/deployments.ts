import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { HlmTableImports } from '@spartan-ng/helm/table';
import { HlmTabsImports } from '@spartan-ng/helm/tabs';

import { ApiFailure } from '../../core/api';
import { Auth } from '../../core/auth';
import {
  CALLBACK_PROVIDERS,
  CallbackProvider,
  CdnProvider,
  CdnStatus,
  DeployTarget,
  Deployment,
  DeploymentPoller,
  Deploys,
  genericCallback,
  inProgress,
  validHookUrl,
} from '../../core/deploy';
import { I18n } from '../../core/i18n/i18n';
import { MessageKey } from '../../core/i18n/keys';
import { DeployStatusBadge } from '../../shared/components/deploy-status';
import { PageHeader } from '../../shared/components/page-header';

/** The target dialog: `id` is `null` for a new target. */
interface TargetForm {
  id: number | null;
  name: string;
  url: string;
  /** Editing: the current hook's host, kept unless `replaceUrl`. */
  host: string;
  replaceUrl: boolean;
}

const PROVIDER_LABELS: Record<CdnProvider, MessageKey> = {
  none: 'deploy.cdn.provider.none',
  cloudflare: 'deploy.cdn.provider.cloudflare',
  fastly: 'deploy.cdn.provider.fastly',
  webhook: 'deploy.cdn.provider.webhook',
};

const CALLBACK_LABELS: Record<CallbackProvider, { label: MessageKey; hint: MessageKey }> = {
  netlify: { label: 'deploy.callback.netlify', hint: 'deploy.callback.netlifyHint' },
  vercel: { label: 'deploy.callback.vercel', hint: 'deploy.callback.vercelHint' },
  generic: { label: 'deploy.callback.generic', hint: 'deploy.callback.genericHint' },
};

/** Settings → Deployments: build hooks behind the Deploy button, their history, and the CDN. */
@Component({
  selector: 'vd-deployments',
  imports: [
    NgIcon,
    DeployStatusBadge,
    HlmAlertImports,
    HlmAlertDialogImports,
    HlmBadgeImports,
    HlmButtonImports,
    HlmDialogImports,
    HlmEmptyImports,
    HlmFieldImports,
    HlmInputImports,
    HlmNativeSelectImports,
    HlmSkeletonImports,
    HlmSpinnerImports,
    HlmTableImports,
    HlmTabsImports,
    PageHeader,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-6">
      <vd-page-header [title]="t('deploy.title')" [description]="t('deploy.description')">
        <span eyebrow class="text-primary flex items-center gap-1.5 text-xs font-medium">
          <ng-icon name="lucideRocket" size="14" /> {{ t('shell.settings') }}
        </span>
        @if (canManage() && !error()) {
          <div actions>
            <button hlmBtn (click)="openCreate()">
              <ng-icon name="lucidePlus" /> {{ t('deploy.addTarget') }}
            </button>
          </div>
        }
      </vd-page-header>

      @if (!canManage()) {
        <div hlmAlert>
          <ng-icon hlmAlertIcon name="lucideInfo" />
          <p hlmAlertDescription>{{ t('deploy.forbidden') }}</p>
        </div>
      } @else if (error()) {
        <div hlmAlert variant="destructive">
          <ng-icon hlmAlertIcon name="lucideCircleAlert" />
          <p hlmAlertTitle>{{ t('deploy.loadError') }}</p>
          <p hlmAlertDescription>{{ error() }}</p>
        </div>
      } @else if (targets() === null) {
        <hlm-skeleton class="h-48 rounded-xl" />
      } @else {
        <section class="flex flex-col gap-3" aria-labelledby="deploy-targets-title">
          <div class="flex flex-col gap-0.5">
            <h2 id="deploy-targets-title" class="font-medium">{{ t('deploy.targets') }}</h2>
            <p class="text-muted-foreground text-sm">{{ t('deploy.targetsHint') }}</p>
          </div>
          @if (targets()!.length === 0) {
            <div hlmEmpty class="rounded-xl border border-dashed py-12">
              <div hlmEmptyHeader>
                <div hlmEmptyMedia variant="icon"><ng-icon name="lucideRocket" /></div>
                <h3 hlmEmptyTitle>{{ t('deploy.emptyTitle') }}</h3>
                <p hlmEmptyDescription>{{ t('deploy.emptyHint') }}</p>
              </div>
              <div hlmEmptyContent>
                <button hlmBtn variant="outline" (click)="openCreate()">
                  <ng-icon name="lucidePlus" /> {{ t('deploy.addTarget') }}
                </button>
              </div>
            </div>
          } @else {
            <div class="bg-card overflow-hidden rounded-xl border">
              <div hlmTableContainer>
                <table hlmTable>
                  <thead hlmTHead class="bg-muted/50">
                    <tr hlmTr class="hover:bg-transparent">
                      <th hlmTh class="ps-4">{{ t('deploy.column.target') }}</th>
                      <th hlmTh>{{ t('deploy.column.lastDeploy') }}</th>
                      <th hlmTh class="pe-4">
                        <span class="sr-only">{{ t('common.actions') }}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody hlmTBody>
                    @for (target of targets(); track target.id) {
                      <tr hlmTr data-deploy-target>
                        <td hlmTd class="ps-4">
                          <div class="flex items-center gap-3">
                            <span
                              class="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-lg"
                            >
                              <ng-icon name="lucideRocket" size="16" />
                            </span>
                            <span class="flex min-w-0 flex-col">
                              <span class="font-medium">{{ target.name }}</span>
                              <span dir="ltr" class="text-muted-foreground font-mono text-xs">{{
                                target.host
                              }}</span>
                            </span>
                          </div>
                        </td>
                        <td hlmTd>
                          <div class="flex flex-wrap items-center gap-2">
                            <vd-deploy-status [status]="target.lastDeployment?.status" />
                            @if (target.lastDeployment; as last) {
                              <span
                                class="text-muted-foreground text-xs"
                                [attr.title]="i18n.formatDate(last.createdAt, 'long')"
                                >{{ i18n.formatRelative(last.createdAt) }}</span
                              >
                            }
                          </div>
                        </td>
                        <td hlmTd class="pe-4">
                          <div class="flex justify-end gap-1">
                            <button
                              hlmBtn
                              size="sm"
                              variant="outline"
                              [disabled]="deploying() === target.id"
                              [attr.aria-label]="t('deploy.deployLabel', { name: target.name })"
                              (click)="deploy(target)"
                            >
                              @if (deploying() === target.id) {
                                <hlm-spinner class="size-4" />
                              } @else {
                                <ng-icon name="lucideRocket" />
                              }
                              {{ t('deploy.deployNow') }}
                            </button>
                            @if (target.callbackPath) {
                              <button
                                hlmBtn
                                size="icon-sm"
                                variant="ghost"
                                class="text-muted-foreground"
                                [attr.aria-label]="t('deploy.callbackLabel', { name: target.name })"
                                [attr.title]="t('deploy.callback.title')"
                                (click)="callback.set(target)"
                              >
                                <ng-icon name="lucideLink" />
                              </button>
                            }
                            <button
                              hlmBtn
                              size="icon-sm"
                              variant="ghost"
                              class="text-muted-foreground"
                              [attr.aria-label]="t('deploy.editLabel', { name: target.name })"
                              [attr.title]="t('common.edit')"
                              (click)="openEdit(target)"
                            >
                              <ng-icon name="lucidePencil" />
                            </button>
                            <hlm-alert-dialog>
                              <button
                                hlmAlertDialogTrigger
                                hlmBtn
                                size="icon-sm"
                                variant="ghost"
                                class="text-muted-foreground hover:text-destructive"
                                [attr.aria-label]="t('deploy.deleteLabel', { name: target.name })"
                                [attr.title]="t('common.delete')"
                              >
                                <ng-icon name="lucideTrash2" />
                              </button>
                              <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx">
                                <hlm-alert-dialog-header>
                                  <h2 hlmAlertDialogTitle>
                                    {{ t('deploy.deleteTitle', { name: target.name }) }}
                                  </h2>
                                  <p hlmAlertDialogDescription>{{ t('deploy.deleteHint') }}</p>
                                </hlm-alert-dialog-header>
                                <hlm-alert-dialog-footer>
                                  <button hlmAlertDialogCancel (click)="ctx.close()">
                                    {{ t('common.cancel') }}
                                  </button>
                                  <button
                                    hlmAlertDialogAction
                                    variant="destructive"
                                    (click)="ctx.close(); remove(target)"
                                  >
                                    {{ t('common.delete') }}
                                  </button>
                                </hlm-alert-dialog-footer>
                              </hlm-alert-dialog-content>
                            </hlm-alert-dialog>
                          </div>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </div>
          }
        </section>

        <section class="bg-card overflow-hidden rounded-xl border" aria-labelledby="deploy-log">
          <header class="flex flex-wrap items-end gap-3 border-b px-4 py-3">
            <div class="flex min-w-0 flex-col">
              <h2 id="deploy-log" class="font-medium">{{ t('deploy.history.title') }}</h2>
              <p class="text-muted-foreground text-xs">{{ t('deploy.history.hint') }}</p>
            </div>
            <div class="ms-auto flex items-end gap-2">
              <div hlmField class="w-48">
                <label hlmFieldLabel for="deploy-history-target" class="sr-only">{{
                  t('deploy.history.filter')
                }}</label>
                <hlm-native-select
                  selectId="deploy-history-target"
                  size="sm"
                  [value]="historyTarget()"
                  (valueChange)="setHistoryTarget($event ?? '')"
                >
                  <option hlmNativeSelectOption value="">
                    {{ t('deploy.history.allTargets') }}
                  </option>
                  @for (target of targets(); track target.id) {
                    <option hlmNativeSelectOption [value]="'' + target.id">
                      {{ target.name }}
                    </option>
                  }
                </hlm-native-select>
              </div>
              <button
                hlmBtn
                variant="outline"
                size="sm"
                [disabled]="historyLoading()"
                (click)="loadHistory()"
              >
                @if (historyLoading()) {
                  <hlm-spinner class="size-4" />
                } @else {
                  <ng-icon name="lucideRefreshCw" />
                }
                {{ t('deploy.history.refresh') }}
              </button>
            </div>
          </header>
          @if (history().length === 0) {
            <p class="text-muted-foreground px-4 py-8 text-center text-sm">
              {{ t('deploy.history.empty') }}
            </p>
          } @else {
            <div hlmTableContainer class="max-h-[28rem] overflow-y-auto">
              <table hlmTable>
                <thead hlmTHead class="bg-muted/50">
                  <tr hlmTr class="hover:bg-transparent">
                    <th hlmTh class="ps-4">{{ t('deploy.column.when') }}</th>
                    <th hlmTh>{{ t('deploy.column.target') }}</th>
                    <th hlmTh>{{ t('deploy.column.status') }}</th>
                    <th hlmTh>{{ t('deploy.column.http') }}</th>
                    <th hlmTh class="pe-4">{{ t('deploy.column.message') }}</th>
                  </tr>
                </thead>
                <tbody hlmTBody>
                  @for (deployment of history(); track deployment.id) {
                    <tr hlmTr>
                      <td hlmTd class="ps-4 whitespace-nowrap">
                        <span [attr.title]="i18n.formatDate(deployment.createdAt, 'long')">{{
                          i18n.formatDate(deployment.createdAt)
                        }}</span>
                      </td>
                      <td hlmTd>{{ targetName(deployment.targetId) }}</td>
                      <td hlmTd><vd-deploy-status [status]="deployment.status" /></td>
                      <td hlmTd class="font-mono text-xs tabular-nums">
                        {{ deployment.httpStatus ?? '—' }}
                      </td>
                      <td hlmTd class="pe-4">
                        <div class="flex max-w-md flex-col gap-0.5">
                          @if (deployment.message) {
                            <span
                              class="text-muted-foreground truncate text-xs"
                              [title]="deployment.message"
                              >{{ deployment.message }}</span
                            >
                          }
                          @if (deployment.url) {
                            <a
                              dir="ltr"
                              class="text-primary truncate text-xs hover:underline"
                              [href]="deployment.url"
                              target="_blank"
                              rel="noopener"
                              >{{ deployment.url }}</a
                            >
                          }
                          @if (!deployment.message && !deployment.url) {
                            <span class="text-muted-foreground">—</span>
                          }
                        </div>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </section>

        <section
          class="bg-card flex flex-col gap-4 rounded-xl border p-5"
          aria-labelledby="cdn-title"
        >
          <header class="flex flex-wrap items-start gap-3">
            <span
              class="bg-muted text-muted-foreground inline-flex size-10 shrink-0 items-center justify-center rounded-lg"
            >
              <ng-icon name="lucideCloud" size="20" />
            </span>
            <div class="flex min-w-0 flex-1 flex-col gap-1">
              <h2 id="cdn-title" class="font-medium">{{ t('deploy.cdn.title') }}</h2>
              <p class="text-muted-foreground text-sm">{{ t('deploy.cdn.hint') }}</p>
            </div>
            @if (cdn(); as cdn) {
              <span hlmBadge [variant]="cdn.provider === 'none' ? 'outline' : 'secondary'">
                {{ t('deploy.cdn.provider', { provider: t(providerLabels[cdn.provider]) }) }}
              </span>
            }
          </header>
          @if (cdn(); as cdn) {
            @if (cdn.provider === 'none') {
              <p class="text-muted-foreground text-sm">{{ t('deploy.cdn.notConfigured') }}</p>
            } @else {
              <div class="flex flex-col gap-2">
                <h3 class="text-sm font-medium">{{ t('deploy.cdn.recent') }}</h3>
                <ul class="flex flex-col gap-1.5">
                  @for (purge of cdn.recent; track $index) {
                    <li
                      class="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm"
                    >
                      <span hlmBadge [variant]="purge.ok ? 'default' : 'destructive'">
                        <ng-icon
                          [name]="purge.ok ? 'lucideCircleCheck' : 'lucideCircleX'"
                          aria-hidden="true"
                        />
                        {{ purge.ok ? t('deploy.cdn.ok') : t('deploy.cdn.failed') }}
                      </span>
                      <span
                        class="text-muted-foreground text-xs"
                        [title]="i18n.formatDate(purge.at, 'long')"
                        >{{ i18n.formatRelative(purge.at) }}</span
                      >
                      <span
                        dir="ltr"
                        class="min-w-0 flex-1 truncate font-mono text-xs"
                        [title]="purge.tags.join(', ')"
                        >{{ purge.tags.join(', ') }}</span
                      >
                      @if (purge.message) {
                        <span class="text-muted-foreground w-full text-xs break-all">{{
                          purge.message
                        }}</span>
                      }
                    </li>
                  } @empty {
                    <li class="text-muted-foreground text-sm">{{ t('deploy.cdn.noPurges') }}</li>
                  }
                </ul>
              </div>
              <hlm-alert-dialog>
                <button
                  hlmAlertDialogTrigger
                  hlmBtn
                  variant="outline"
                  size="sm"
                  class="self-start"
                  [disabled]="purging()"
                >
                  @if (purging()) {
                    <hlm-spinner class="size-4" />
                  } @else {
                    <ng-icon name="lucideRefreshCw" />
                  }
                  {{ t('deploy.cdn.purgeAll') }}
                </button>
                <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx">
                  <hlm-alert-dialog-header>
                    <h2 hlmAlertDialogTitle>{{ t('deploy.cdn.purgeTitle') }}</h2>
                    <p hlmAlertDialogDescription>{{ t('deploy.cdn.purgeHint') }}</p>
                  </hlm-alert-dialog-header>
                  <hlm-alert-dialog-footer>
                    <button hlmAlertDialogCancel (click)="ctx.close()">
                      {{ t('common.cancel') }}
                    </button>
                    <button hlmAlertDialogAction (click)="ctx.close(); purge()">
                      {{ t('deploy.cdn.purgeAll') }}
                    </button>
                  </hlm-alert-dialog-footer>
                </hlm-alert-dialog-content>
              </hlm-alert-dialog>
            }
          } @else if (cdnError()) {
            <p class="text-destructive text-sm">{{ cdnError() }}</p>
          } @else {
            <hlm-skeleton class="h-16 rounded-lg" />
          }
        </section>
      }
    </div>

    <hlm-dialog [state]="form() ? 'open' : 'closed'" (closed)="form.set(null)">
      <hlm-dialog-content
        *hlmDialogPortal="let ctx"
        class="sm:max-w-lg"
        [closeLabel]="t('common.close')"
      >
        @if (form(); as draft) {
          <hlm-dialog-header>
            <h2 hlmDialogTitle>
              {{ draft.id === null ? t('deploy.form.createTitle') : t('deploy.form.editTitle') }}
            </h2>
            <p hlmDialogDescription>{{ t('deploy.form.description') }}</p>
          </hlm-dialog-header>
          <form
            id="deploy-target-form"
            class="flex flex-col gap-4"
            novalidate
            (submit)="$event.preventDefault(); save()"
          >
            <div hlmField [attr.data-invalid]="showErrors() && nameProblem() ? true : null">
              <label hlmFieldLabel for="deploy-target-name">{{ t('deploy.form.name') }}</label>
              <input
                hlmInput
                id="deploy-target-name"
                autocomplete="off"
                maxlength="255"
                [placeholder]="t('deploy.form.namePlaceholder')"
                [attr.aria-invalid]="showErrors() && nameProblem() ? true : null"
                [attr.aria-describedby]="showErrors() && nameProblem() ? 'deploy-name-error' : null"
                [value]="draft.name"
                (input)="patch({ name: $any($event.target).value })"
              />
              @if (showErrors() && nameProblem()) {
                <hlm-field-error forceShow id="deploy-name-error">{{
                  t('deploy.form.nameRequired')
                }}</hlm-field-error>
              }
            </div>
            @if (draft.id !== null && !draft.replaceUrl) {
              <div hlmField>
                <span hlmFieldLabel>{{ t('deploy.form.url') }}</span>
                <div class="flex items-center gap-2">
                  <code
                    dir="ltr"
                    class="bg-muted min-w-0 flex-1 truncate rounded px-2 py-1.5 font-mono text-xs"
                    >{{ t('deploy.form.currentHost', { host: draft.host }) }}</code
                  >
                  <button hlmBtn type="button" variant="outline" size="sm" (click)="replaceUrl()">
                    <ng-icon name="lucideReplace" /> {{ t('deploy.form.replaceUrl') }}
                  </button>
                </div>
                <p class="text-muted-foreground text-xs">{{ t('deploy.form.secretHint') }}</p>
              </div>
            } @else {
              <div hlmField [attr.data-invalid]="showErrors() && urlProblem() ? true : null">
                <label hlmFieldLabel for="deploy-target-url">{{ t('deploy.form.url') }}</label>
                <input
                  hlmInput
                  dir="ltr"
                  id="deploy-target-url"
                  type="url"
                  autocomplete="off"
                  spellcheck="false"
                  class="font-mono text-xs"
                  placeholder="https://api.netlify.com/build_hooks/…"
                  [attr.aria-invalid]="showErrors() && urlProblem() ? true : null"
                  aria-describedby="deploy-url-hint"
                  [value]="draft.url"
                  (input)="patch({ url: $any($event.target).value })"
                />
                <p class="text-muted-foreground text-xs" id="deploy-url-hint">
                  {{ t('deploy.form.urlHint') }}
                </p>
                @if (showErrors() && urlProblem()) {
                  <hlm-field-error forceShow>{{ t('deploy.form.urlInvalid') }}</hlm-field-error>
                }
                @if (draft.id !== null) {
                  <button
                    hlmBtn
                    type="button"
                    variant="ghost"
                    size="sm"
                    class="self-start"
                    (click)="patch({ replaceUrl: false, url: '' })"
                  >
                    {{ t('deploy.form.keepUrl', { host: draft.host }) }}
                  </button>
                }
              </div>
            }
            @if (formError()) {
              <div hlmAlert variant="destructive" role="alert">
                <ng-icon hlmAlertIcon name="lucideCircleAlert" />
                <p hlmAlertDescription>{{ formError() }}</p>
              </div>
            }
          </form>
          <hlm-dialog-footer>
            <button hlmBtn type="button" variant="outline" (click)="form.set(null)">
              {{ t('common.cancel') }}
            </button>
            <button hlmBtn type="submit" form="deploy-target-form" [disabled]="saving()">
              @if (saving()) {
                <hlm-spinner class="size-4" />
              }
              {{ draft.id === null ? t('common.create') : t('common.save') }}
            </button>
          </hlm-dialog-footer>
        }
      </hlm-dialog-content>
    </hlm-dialog>

    <hlm-dialog [state]="callback() ? 'open' : 'closed'" (closed)="callback.set(null)">
      <hlm-dialog-content
        *hlmDialogPortal="let ctx"
        class="sm:max-w-2xl"
        [closeLabel]="t('common.close')"
      >
        @if (callback(); as target) {
          <hlm-dialog-header>
            <h2 hlmDialogTitle>{{ t('deploy.callback.title') }}</h2>
            <p hlmDialogDescription>
              {{ t('deploy.callback.description', { name: target.name }) }}
            </p>
          </hlm-dialog-header>
          <div class="flex min-w-0 flex-col gap-4">
            <div class="flex flex-col gap-1.5">
              <span class="text-sm font-medium" id="deploy-callback-label">{{
                t('deploy.callback.url')
              }}</span>
              <div class="flex items-center gap-1">
                <code
                  dir="ltr"
                  class="bg-muted min-w-0 flex-1 truncate rounded px-2 py-1.5 font-mono text-xs"
                  aria-labelledby="deploy-callback-label"
                  data-callback-url
                  >{{ target.callbackPath }}</code
                >
                <button
                  hlmBtn
                  size="icon-sm"
                  variant="ghost"
                  type="button"
                  [attr.aria-label]="t('deploy.callback.copy')"
                  [title]="t('deploy.callback.copy')"
                  (click)="copy(target.callbackPath ?? '')"
                >
                  <ng-icon name="lucideCopy" />
                </button>
              </div>
              <p class="text-muted-foreground text-xs">{{ t('deploy.callback.secret') }}</p>
            </div>
            <hlm-tabs [tab]="provider()" (tabActivated)="provider.set($any($event))">
              <hlm-tabs-list [attr.aria-label]="t('deploy.callback.providers')">
                @for (item of providers; track item) {
                  <button [hlmTabsTrigger]="item">{{ t(callbackLabels[item].label) }}</button>
                }
              </hlm-tabs-list>
              @for (item of providers; track item) {
                <div [hlmTabsContent]="item" class="flex flex-col gap-2 pt-2">
                  <p class="text-muted-foreground text-sm">{{ t(callbackLabels[item].hint) }}</p>
                  @if (item === 'generic') {
                    <pre
                      dir="ltr"
                      class="bg-muted overflow-x-auto rounded-md p-3 font-mono text-xs whitespace-pre-wrap break-all"
                      >{{ genericSnippet(target.callbackPath ?? '') }}</pre>
                  }
                </div>
              }
            </hlm-tabs>
          </div>
          <hlm-dialog-footer>
            <button hlmBtn type="button" (click)="callback.set(null)">
              {{ t('common.close') }}
            </button>
          </hlm-dialog-footer>
        }
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class DeploymentsPage implements OnInit {
  private readonly service = inject(Deploys);
  private readonly auth = inject(Auth);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;

  protected readonly canManage = computed(() => this.auth.can('deploy.manage'));
  protected readonly targets = signal<DeployTarget[] | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly history = signal<Deployment[]>([]);
  protected readonly historyTarget = signal('');
  protected readonly historyLoading = signal(false);
  protected readonly cdn = signal<CdnStatus | null>(null);
  protected readonly cdnError = signal<string | null>(null);
  protected readonly purging = signal(false);
  protected readonly deploying = signal<number | null>(null);

  protected readonly form = signal<TargetForm | null>(null);
  protected readonly formError = signal<string | null>(null);
  protected readonly showErrors = signal(false);
  protected readonly saving = signal(false);
  protected readonly nameProblem = computed(() => !this.form()?.name.trim());
  protected readonly urlProblem = computed(() => {
    const form = this.form();
    if (!form || (form.id !== null && !form.replaceUrl)) return false;
    return !validHookUrl(form.url);
  });

  protected readonly callback = signal<DeployTarget | null>(null);
  protected readonly provider = signal<CallbackProvider>('netlify');
  protected readonly providers = CALLBACK_PROVIDERS;
  protected readonly callbackLabels = CALLBACK_LABELS;
  protected readonly providerLabels = PROVIDER_LABELS;
  protected readonly genericSnippet = genericCallback;

  private readonly poller = new DeploymentPoller(
    (id) => this.service.latest(id),
    (id, deployment) => this.onPolled(id, deployment),
  );

  constructor() {
    inject(DestroyRef).onDestroy(() => this.poller.stop());
  }

  async ngOnInit(): Promise<void> {
    if (!this.canManage()) return;
    await this.reload();
    void this.loadHistory();
    void this.loadCdn();
  }

  private async reload(): Promise<void> {
    try {
      const targets = await this.service.targets();
      this.targets.set(targets);
      this.error.set(null);
      for (const target of targets) this.poller.watch(target.id, target.lastDeployment);
    } catch (error) {
      const failure = ApiFailure.from(error);
      this.error.set(failure.status === 404 ? this.t('deploy.unavailable') : failure.message);
    }
  }

  protected async loadHistory(): Promise<void> {
    this.historyLoading.set(true);
    try {
      const id = this.historyTarget();
      this.history.set(await this.service.deployments(id ? Number(id) : undefined, 50));
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    } finally {
      this.historyLoading.set(false);
    }
  }

  protected setHistoryTarget(id: string): void {
    this.historyTarget.set(id);
    void this.loadHistory();
  }

  private async loadCdn(): Promise<void> {
    try {
      this.cdn.set(await this.service.cdn());
      this.cdnError.set(null);
    } catch (error) {
      this.cdnError.set(ApiFailure.from(error).message);
    }
  }

  protected targetName(id: number): string {
    return (
      (this.targets() ?? []).find((target) => target.id === id)?.name ??
      this.t('deploy.history.deletedTarget', { id })
    );
  }

  /** A polled deployment: updates the target's row and the history. */
  private onPolled(id: number, deployment: Deployment | null): void {
    this.targets.update((list) =>
      (list ?? []).map((target) =>
        target.id === id ? { ...target, lastDeployment: deployment } : target,
      ),
    );
    if (!deployment) return;
    this.history.update((list) => {
      const known = list.some((item) => item.id === deployment.id);
      if (known) return list.map((item) => (item.id === deployment.id ? deployment : item));
      const filter = this.historyTarget();
      return !filter || Number(filter) === id ? [deployment, ...list] : list;
    });
  }

  protected async deploy(target: DeployTarget): Promise<void> {
    this.deploying.set(target.id);
    try {
      const deployment = await this.service.trigger(target.id);
      this.onPolled(target.id, deployment);
      if (deployment.status === 'failed') {
        toast.error(this.t('deploy.triggerFailed', { name: target.name }), {
          description: deployment.message ?? undefined,
        });
      } else {
        toast.success(this.t('deploy.triggered', { name: target.name }));
        if (inProgress(deployment.status)) this.poller.watch(target.id, deployment);
      }
    } catch (error) {
      const failure = ApiFailure.from(error);
      toast.error(failure.status === 429 ? this.t('deploy.tooSoon') : failure.message);
    } finally {
      this.deploying.set(null);
    }
  }

  protected openCreate(): void {
    this.formError.set(null);
    this.showErrors.set(false);
    this.form.set({ id: null, name: '', url: '', host: '', replaceUrl: true });
  }

  protected openEdit(target: DeployTarget): void {
    this.formError.set(null);
    this.showErrors.set(false);
    this.form.set({
      id: target.id,
      name: target.name,
      url: '',
      host: target.host,
      replaceUrl: false,
    });
  }

  protected patch(change: Partial<TargetForm>): void {
    this.form.update((form) => (form ? { ...form, ...change } : form));
  }

  protected replaceUrl(): void {
    this.patch({ replaceUrl: true, url: '' });
    // The URL field replaces the button that had the focus.
    setTimeout(() => document.getElementById('deploy-target-url')?.focus());
  }

  protected async save(): Promise<void> {
    const form = this.form();
    if (!form || this.saving()) return;
    this.showErrors.set(true);
    if (this.nameProblem() || this.urlProblem()) return;
    this.saving.set(true);
    this.formError.set(null);
    try {
      const name = form.name.trim();
      if (form.id === null) {
        const created = await this.service.create(name, form.url.trim());
        this.targets.update((list) => [...(list ?? []), created]);
        toast.success(this.t('deploy.created', { name }));
        this.form.set(null);
        if (created.callbackPath) this.callback.set(created);
      } else {
        const updated = await this.service.update(
          form.id,
          name,
          form.replaceUrl ? form.url.trim() : undefined,
        );
        this.targets.update((list) =>
          (list ?? []).map((target) => (target.id === updated.id ? updated : target)),
        );
        toast.success(this.t('deploy.saved', { name }));
        this.form.set(null);
      }
    } catch (error) {
      this.formError.set(ApiFailure.from(error).message);
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove(target: DeployTarget): Promise<void> {
    try {
      await this.service.remove(target.id);
      this.poller.unwatch(target.id);
      this.targets.update((list) => (list ?? []).filter((item) => item.id !== target.id));
      toast.success(this.t('deploy.deleted', { name: target.name }));
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    }
  }

  protected async purge(): Promise<void> {
    this.purging.set(true);
    try {
      const result = await this.service.purgeAll();
      if (result && !result.ok) {
        toast.error(this.t('deploy.cdn.purgeFailed'), { description: result.message ?? undefined });
      } else {
        toast.success(this.t('deploy.cdn.purged'));
      }
      await this.loadCdn();
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    } finally {
      this.purging.set(false);
    }
  }

  protected async copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(this.t('common.copied'));
    } catch {
      toast.error(this.t('deploy.copyFailed'));
    }
  }
}
