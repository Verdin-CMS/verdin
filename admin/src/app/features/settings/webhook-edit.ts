import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmCheckboxImports } from '@spartan-ng/helm/checkbox';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { HlmSwitchImports } from '@spartan-ng/helm/switch';

import { ApiFailure } from '../../core/api';
import { I18n } from '../../core/i18n/i18n';
import { MessageKey } from '../../core/i18n/keys';
import { Schema } from '../../core/schema';
import {
  ENTRY_EVENTS,
  MEDIA_EVENTS,
  Webhook,
  WebhookForm,
  Webhooks,
  headerProblem,
  toggleEvents,
  webhookForm,
  webhookInput,
} from '../../core/webhooks';
import { PageHeader } from '../../shared/components/page-header';
import { WebhookDeliveries, announceAttempt } from './webhook-deliveries';

interface EventGroup {
  id: string;
  label: MessageKey;
  events: readonly string[];
}

const GROUPS: EventGroup[] = [
  { id: 'entries', label: 'settings.webhooks.group.entries', events: ENTRY_EVENTS },
  { id: 'media', label: 'settings.webhooks.group.media', events: MEDIA_EVENTS },
];

/** Settings → Webhooks → one webhook (or `new`): its settings, signing and delivery log. */
@Component({
  selector: 'vd-webhook-edit',
  imports: [
    NgIcon,
    RouterLink,
    WebhookDeliveries,
    HlmAlertImports,
    HlmAlertDialogImports,
    HlmBadgeImports,
    HlmButtonImports,
    HlmCardImports,
    HlmCheckboxImports,
    HlmDialogImports,
    HlmFieldImports,
    HlmInputImports,
    HlmSkeletonImports,
    HlmSpinnerImports,
    HlmSwitchImports,
    PageHeader,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-6">
      <vd-page-header
        [title]="creating() ? t('settings.webhooks.newTitle') : webhook()?.name || '…'"
        [description]="creating() ? t('settings.webhooks.newDescription') : webhook()?.url"
      >
        <a
          eyebrow
          routerLink="/settings/webhooks"
          class="text-primary flex items-center gap-1.5 text-xs font-medium hover:underline"
        >
          <ng-icon name="lucideArrowLeft" size="14" /> {{ t('settings.webhooks.title') }}
        </a>
        <div actions class="flex gap-2">
          @if (webhook(); as current) {
            <button hlmBtn variant="outline" [disabled]="testing()" (click)="test(current)">
              @if (testing()) {
                <hlm-spinner class="size-4" />
              } @else {
                <ng-icon name="lucideSend" />
              }
              {{ t('settings.webhooks.test') }}
            </button>
          }
          <button hlmBtn [disabled]="saving() || !valid()" (click)="save()">
            @if (saving()) {
              <hlm-spinner class="size-4" />
            } @else {
              <ng-icon name="lucideSave" />
            }
            {{ creating() ? t('common.create') : t('common.save') }}
          </button>
        </div>
      </vd-page-header>

      @if (loadError()) {
        <div hlmAlert variant="destructive">
          <ng-icon hlmAlertIcon name="lucideCircleAlert" />
          <p hlmAlertDescription>{{ loadError() }}</p>
        </div>
      } @else if (!creating() && !webhook()) {
        <hlm-skeleton class="h-96 rounded-xl" />
      } @else {
        @if (error()) {
          <div hlmAlert variant="destructive">
            <ng-icon hlmAlertIcon name="lucideCircleAlert" />
            <p hlmAlertDescription>{{ error() }}</p>
          </div>
        }

        <div class="grid gap-6 lg:grid-cols-2">
          <section hlmCard>
            <div hlmCardHeader>
              <h2 hlmCardTitle>{{ t('settings.webhooks.general') }}</h2>
            </div>
            <div hlmCardContent class="flex flex-col gap-4">
              <div hlmField>
                <label hlmFieldLabel for="webhook-name">{{ t('common.name') }}</label>
                <input
                  hlmInput
                  id="webhook-name"
                  [value]="form().name"
                  (input)="patch({ name: $any($event.target).value })"
                />
              </div>
              <div hlmField>
                <label hlmFieldLabel for="webhook-url">{{ t('settings.webhooks.url') }}</label>
                <input
                  hlmInput
                  id="webhook-url"
                  type="url"
                  class="font-mono"
                  placeholder="https://example.com/hooks/verdin"
                  [value]="form().url"
                  (input)="patch({ url: $any($event.target).value })"
                />
                <p hlmFieldDescription>{{ t('settings.webhooks.urlHint') }}</p>
              </div>
              <label class="flex items-start gap-3">
                <hlm-switch
                  [checked]="form().enabled"
                  (checkedChange)="patch({ enabled: $event })"
                />
                <span class="flex flex-col">
                  <span class="text-sm font-medium">{{ t('settings.webhooks.enabled') }}</span>
                  <span class="text-muted-foreground text-xs">{{
                    t('settings.webhooks.enabledHint')
                  }}</span>
                </span>
              </label>
            </div>
          </section>

          <section hlmCard>
            <div hlmCardHeader>
              <h2 hlmCardTitle>{{ t('settings.webhooks.events') }}</h2>
              <p hlmCardDescription>{{ t('settings.webhooks.eventsHint') }}</p>
            </div>
            <div hlmCardContent class="flex flex-col gap-5">
              @for (group of groups; track group.id) {
                <div class="flex flex-col gap-2">
                  <div hlmField orientation="horizontal">
                    <hlm-checkbox
                      [inputId]="'group-' + group.id"
                      [checked]="coverage(group) === 'all'"
                      [indeterminate]="coverage(group) === 'some'"
                      (checkedChange)="toggleGroup(group, $event === true)"
                    />
                    <label hlmFieldLabel [for]="'group-' + group.id" class="font-medium">
                      {{ t(group.label) }}
                    </label>
                  </div>
                  <div class="grid gap-2 ps-6 sm:grid-cols-2">
                    @for (event of group.events; track event) {
                      <div hlmField orientation="horizontal">
                        <hlm-checkbox
                          [inputId]="'event-' + event"
                          [checked]="form().events.includes(event)"
                          (checkedChange)="toggleEvent(event, $event === true)"
                        />
                        <label
                          hlmFieldLabel
                          [for]="'event-' + event"
                          class="font-mono text-xs font-normal"
                          >{{ event }}</label
                        >
                      </div>
                    }
                  </div>
                </div>
              }
              @if (!form().events.length) {
                <p class="text-destructive text-sm">{{ t('settings.webhooks.eventsRequired') }}</p>
              }
            </div>
          </section>

          <section hlmCard>
            <div hlmCardHeader>
              <h2 hlmCardTitle>{{ t('settings.webhooks.contentTypes') }}</h2>
              <p hlmCardDescription>{{ t('settings.webhooks.contentTypesHint') }}</p>
            </div>
            <div hlmCardContent class="flex flex-col gap-3">
              <div hlmField orientation="horizontal">
                <hlm-checkbox
                  inputId="types-all"
                  [checked]="allTypes()"
                  (checkedChange)="setAllTypes($event === true)"
                />
                <label hlmFieldLabel for="types-all" class="font-medium">
                  {{ t('settings.webhooks.allContentTypes') }}
                </label>
              </div>
              @if (!allTypes()) {
                <div class="grid gap-2 ps-6 sm:grid-cols-2">
                  @for (type of types(); track type.uid) {
                    <div hlmField orientation="horizontal">
                      <hlm-checkbox
                        [inputId]="'type-' + type.uid"
                        [checked]="form().contentTypes.includes(type.uid)"
                        (checkedChange)="toggleType(type.uid, $event === true)"
                      />
                      <label
                        hlmFieldLabel
                        [for]="'type-' + type.uid"
                        class="flex flex-col items-start gap-0.5 font-normal"
                      >
                        <span>{{ type.displayName }}</span>
                        <span class="text-muted-foreground font-mono text-xs">{{ type.uid }}</span>
                      </label>
                    </div>
                  } @empty {
                    <p class="text-muted-foreground text-sm">{{ t('shell.noTypes') }}</p>
                  }
                </div>
              }
            </div>
          </section>

          <section hlmCard>
            <div hlmCardHeader>
              <h2 hlmCardTitle>{{ t('settings.webhooks.headers') }}</h2>
              <p hlmCardDescription>{{ t('settings.webhooks.headersHint') }}</p>
            </div>
            <div hlmCardContent class="flex flex-col gap-3">
              @for (row of form().headers; track $index; let index = $index) {
                <div class="flex items-center gap-2">
                  <input
                    hlmInput
                    class="font-mono"
                    [placeholder]="t('settings.webhooks.headerName')"
                    [attr.aria-label]="t('settings.webhooks.headerName')"
                    [value]="row.name"
                    (input)="setHeader(index, { name: $any($event.target).value })"
                  />
                  <input
                    hlmInput
                    class="font-mono"
                    [placeholder]="t('settings.webhooks.headerValue')"
                    [attr.aria-label]="t('settings.webhooks.headerValue')"
                    [value]="row.value"
                    (input)="setHeader(index, { value: $any($event.target).value })"
                  />
                  <button
                    hlmBtn
                    size="icon-sm"
                    variant="ghost"
                    class="text-muted-foreground hover:text-destructive shrink-0"
                    [attr.aria-label]="t('settings.webhooks.removeHeader')"
                    (click)="removeHeader(index)"
                  >
                    <ng-icon name="lucideX" />
                  </button>
                </div>
              }
              @if (headerError(); as problem) {
                <p class="text-destructive text-sm">{{ problem }}</p>
              }
              <button hlmBtn variant="outline" size="sm" class="self-start" (click)="addHeader()">
                <ng-icon name="lucidePlus" /> {{ t('settings.webhooks.addHeader') }}
              </button>
            </div>
          </section>

          <section hlmCard class="lg:col-span-2">
            <div hlmCardHeader>
              <h2 hlmCardTitle class="flex items-center gap-2">
                {{ t('settings.webhooks.signing') }}
                @if (webhook(); as current) {
                  <span hlmBadge [variant]="current.signed ? 'default' : 'outline'">
                    <ng-icon [name]="current.signed ? 'lucideLock' : 'lucideLockOpen'" />
                    {{
                      current.signed
                        ? t('settings.webhooks.signed')
                        : t('settings.webhooks.unsigned')
                    }}
                  </span>
                }
              </h2>
              <p hlmCardDescription>{{ t('settings.webhooks.signingHint') }}</p>
            </div>
            <div hlmCardContent class="flex flex-col gap-4">
              <code class="bg-muted self-start rounded-lg px-3 py-2 font-mono text-xs break-all"
                >x-verdin-signature: t=&lt;unix&gt;,v1=&lt;hex&gt;</code
              >
              <p class="text-muted-foreground text-sm">
                {{ t('settings.webhooks.signatureHelp', { signed: signedPayload }) }}
              </p>
              @if (creating()) {
                <label class="flex items-start gap-3">
                  <hlm-switch
                    [checked]="form().signed"
                    (checkedChange)="patch({ signed: $event })"
                  />
                  <span class="flex flex-col">
                    <span class="text-sm font-medium">{{ t('settings.webhooks.sign') }}</span>
                    <span class="text-muted-foreground text-xs">{{
                      t('settings.webhooks.signHint')
                    }}</span>
                  </span>
                </label>
              } @else if (webhook(); as current) {
                <div class="flex flex-wrap gap-2">
                  <button
                    hlmBtn
                    variant="outline"
                    size="sm"
                    [disabled]="signingBusy()"
                    (click)="rotate(current)"
                  >
                    <ng-icon name="lucideKeyRound" />
                    {{
                      current.signed
                        ? t('settings.webhooks.rotateSecret')
                        : t('settings.webhooks.generateSecret')
                    }}
                  </button>
                  @if (current.signed) {
                    <hlm-alert-dialog>
                      <button
                        hlmAlertDialogTrigger
                        hlmBtn
                        variant="ghost"
                        size="sm"
                        class="text-destructive"
                        [disabled]="signingBusy()"
                      >
                        <ng-icon name="lucideLockOpen" /> {{ t('settings.webhooks.stopSigning') }}
                      </button>
                      <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx">
                        <hlm-alert-dialog-header>
                          <h2 hlmAlertDialogTitle>{{ t('settings.webhooks.stopSigningTitle') }}</h2>
                          <p hlmAlertDialogDescription>
                            {{ t('settings.webhooks.stopSigningHint') }}
                          </p>
                        </hlm-alert-dialog-header>
                        <hlm-alert-dialog-footer>
                          <button hlmAlertDialogCancel (click)="ctx.close()">
                            {{ t('common.cancel') }}
                          </button>
                          <button
                            hlmAlertDialogAction
                            variant="destructive"
                            (click)="ctx.close(); stopSigning(current)"
                          >
                            {{ t('settings.webhooks.stopSigning') }}
                          </button>
                        </hlm-alert-dialog-footer>
                      </hlm-alert-dialog-content>
                    </hlm-alert-dialog>
                  }
                </div>
              }
            </div>
          </section>
        </div>

        @if (webhook(); as current) {
          <vd-webhook-deliveries [webhookId]="current.id" />
        }
      }
    </div>

    <hlm-dialog [state]="secret() ? 'open' : 'closed'" (closed)="secret.set(null)">
      <hlm-dialog-content *hlmDialogPortal="let ctx" class="sm:max-w-xl">
        <hlm-dialog-header>
          <h2 hlmDialogTitle>{{ t('settings.webhooks.secretTitle') }}</h2>
          <p hlmDialogDescription>{{ t('settings.webhooks.secretDescription') }}</p>
        </hlm-dialog-header>
        @if (secret(); as value) {
          <div class="flex items-center gap-2">
            <input
              hlmInput
              readonly
              class="font-mono"
              [value]="value"
              [attr.aria-label]="t('settings.webhooks.secret')"
            />
            <button hlmBtn variant="outline" (click)="copy(value)">
              <ng-icon name="lucideCopy" /> {{ t('common.copy') }}
            </button>
          </div>
          <div hlmAlert>
            <ng-icon hlmAlertIcon name="lucideTriangleAlert" />
            <p hlmAlertDescription>{{ t('settings.webhooks.secretWarning') }}</p>
          </div>
        }
        <hlm-dialog-footer>
          <button hlmBtn (click)="secret.set(null)">{{ t('settings.webhooks.done') }}</button>
        </hlm-dialog-footer>
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class WebhookEditPage {
  private readonly service = inject(Webhooks);
  private readonly schema = inject(Schema);
  private readonly router = inject(Router);
  protected readonly t = inject(I18n).t;

  /** Route parameter: a webhook id, or `new`. */
  readonly id = input.required<string>();

  protected readonly groups = GROUPS;
  /** What `v1` signs. */
  protected readonly signedPayload = '<t>.<body>';
  protected readonly creating = computed(() => this.id() === 'new');
  protected readonly webhook = signal<Webhook | null>(null);
  protected readonly form = signal<WebhookForm>(webhookForm());
  protected readonly loadError = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly testing = signal(false);
  protected readonly signingBusy = signal(false);
  /** A secret to show once. */
  protected readonly secret = signal<string | null>(null);

  private readonly log = viewChild(WebhookDeliveries);

  protected readonly types = computed(() =>
    [...this.schema.contentTypes()].sort((a, b) => a.displayName.localeCompare(b.displayName)),
  );
  protected readonly allTypes = signal(true);

  protected readonly headerError = computed(() => {
    const problem = headerProblem(this.form().headers);
    if (!problem) return null;
    return this.t(
      problem.kind === 'reserved'
        ? 'settings.webhooks.headerReserved'
        : 'settings.webhooks.headerDuplicate',
      { name: problem.name },
    );
  });

  protected readonly valid = computed(() => {
    const form = this.form();
    return (
      !!form.name.trim() &&
      !!form.url.trim() &&
      form.events.length > 0 &&
      (this.allTypes() || form.contentTypes.length > 0) &&
      !this.headerError()
    );
  });

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => void this.load(id));
    });
  }

  private async load(id: string): Promise<void> {
    this.error.set(null);
    this.loadError.set(null);
    if (id === 'new') {
      this.webhook.set(null);
      this.reset(null);
      return;
    }
    // Just created: the page already holds it.
    if (this.webhook()?.id === Number(id)) return;
    try {
      const webhook = await this.service.get(id);
      this.webhook.set(webhook);
      this.reset(webhook);
    } catch (error) {
      const failure = ApiFailure.from(error);
      this.loadError.set(
        failure.status === 404 ? this.t('settings.webhooks.notFound') : failure.message,
      );
    }
  }

  private reset(webhook: Webhook | null): void {
    this.form.set(webhookForm(webhook));
    this.allTypes.set(!webhook?.contentTypes.length);
  }

  protected patch(changes: Partial<WebhookForm>): void {
    this.form.update((form) => ({ ...form, ...changes }));
  }

  protected coverage(group: EventGroup): 'none' | 'some' | 'all' {
    const count = group.events.filter((event) => this.form().events.includes(event)).length;
    return count === 0 ? 'none' : count === group.events.length ? 'all' : 'some';
  }

  protected toggleGroup(group: EventGroup, on: boolean): void {
    this.patch({ events: toggleEvents(this.form().events, group.events, on) });
  }

  protected toggleEvent(event: string, on: boolean): void {
    this.patch({ events: toggleEvents(this.form().events, [event], on) });
  }

  protected setAllTypes(all: boolean): void {
    this.allTypes.set(all);
    if (all) this.patch({ contentTypes: [] });
  }

  protected toggleType(uid: string, on: boolean): void {
    const current = this.form().contentTypes.filter((item) => item !== uid);
    this.patch({ contentTypes: on ? [...current, uid] : current });
  }

  protected addHeader(): void {
    this.patch({ headers: [...this.form().headers, { name: '', value: '' }] });
  }

  protected setHeader(index: number, changes: Partial<{ name: string; value: string }>): void {
    this.patch({
      headers: this.form().headers.map((row, position) =>
        position === index ? { ...row, ...changes } : row,
      ),
    });
  }

  protected removeHeader(index: number): void {
    this.patch({ headers: this.form().headers.filter((_, position) => position !== index) });
  }

  protected async save(): Promise<void> {
    if (!this.valid()) return;
    this.error.set(null);
    this.saving.set(true);
    const form = { ...this.form(), contentTypes: this.allTypes() ? [] : this.form().contentTypes };
    try {
      const current = this.webhook();
      if (this.creating() || !current) {
        const created = await this.service.create(webhookInput(form, true));
        const { secret, ...webhook } = created;
        this.webhook.set(webhook);
        this.reset(webhook);
        this.secret.set(secret);
        toast.success(this.t('settings.webhooks.created', { name: webhook.name }));
        await this.router.navigate(['/settings/webhooks', webhook.id], { replaceUrl: true });
      } else {
        const updated = await this.service.update(current.id, webhookInput(form, false));
        this.webhook.set(updated);
        this.reset(updated);
        toast.success(this.t('settings.webhooks.saved'));
      }
    } catch (error) {
      this.error.set(ApiFailure.from(error).message);
    } finally {
      this.saving.set(false);
    }
  }

  protected async test(webhook: Webhook): Promise<void> {
    this.testing.set(true);
    try {
      announceAttempt(this.t, await this.service.trigger(webhook.id));
      await this.log()?.load();
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    } finally {
      this.testing.set(false);
    }
  }

  protected async rotate(webhook: Webhook): Promise<void> {
    this.signingBusy.set(true);
    try {
      this.secret.set(await this.service.rotateSecret(webhook.id));
      this.webhook.update((current) => (current ? { ...current, signed: true } : current));
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    } finally {
      this.signingBusy.set(false);
    }
  }

  protected async stopSigning(webhook: Webhook): Promise<void> {
    this.signingBusy.set(true);
    try {
      const updated = await this.service.removeSecret(webhook.id);
      this.webhook.update((current) =>
        current ? { ...current, signed: updated.signed } : current,
      );
      toast.success(this.t('settings.webhooks.signingStopped'));
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    } finally {
      this.signingBusy.set(false);
    }
  }

  protected async copy(value: string): Promise<void> {
    await navigator.clipboard.writeText(value);
    toast.success(this.t('common.copied'));
  }
}
