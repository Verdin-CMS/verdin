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
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { HlmSwitchImports } from '@spartan-ng/helm/switch';
import { HlmTableImports } from '@spartan-ng/helm/table';

import { ApiFailure } from '../../core/api';
import { Auth } from '../../core/auth';
import { I18n } from '../../core/i18n/i18n';
import { Webhook, Webhooks } from '../../core/webhooks';
import { PageHeader } from '../../shared/components/page-header';
import { DeliveryStatusBadge, announceAttempt } from './webhook-deliveries';

/** Settings → Webhooks: HTTP callbacks for content and media events. */
@Component({
  selector: 'vd-webhooks',
  imports: [
    NgIcon,
    RouterLink,
    DeliveryStatusBadge,
    HlmAlertImports,
    HlmAlertDialogImports,
    HlmBadgeImports,
    HlmButtonImports,
    HlmEmptyImports,
    HlmSkeletonImports,
    HlmSpinnerImports,
    HlmSwitchImports,
    HlmTableImports,
    PageHeader,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-6">
      <vd-page-header
        [title]="t('settings.webhooks.title')"
        [description]="t('settings.webhooks.description')"
      >
        <span eyebrow class="text-primary flex items-center gap-1.5 text-xs font-medium">
          <ng-icon name="lucideWebhook" size="14" /> {{ t('shell.settings') }}
        </span>
        @if (canManage()) {
          <div actions>
            <a hlmBtn routerLink="/settings/webhooks/new">
              <ng-icon name="lucidePlus" /> {{ t('settings.webhooks.create') }}
            </a>
          </div>
        }
      </vd-page-header>

      @if (error()) {
        <div hlmAlert variant="destructive">
          <ng-icon hlmAlertIcon name="lucideCircleAlert" />
          <p hlmAlertTitle>{{ t('settings.webhooks.loadError') }}</p>
          <p hlmAlertDescription>{{ error() }}</p>
        </div>
      } @else if (webhooks() === null) {
        <hlm-skeleton class="h-48 rounded-xl" />
      } @else if (webhooks()!.length === 0) {
        <div hlmEmpty class="rounded-xl border border-dashed py-16">
          <div hlmEmptyHeader>
            <div hlmEmptyMedia variant="icon"><ng-icon name="lucideWebhook" /></div>
            <h2 hlmEmptyTitle>{{ t('settings.webhooks.emptyTitle') }}</h2>
            <p hlmEmptyDescription>{{ t('settings.webhooks.emptyHint') }}</p>
          </div>
          <div hlmEmptyContent>
            <a hlmBtn variant="outline" routerLink="/settings/webhooks/new">
              <ng-icon name="lucidePlus" /> {{ t('settings.webhooks.create') }}
            </a>
          </div>
        </div>
      } @else {
        <div class="bg-card overflow-hidden rounded-xl border">
          <div hlmTableContainer>
            <table hlmTable>
              <thead hlmTHead class="bg-muted/50">
                <tr hlmTr class="hover:bg-transparent">
                  <th hlmTh class="ps-4">{{ t('common.name') }}</th>
                  <th hlmTh>{{ t('settings.webhooks.events') }}</th>
                  <th hlmTh>{{ t('settings.webhooks.enabled') }}</th>
                  <th hlmTh>{{ t('settings.webhooks.lastDelivery') }}</th>
                  <th hlmTh class="pe-4">
                    <span class="sr-only">{{ t('common.actions') }}</span>
                  </th>
                </tr>
              </thead>
              <tbody hlmTBody>
                @for (webhook of webhooks(); track webhook.id) {
                  <tr hlmTr>
                    <td hlmTd class="ps-4">
                      <a
                        class="group flex items-center gap-3"
                        [routerLink]="['/settings/webhooks', webhook.id]"
                      >
                        <span
                          class="flex size-8 shrink-0 items-center justify-center rounded-lg"
                          [class]="
                            webhook.enabled
                              ? 'bg-primary/10 text-primary'
                              : 'bg-muted text-muted-foreground'
                          "
                        >
                          <ng-icon name="lucideWebhook" size="16" />
                        </span>
                        <span class="flex min-w-0 flex-col">
                          <span class="flex items-center gap-1.5 font-medium group-hover:underline">
                            {{ webhook.name }}
                            @if (webhook.signed) {
                              <ng-icon
                                name="lucideLock"
                                size="12"
                                class="text-muted-foreground"
                                [attr.title]="t('settings.webhooks.signed')"
                              />
                            }
                          </span>
                          <span
                            class="text-muted-foreground max-w-xs truncate font-mono text-xs"
                            [attr.title]="webhook.url"
                            >{{ webhook.url }}</span
                          >
                        </span>
                      </a>
                    </td>
                    <td hlmTd>
                      <div class="flex max-w-sm flex-wrap gap-1">
                        @if (webhook.events.length > 3) {
                          <span
                            hlmBadge
                            variant="secondary"
                            [attr.title]="webhook.events.join(', ')"
                          >
                            {{
                              t('settings.webhooks.eventCount', { count: webhook.events.length })
                            }}
                          </span>
                        } @else {
                          @for (event of webhook.events; track event) {
                            <span hlmBadge variant="outline" class="font-mono font-normal">{{
                              event
                            }}</span>
                          }
                        }
                      </div>
                    </td>
                    <td hlmTd>
                      <hlm-switch
                        [checked]="webhook.enabled"
                        [disabled]="!canManage() || busy() === webhook.id"
                        [aria-label]="t('settings.webhooks.toggle', { name: webhook.name })"
                        (checkedChange)="setEnabled(webhook, $event)"
                      />
                    </td>
                    <td hlmTd>
                      @if (webhook.lastDelivery; as delivery) {
                        <div class="flex items-center gap-2">
                          <vd-delivery-status [status]="delivery.status" />
                          <span
                            class="text-muted-foreground text-xs"
                            [attr.title]="i18n.formatDate(delivery.createdAt, 'long')"
                            >{{ i18n.formatRelative(delivery.createdAt) }}</span
                          >
                        </div>
                      } @else {
                        <span class="text-muted-foreground">{{
                          t('settings.webhooks.neverDelivered')
                        }}</span>
                      }
                    </td>
                    <td hlmTd class="pe-4">
                      <div class="flex justify-end gap-1">
                        <button
                          hlmBtn
                          size="icon-sm"
                          variant="ghost"
                          class="text-muted-foreground"
                          [disabled]="testing() === webhook.id"
                          [attr.aria-label]="
                            t('settings.webhooks.testLabel', { name: webhook.name })
                          "
                          [attr.title]="t('settings.webhooks.test')"
                          (click)="test(webhook)"
                        >
                          @if (testing() === webhook.id) {
                            <hlm-spinner class="size-4" />
                          } @else {
                            <ng-icon name="lucideSend" />
                          }
                        </button>
                        <a
                          hlmBtn
                          size="icon-sm"
                          variant="ghost"
                          class="text-muted-foreground"
                          [routerLink]="['/settings/webhooks', webhook.id]"
                          [attr.aria-label]="
                            t('settings.webhooks.editLabel', { name: webhook.name })
                          "
                          [attr.title]="t('common.edit')"
                        >
                          <ng-icon name="lucidePencil" />
                        </a>
                        <hlm-alert-dialog>
                          <button
                            hlmAlertDialogTrigger
                            hlmBtn
                            size="icon-sm"
                            variant="ghost"
                            class="text-muted-foreground hover:text-destructive"
                            [attr.aria-label]="
                              t('settings.webhooks.deleteLabel', { name: webhook.name })
                            "
                            [attr.title]="t('common.delete')"
                          >
                            <ng-icon name="lucideTrash2" />
                          </button>
                          <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx">
                            <hlm-alert-dialog-header>
                              <h2 hlmAlertDialogTitle>
                                {{ t('settings.webhooks.deleteTitle', { name: webhook.name }) }}
                              </h2>
                              <p hlmAlertDialogDescription>
                                {{ t('settings.webhooks.deleteHint') }}
                              </p>
                            </hlm-alert-dialog-header>
                            <hlm-alert-dialog-footer>
                              <button hlmAlertDialogCancel (click)="ctx.close()">
                                {{ t('common.cancel') }}
                              </button>
                              <button
                                hlmAlertDialogAction
                                variant="destructive"
                                (click)="ctx.close(); remove(webhook)"
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
    </div>
  `,
})
export class WebhooksPage implements OnInit {
  private readonly service = inject(Webhooks);
  private readonly auth = inject(Auth);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;

  protected readonly webhooks = signal<Webhook[] | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal<number | null>(null);
  protected readonly testing = signal<number | null>(null);
  protected readonly canManage = computed(() => this.auth.can('webhooks.manage'));

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  private async reload(): Promise<void> {
    try {
      this.webhooks.set((await this.service.list()).webhooks);
      this.error.set(null);
    } catch (error) {
      const failure = ApiFailure.from(error);
      this.error.set(
        failure.status === 404 ? this.t('settings.webhooks.featureOff') : failure.message,
      );
    }
  }

  protected async setEnabled(webhook: Webhook, enabled: boolean): Promise<void> {
    this.busy.set(webhook.id);
    try {
      const updated = await this.service.setEnabled(webhook, enabled);
      this.webhooks.update((list) =>
        (list ?? []).map((item) => (item.id === webhook.id ? { ...item, ...updated } : item)),
      );
      toast.success(
        this.t(enabled ? 'settings.webhooks.turnedOn' : 'settings.webhooks.turnedOff', {
          name: webhook.name,
        }),
      );
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
      // Put the switch back.
      this.webhooks.update((list) => (list ? [...list] : list));
    } finally {
      this.busy.set(null);
    }
  }

  protected async test(webhook: Webhook): Promise<void> {
    this.testing.set(webhook.id);
    try {
      announceAttempt(this.t, await this.service.trigger(webhook.id));
      await this.reload();
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    } finally {
      this.testing.set(null);
    }
  }

  protected async remove(webhook: Webhook): Promise<void> {
    try {
      await this.service.remove(webhook.id);
      this.webhooks.update((list) => (list ?? []).filter((item) => item.id !== webhook.id));
      toast.success(this.t('settings.webhooks.deleted', { name: webhook.name }));
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    }
  }
}
