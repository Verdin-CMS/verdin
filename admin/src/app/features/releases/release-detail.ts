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
import { Router, RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { HlmTableImports } from '@spartan-ng/helm/table';

import { Api, ApiFailure, toQuery } from '../../core/api';
import { Auth } from '../../core/auth';
import { ContentLocales } from '../../core/content-locales';
import { I18n } from '../../core/i18n/i18n';
import { Release, ReleaseAction, Releases, isEditable } from '../../core/releases';
import { Schema } from '../../core/schema';
import { Document } from '../../core/types';
import { PageHeader } from '../../shared/components/page-header';
import { ReleaseDialog, ReleaseStatusBadge } from './release-parts';

/** `uid|documentId|locale`: the key of an entry's title. */
function entryKey(uid: string, documentId: string, locale: string): string {
  return `${uid}|${documentId}|${locale}`;
}

/** A release: its entries, and publishing it now. Read-only once it ran. */
@Component({
  selector: 'vd-release-detail',
  imports: [
    NgIcon,
    RouterLink,
    HlmAlertImports,
    HlmAlertDialogImports,
    HlmBadgeImports,
    HlmButtonImports,
    HlmEmptyImports,
    HlmSkeletonImports,
    HlmSpinnerImports,
    HlmTableImports,
    PageHeader,
    ReleaseDialog,
    ReleaseStatusBadge,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (error()) {
      <div class="flex flex-col gap-4">
        <a
          class="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm"
          routerLink="/releases"
          ><ng-icon name="lucideArrowLeft" size="14" class="rtl:-scale-x-100" />{{
            t('releases.title')
          }}</a
        >
        <div hlmAlert variant="destructive" role="alert">
          <ng-icon hlmAlertIcon name="lucideCircleAlert" />
          <p hlmAlertTitle>{{ error() }}</p>
        </div>
      </div>
    } @else if (release(); as release) {
      <div class="flex flex-col gap-6">
        <vd-page-header [title]="release.name">
          <div eyebrow>
            <a
              class="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
              routerLink="/releases"
              ><ng-icon name="lucideArrowLeft" size="14" class="rtl:-scale-x-100" />{{
                t('releases.title')
              }}</a
            >
          </div>
          <div actions>
            <button hlmBtn variant="ghost" [disabled]="busy()" (click)="load()">
              <ng-icon name="lucideRefreshCw" /> {{ t('releases.refresh') }}
            </button>
            @if (editable()) {
              <button hlmBtn variant="outline" [disabled]="busy()" (click)="dialogOpen.set(true)">
                <ng-icon name="lucidePencil" /> {{ t('common.edit') }}
              </button>
              <hlm-alert-dialog>
                <button
                  hlmAlertDialogTrigger
                  hlmBtn
                  [disabled]="busy() || release.actions.length === 0"
                >
                  @if (publishing()) {
                    <hlm-spinner class="size-4" />
                  } @else {
                    <ng-icon name="lucideSend" />
                  }
                  {{ t('releases.publishNow') }}
                </button>
                <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx">
                  <hlm-alert-dialog-header>
                    <h2 hlmAlertDialogTitle>
                      {{ t('releases.publishTitle', { name: release.name }) }}
                    </h2>
                    <p hlmAlertDialogDescription>
                      {{ t('releases.publishHint', { count: release.actions.length }) }}
                    </p>
                  </hlm-alert-dialog-header>
                  <hlm-alert-dialog-footer>
                    <button hlmAlertDialogCancel (click)="ctx.close()">
                      {{ t('common.cancel') }}
                    </button>
                    <button hlmAlertDialogAction (click)="ctx.close(); publish()">
                      {{ t('releases.publishConfirm') }}
                    </button>
                  </hlm-alert-dialog-footer>
                </hlm-alert-dialog-content>
              </hlm-alert-dialog>
            }
          </div>
        </vd-page-header>

        <section
          class="bg-card grid gap-4 rounded-xl border p-5 sm:grid-cols-3"
          [attr.aria-label]="t('releases.summary')"
        >
          <div class="flex flex-col gap-1">
            <span class="text-muted-foreground text-xs">{{ t('releases.statusColumn') }}</span>
            <span><vd-release-status [status]="release.status" /></span>
          </div>
          <div class="flex flex-col gap-1">
            <span class="text-muted-foreground text-xs">{{ t('releases.scheduled') }}</span>
            <span class="text-sm" [attr.title]="i18n.formatDate(release.scheduledAt, 'long')">
              {{
                release.scheduledAt
                  ? i18n.formatDate(release.scheduledAt, 'long')
                  : t('releases.notScheduled')
              }}
            </span>
          </div>
          <div class="flex flex-col gap-1">
            <span class="text-muted-foreground text-xs">{{ t('releases.releasedAt') }}</span>
            <span class="text-sm">{{ i18n.formatDate(release.releasedAt, 'long') }}</span>
          </div>
        </section>

        @if (!editable()) {
          <div hlmAlert [variant]="release.status === 'failed' ? 'destructive' : 'default'">
            <ng-icon
              hlmAlertIcon
              [name]="release.status === 'failed' ? 'lucideCircleAlert' : 'lucideLock'"
            />
            <p hlmAlertTitle>
              {{
                release.status === 'failed'
                  ? t('releases.failedTitle')
                  : release.status === 'running'
                    ? t('releases.runningTitle')
                    : t('releases.doneTitle')
              }}
            </p>
            <p hlmAlertDescription>{{ release.error ?? t('releases.readOnly') }}</p>
          </div>
        }

        <section
          class="bg-card overflow-hidden rounded-xl border"
          aria-labelledby="release-entries"
        >
          <header class="flex flex-wrap items-center gap-2 border-b px-4 py-3">
            <h2 id="release-entries" class="font-medium">
              {{ t('releases.entryCount', { count: release.actions.length }) }}
            </h2>
            @if (editable()) {
              <p class="text-muted-foreground ms-auto text-xs">{{ t('releases.addHint') }}</p>
            }
          </header>
          @if (release.actions.length === 0) {
            <div hlmEmpty class="py-12">
              <div hlmEmptyHeader>
                <div hlmEmptyMedia variant="icon"><ng-icon name="lucideInbox" /></div>
                <h3 hlmEmptyTitle>{{ t('releases.noEntries') }}</h3>
                <p hlmEmptyDescription>{{ t('releases.noEntriesHint') }}</p>
              </div>
            </div>
          } @else {
            <div hlmTableContainer>
              <table hlmTable>
                <thead hlmTHead class="bg-muted/50">
                  <tr hlmTr class="hover:bg-transparent">
                    <th hlmTh class="ps-4">{{ t('releases.entry') }}</th>
                    <th hlmTh>{{ t('releases.contentType') }}</th>
                    <th hlmTh>{{ t('releases.actionColumn') }}</th>
                    <th hlmTh>{{ t('releases.result') }}</th>
                    <th hlmTh class="pe-4">
                      <span class="sr-only">{{ t('common.actions') }}</span>
                    </th>
                  </tr>
                </thead>
                <tbody hlmTBody>
                  @for (action of release.actions; track action.id) {
                    <tr hlmTr>
                      <td hlmTd class="max-w-80 ps-4">
                        <span class="flex min-w-0 flex-col">
                          @if (entryLink(action); as link) {
                            <a
                              class="hover:text-primary truncate font-medium underline-offset-2 hover:underline"
                              [routerLink]="link"
                              [queryParams]="action.locale ? { locale: action.locale } : {}"
                              >{{ title(action) }}</a
                            >
                          } @else {
                            <span class="truncate font-medium">{{ title(action) }}</span>
                          }
                          <span class="text-muted-foreground truncate font-mono text-xs">
                            {{ action.documentId }}
                            @if (action.locale) {
                              · {{ locales.name(action.locale) }}
                            }
                          </span>
                        </span>
                      </td>
                      <td hlmTd>{{ typeName(action.uid) }}</td>
                      <td hlmTd>
                        <span
                          hlmBadge
                          [variant]="action.action === 'publish' ? 'secondary' : 'outline'"
                        >
                          <ng-icon
                            [name]="action.action === 'publish' ? 'lucideSend' : 'lucideEyeOff'"
                            aria-hidden="true"
                          />
                          {{
                            action.action === 'publish'
                              ? t('releases.action.publish')
                              : t('releases.action.unpublish')
                          }}
                        </span>
                      </td>
                      <td hlmTd class="max-w-80">
                        <span class="flex flex-col items-start gap-1">
                          <vd-release-status [status]="action.status" />
                          @if (action.error) {
                            <span class="text-destructive text-xs break-words">{{
                              action.error
                            }}</span>
                          }
                        </span>
                      </td>
                      <td hlmTd class="pe-4 text-end">
                        @if (editable()) {
                          <button
                            hlmBtn
                            size="icon-sm"
                            variant="ghost"
                            class="text-muted-foreground"
                            [disabled]="busy()"
                            [attr.aria-label]="t('releases.removeEntry', { title: title(action) })"
                            (click)="removeAction(action)"
                          >
                            <ng-icon name="lucideX" />
                          </button>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </section>

        <section class="flex flex-col gap-3 rounded-xl border border-dashed p-5">
          <h2 class="text-sm font-medium">{{ t('releases.dangerZone') }}</h2>
          <hlm-alert-dialog>
            <button
              hlmAlertDialogTrigger
              hlmBtn
              variant="destructive"
              size="sm"
              class="self-start"
              [disabled]="busy()"
            >
              <ng-icon name="lucideTrash2" /> {{ t('releases.delete') }}
            </button>
            <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx">
              <hlm-alert-dialog-header>
                <h2 hlmAlertDialogTitle>{{ t('releases.deleteTitle', { name: release.name }) }}</h2>
                <p hlmAlertDialogDescription>{{ t('releases.deleteHint') }}</p>
              </hlm-alert-dialog-header>
              <hlm-alert-dialog-footer>
                <button hlmAlertDialogCancel (click)="ctx.close()">
                  {{ t('common.cancel') }}
                </button>
                <button hlmAlertDialogAction variant="destructive" (click)="ctx.close(); remove()">
                  {{ t('common.delete') }}
                </button>
              </hlm-alert-dialog-footer>
            </hlm-alert-dialog-content>
          </hlm-alert-dialog>
        </section>
      </div>

      <vd-release-dialog
        [open]="dialogOpen()"
        [release]="release"
        (saved)="saved($event)"
        (closed)="dialogOpen.set(false)"
      />
    } @else {
      <hlm-skeleton class="h-64 rounded-xl" />
    }
  `,
})
export class ReleaseDetailPage {
  private readonly service = inject(Releases);
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly schema = inject(Schema);
  protected readonly locales = inject(ContentLocales);
  protected readonly auth = inject(Auth);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;

  readonly id = input.required<string>();

  protected readonly release = signal<Release | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly publishing = signal(false);
  protected readonly dialogOpen = signal(false);
  protected readonly titles = signal<Record<string, string>>({});
  protected readonly editable = computed(() => {
    const release = this.release();
    return !!release && isEditable(release);
  });

  constructor() {
    effect(() => {
      this.id();
      untracked(() => void this.load());
    });
    // Locale names for localized entries.
    void this.locales.load().catch(() => undefined);
  }

  async load(): Promise<void> {
    try {
      const release = await this.service.get(this.id());
      this.release.set(release);
      this.error.set(null);
      void this.loadTitles(release.actions);
    } catch (error) {
      const failure = ApiFailure.from(error);
      this.error.set(failure.status === 404 ? this.t('releases.notFound') : failure.message);
    }
  }

  /** Entry titles, one request per content type and locale; failures keep the ids. */
  private async loadTitles(actions: ReleaseAction[]): Promise<void> {
    const groups = new Map<string, { uid: string; locale: string; ids: string[] }>();
    for (const action of actions) {
      if (this.titles()[entryKey(action.uid, action.documentId, action.locale)]) continue;
      const key = `${action.uid}|${action.locale}`;
      const group = groups.get(key) ?? { uid: action.uid, locale: action.locale, ids: [] };
      group.ids.push(action.documentId);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      const type = this.schema.type(group.uid);
      const field = type ? this.schema.titleField(type) : null;
      if (!type || !field || !this.auth.canContent('content.read', group.uid)) continue;
      const query: Record<string, unknown> = {
        filters: { documentId: { $in: [...new Set(group.ids)] } },
        fields: [field],
        status: 'draft',
        pagination: { pageSize: 100 },
      };
      if (group.locale) query['locale'] = group.locale;
      try {
        const list = await this.api.list<Document>(`/content/${group.uid}`, toQuery(query));
        const found: Record<string, string> = {};
        for (const document of list.data ?? []) {
          const title = document[field];
          if (typeof title === 'string' && title.trim())
            found[entryKey(group.uid, document.documentId, group.locale)] = title;
        }
        this.titles.update((titles) => ({ ...titles, ...found }));
      } catch {
        // Titles are a nicety: the ids stay.
      }
    }
  }

  protected title(action: ReleaseAction): string {
    return (
      this.titles()[entryKey(action.uid, action.documentId, action.locale)] ?? action.documentId
    );
  }

  protected typeName(uid: string): string {
    return this.schema.type(uid)?.displayName ?? uid;
  }

  protected entryLink(action: ReleaseAction): unknown[] | null {
    const type = this.schema.type(action.uid);
    if (!type) return null;
    return type.kind === 'singleType'
      ? ['/single', type.uid]
      : ['/content', type.uid, action.documentId];
  }

  protected async publish(): Promise<void> {
    const release = this.release();
    if (!release) return;
    this.busy.set(true);
    this.publishing.set(true);
    try {
      const result = await this.service.publish(release.id);
      this.release.set(result);
      if (result.status === 'failed') {
        toast.error(this.t('releases.toast.failed', { name: result.name }), {
          description: result.error ?? undefined,
        });
      } else {
        toast.success(this.t('releases.toast.published', { name: result.name }));
      }
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
      await this.load();
    } finally {
      this.busy.set(false);
      this.publishing.set(false);
    }
  }

  protected async removeAction(action: ReleaseAction): Promise<void> {
    const release = this.release();
    if (!release) return;
    this.busy.set(true);
    try {
      this.release.set(await this.service.removeAction(release.id, action.id));
      toast.success(this.t('releases.toast.entryRemoved', { title: this.title(action) }));
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected saved(release: Release): void {
    this.dialogOpen.set(false);
    this.release.set(release);
    toast.success(this.t('releases.toast.saved', { name: release.name }));
  }

  protected async remove(): Promise<void> {
    const release = this.release();
    if (!release) return;
    this.busy.set(true);
    try {
      await this.service.remove(release.id);
      toast.success(this.t('releases.toast.deleted', { name: release.name }));
      await this.router.navigate(['/releases']);
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    } finally {
      this.busy.set(false);
    }
  }
}
