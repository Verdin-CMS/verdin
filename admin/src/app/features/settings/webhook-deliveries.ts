import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { HlmTableImports } from '@spartan-ng/helm/table';

import { ApiFailure } from '../../core/api';
import { I18n } from '../../core/i18n/i18n';
import { MessageKey } from '../../core/i18n/keys';
import { PageMeta } from '../../core/types';
import { Attempt, Delivery, DeliveryStatus, Webhooks, prettyJson } from '../../core/webhooks';

const STATUSES: Record<
  DeliveryStatus,
  { label: MessageKey; icon: string; variant: 'default' | 'destructive' | 'outline' }
> = {
  succeeded: {
    label: 'settings.webhooks.status.succeeded',
    icon: 'lucideCheck',
    variant: 'default',
  },
  failed: {
    label: 'settings.webhooks.status.failed',
    icon: 'lucideCircleAlert',
    variant: 'destructive',
  },
  pending: { label: 'settings.webhooks.status.pending', icon: 'lucideClock', variant: 'outline' },
  sending: { label: 'settings.webhooks.status.sending', icon: 'lucideSend', variant: 'outline' },
};

/** Tells the user how a test event or a retry went. */
export function announceAttempt(t: I18n['t'], attempt: Attempt): void {
  const status = attempt.statusCode ?? '—';
  if (attempt.ok) {
    toast.success(t('settings.webhooks.attemptOk', { status, duration: attempt.durationMs }));
  } else {
    toast.error(t('settings.webhooks.attemptFailed', { status, duration: attempt.durationMs }), {
      description: attempt.error ?? attempt.body?.slice(0, 200) ?? undefined,
    });
  }
}

/** A delivery status as a badge. */
@Component({
  selector: 'vd-delivery-status',
  imports: [NgIcon, HlmBadgeImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span hlmBadge [variant]="spec().variant">
      <ng-icon [name]="spec().icon" />
      {{ t(spec().label) }}
    </span>
  `,
})
export class DeliveryStatusBadge {
  protected readonly t = inject(I18n).t;
  readonly status = input.required<DeliveryStatus>();
  protected readonly spec = computed(() => STATUSES[this.status()] ?? STATUSES.pending);
}

const PAGE_SIZE = 20;

/** A webhook's delivery log, newest first. */
@Component({
  selector: 'vd-webhook-deliveries',
  imports: [
    NgIcon,
    DeliveryStatusBadge,
    HlmBadgeImports,
    HlmButtonImports,
    HlmDialogImports,
    HlmEmptyImports,
    HlmSpinnerImports,
    HlmTableImports,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="bg-card overflow-hidden rounded-xl border">
      <header class="flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <div class="flex min-w-0 flex-col">
          <h2 class="font-medium">{{ t('settings.webhooks.log') }}</h2>
          <p class="text-muted-foreground text-xs">{{ t('settings.webhooks.logHint') }}</p>
        </div>
        <button
          hlmBtn
          variant="outline"
          size="sm"
          class="ms-auto"
          [disabled]="loading()"
          (click)="load()"
        >
          @if (loading()) {
            <hlm-spinner class="size-4" />
          } @else {
            <ng-icon name="lucideRefreshCw" />
          }
          {{ t('settings.webhooks.refresh') }}
        </button>
      </header>

      @if (deliveries().length === 0) {
        <div hlmEmpty class="py-12">
          <div hlmEmptyHeader>
            <div hlmEmptyMedia variant="icon"><ng-icon name="lucideInbox" /></div>
            <h3 hlmEmptyTitle>{{ t('settings.webhooks.logEmpty') }}</h3>
            <p hlmEmptyDescription>{{ t('settings.webhooks.logEmptyHint') }}</p>
          </div>
        </div>
      } @else {
        <div hlmTableContainer>
          <table hlmTable>
            <thead hlmTHead class="bg-muted/50">
              <tr hlmTr class="hover:bg-transparent">
                <th hlmTh class="ps-4">{{ t('settings.webhooks.time') }}</th>
                <th hlmTh>{{ t('settings.webhooks.event') }}</th>
                <th hlmTh>{{ t('settings.webhooks.status') }}</th>
                <th hlmTh>{{ t('settings.webhooks.httpStatus') }}</th>
                <th hlmTh>{{ t('settings.webhooks.attempts') }}</th>
                <th hlmTh>{{ t('settings.webhooks.duration') }}</th>
                <th hlmTh class="pe-4">
                  <span class="sr-only">{{ t('common.actions') }}</span>
                </th>
              </tr>
            </thead>
            <tbody hlmTBody>
              @for (delivery of deliveries(); track delivery.id) {
                <tr hlmTr class="cursor-pointer" (click)="open(delivery)">
                  <td
                    hlmTd
                    class="ps-4 whitespace-nowrap"
                    [attr.title]="i18n.formatDate(delivery.createdAt, 'long')"
                  >
                    {{ i18n.formatDate(delivery.createdAt) }}
                  </td>
                  <td hlmTd>
                    <code class="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">{{
                      delivery.event
                    }}</code>
                  </td>
                  <td hlmTd><vd-delivery-status [status]="delivery.status" /></td>
                  <td hlmTd class="font-mono tabular-nums">
                    {{ delivery.responseStatus ?? '—' }}
                  </td>
                  <td hlmTd class="tabular-nums">{{ delivery.attempts }}</td>
                  <td hlmTd class="text-muted-foreground tabular-nums">
                    {{
                      delivery.durationMs === null
                        ? '—'
                        : t('settings.webhooks.ms', { duration: delivery.durationMs })
                    }}
                  </td>
                  <td hlmTd class="pe-4">
                    <div class="flex justify-end gap-1">
                      @if (delivery.status === 'failed') {
                        <button
                          hlmBtn
                          size="sm"
                          variant="outline"
                          [disabled]="retrying() === delivery.id"
                          (click)="$event.stopPropagation(); retry(delivery)"
                        >
                          @if (retrying() === delivery.id) {
                            <hlm-spinner class="size-4" />
                          } @else {
                            <ng-icon name="lucideRotateCcw" />
                          }
                          {{ t('common.retry') }}
                        </button>
                      }
                      <button
                        hlmBtn
                        size="icon-sm"
                        variant="ghost"
                        class="text-muted-foreground"
                        [attr.aria-label]="t('settings.webhooks.details')"
                        (click)="$event.stopPropagation(); open(delivery)"
                      >
                        <ng-icon name="lucideChevronRight" />
                      </button>
                    </div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        @if (pageCount() > 1) {
          <div class="flex flex-wrap items-center justify-end gap-2 border-t px-4 py-3">
            <span class="text-muted-foreground me-auto text-sm tabular-nums">
              {{ t('common.page', { page: page(), count: pageCount() }) }}
            </span>
            <button
              hlmBtn
              variant="outline"
              size="sm"
              [disabled]="page() <= 1"
              (click)="page.set(page() - 1)"
            >
              <ng-icon name="lucideArrowLeft" /> {{ t('common.previous') }}
            </button>
            <button
              hlmBtn
              variant="outline"
              size="sm"
              [disabled]="page() >= pageCount()"
              (click)="page.set(page() + 1)"
            >
              {{ t('common.next') }} <ng-icon name="lucideChevronRight" />
            </button>
          </div>
        }
      }
    </section>

    <hlm-dialog [state]="selected() ? 'open' : 'closed'" (closed)="selected.set(null)">
      <hlm-dialog-content *hlmDialogPortal="let ctx" class="sm:max-w-3xl">
        @if (selected(); as delivery) {
          <hlm-dialog-header>
            <h2 hlmDialogTitle class="flex items-center gap-2">
              <code class="font-mono">{{ delivery.event }}</code>
              <vd-delivery-status [status]="delivery.status" />
            </h2>
            <p hlmDialogDescription>
              {{ t('settings.webhooks.deliveryId', { id: '' + delivery.id }) }} ·
              {{ i18n.formatDate(delivery.createdAt, 'long') }}
            </p>
          </hlm-dialog-header>
          <div class="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
            <dl class="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div class="flex flex-col gap-0.5">
                <dt class="text-muted-foreground text-xs">
                  {{ t('settings.webhooks.httpStatus') }}
                </dt>
                <dd class="font-mono">{{ delivery.responseStatus ?? '—' }}</dd>
              </div>
              <div class="flex flex-col gap-0.5">
                <dt class="text-muted-foreground text-xs">{{ t('settings.webhooks.attempts') }}</dt>
                <dd class="tabular-nums">{{ delivery.attempts }}</dd>
              </div>
              <div class="flex flex-col gap-0.5">
                <dt class="text-muted-foreground text-xs">{{ t('settings.webhooks.duration') }}</dt>
                <dd class="tabular-nums">
                  {{
                    delivery.durationMs === null
                      ? '—'
                      : t('settings.webhooks.ms', { duration: delivery.durationMs })
                  }}
                </dd>
              </div>
              <div class="flex flex-col gap-0.5">
                <dt class="text-muted-foreground text-xs">
                  {{ t('settings.webhooks.nextAttempt') }}
                </dt>
                <dd>{{ i18n.formatDate(delivery.nextAttemptAt) }}</dd>
              </div>
            </dl>
            @if (delivery.error) {
              <div class="flex flex-col gap-1.5">
                <span class="text-sm font-medium">{{ t('settings.webhooks.error') }}</span>
                <pre
                  class="bg-destructive/10 text-destructive rounded-lg p-3 font-mono text-xs whitespace-pre-wrap"
                  >{{ delivery.error }}</pre>
              </div>
            }
            <div class="flex flex-col gap-1.5">
              <span class="text-sm font-medium">{{ t('settings.webhooks.payload') }}</span>
              <pre class="bg-muted max-h-72 overflow-auto rounded-lg p-3 font-mono text-xs">{{
                json(delivery.payload)
              }}</pre>
            </div>
            <div class="flex flex-col gap-1.5">
              <span class="text-sm font-medium">{{ t('settings.webhooks.responseBody') }}</span>
              @if (delivery.responseBody) {
                <pre
                  class="bg-muted max-h-56 overflow-auto rounded-lg p-3 font-mono text-xs whitespace-pre-wrap"
                  >{{ json(delivery.responseBody) }}</pre>
              } @else {
                <p class="text-muted-foreground text-sm">{{ t('settings.webhooks.noBody') }}</p>
              }
            </div>
          </div>
          <hlm-dialog-footer>
            @if (delivery.status === 'failed') {
              <button
                hlmBtn
                variant="outline"
                [disabled]="retrying() === delivery.id"
                (click)="retry(delivery)"
              >
                <ng-icon name="lucideRotateCcw" /> {{ t('common.retry') }}
              </button>
            }
            <button hlmBtn (click)="selected.set(null)">{{ t('common.close') }}</button>
          </hlm-dialog-footer>
        }
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class WebhookDeliveries {
  private readonly service = inject(Webhooks);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;

  readonly webhookId = input.required<number>();

  protected readonly deliveries = signal<Delivery[]>([]);
  protected readonly meta = signal<PageMeta>({});
  protected readonly page = signal(1);
  protected readonly pageCount = computed(() => this.meta().pageCount ?? 1);
  protected readonly loading = signal(false);
  protected readonly retrying = signal<number | null>(null);
  protected readonly selected = signal<Delivery | null>(null);
  protected readonly json = prettyJson;

  constructor() {
    effect(() => {
      this.webhookId();
      this.page();
      untracked(() => void this.load());
    });
  }

  /** Reloads the current page. */
  async load(): Promise<void> {
    this.loading.set(true);
    try {
      const response = await this.service.deliveries(this.webhookId(), this.page(), PAGE_SIZE);
      this.deliveries.set(response.data);
      this.meta.set(response.meta.pagination ?? {});
      const selected = this.selected();
      if (selected) {
        this.selected.set(response.data.find((item) => item.id === selected.id) ?? selected);
      }
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    } finally {
      this.loading.set(false);
    }
  }

  protected open(delivery: Delivery): void {
    this.selected.set(delivery);
  }

  protected async retry(delivery: Delivery): Promise<void> {
    this.retrying.set(delivery.id);
    try {
      announceAttempt(this.t, await this.service.retry(delivery.id));
      await this.load();
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    } finally {
      this.retrying.set(null);
    }
  }
}
