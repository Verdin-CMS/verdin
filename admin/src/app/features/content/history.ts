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
import { HlmAvatarImports } from '@spartan-ng/helm/avatar';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';

import { Api, ApiFailure, toQuery } from '../../core/api';
import { Auth } from '../../core/auth';
import { Features } from '../../core/features';
import { I18n } from '../../core/i18n/i18n';
import { Schema } from '../../core/schema';
import { PageMeta } from '../../core/types';
import { PageHeader } from '../../shared/components/page-header';
import { DocumentView } from './document-view';
import { humanize } from './fields/fields';
import {
  RestoreResult,
  Version,
  VersionDetail,
  authorInitials,
  authorName,
  droppedSummary,
  editorLink,
  eventIcon,
  eventLabelKey,
} from './history-model';

const PAGE_SIZE = 20;

type Problem = 'forbidden' | 'unavailable' | 'other';

/** The saved versions of one document: browse them read-only and restore one as the draft. */
@Component({
  selector: 'vd-content-history',
  imports: [
    NgIcon,
    RouterLink,
    DocumentView,
    PageHeader,
    HlmAlertImports,
    HlmAlertDialogImports,
    HlmAvatarImports,
    HlmBadgeImports,
    HlmButtonImports,
    HlmCardImports,
    HlmEmptyImports,
    HlmSkeletonImports,
    HlmSpinnerImports,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-6">
      <vd-page-header [title]="t('content.history.title')" [description]="subtitle()">
        <div eyebrow>
          <a
            class="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
            [routerLink]="editor()"
            ><ng-icon name="lucideArrowLeft" size="14" />{{ t('content.history.backToEditor') }}</a
          >
        </div>
        @if (detail() && canRestore()) {
          <div actions>
            <hlm-alert-dialog>
              <button hlmAlertDialogTrigger hlmBtn type="button" [disabled]="restoring()">
                @if (restoring()) {
                  <hlm-spinner />
                } @else {
                  <ng-icon name="lucideRotateCcw" />
                }
                {{ t('content.history.restore') }}
              </button>
              <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx">
                <hlm-alert-dialog-header>
                  <h2 hlmAlertDialogTitle>{{ t('content.history.restoreTitle') }}</h2>
                  <p hlmAlertDialogDescription>{{ t('content.history.restoreHint') }}</p>
                </hlm-alert-dialog-header>
                <hlm-alert-dialog-footer>
                  <button hlmAlertDialogCancel (click)="ctx.close()">
                    {{ t('common.cancel') }}
                  </button>
                  <button hlmAlertDialogAction (click)="ctx.close(); restore()">
                    {{ t('content.history.restore') }}
                  </button>
                </hlm-alert-dialog-footer>
              </hlm-alert-dialog-content>
            </hlm-alert-dialog>
          </div>
        }
      </vd-page-header>

      @if (!type()) {
        <div hlmAlert variant="destructive">
          <ng-icon hlmAlertIcon name="lucideCircleAlert" />
          <p hlmAlertTitle>{{ t('content.edit.unknownType', { uid: uid() }) }}</p>
        </div>
      } @else if (problem(); as problem) {
        @if (problem === 'other') {
          <div hlmAlert variant="destructive">
            <ng-icon hlmAlertIcon name="lucideCircleAlert" />
            <p hlmAlertTitle>{{ t('content.history.loadError') }}</p>
            <p hlmAlertDescription>{{ problemMessage() }}</p>
          </div>
        } @else {
          <div hlmEmpty class="rounded-xl border border-dashed py-16">
            <div hlmEmptyHeader>
              <div hlmEmptyMedia variant="icon">
                <ng-icon [name]="problem === 'forbidden' ? 'lucideLock' : 'lucideHistory'" />
              </div>
              <p hlmEmptyDescription>
                {{
                  problem === 'forbidden'
                    ? t('content.history.forbidden')
                    : t('content.history.unavailable')
                }}
              </p>
            </div>
            <div hlmEmptyContent>
              <a hlmBtn variant="outline" [routerLink]="editor()">
                <ng-icon name="lucideArrowLeft" /> {{ t('content.history.backToEditor') }}
              </a>
            </div>
          </div>
        }
      } @else if (versions() === null) {
        <div class="grid items-start gap-6 lg:grid-cols-3">
          <hlm-skeleton class="h-96 rounded-xl lg:col-span-2" />
          <hlm-skeleton class="h-96 rounded-xl" />
        </div>
      } @else if (versions()!.length === 0 && page() === 1) {
        <div hlmEmpty class="rounded-xl border border-dashed py-16">
          <div hlmEmptyHeader>
            <div hlmEmptyMedia variant="icon"><ng-icon name="lucideHistory" /></div>
            <h2 hlmEmptyTitle>{{ t('content.history.emptyTitle') }}</h2>
            <p hlmEmptyDescription>{{ t('content.history.emptyHint') }}</p>
          </div>
        </div>
      } @else {
        <div class="grid items-start gap-6 lg:grid-cols-3">
          <section hlmCard class="min-w-0 lg:col-span-2">
            @if (detailError()) {
              <div hlmCardContent>
                <div hlmAlert variant="destructive">
                  <ng-icon hlmAlertIcon name="lucideCircleAlert" />
                  <p hlmAlertTitle>{{ t('content.history.versionError') }}</p>
                  <p hlmAlertDescription>{{ detailError() }}</p>
                </div>
              </div>
            } @else if (detailLoading() || !detail()) {
              <div
                hlmCardContent
                class="text-muted-foreground flex items-center justify-center gap-2 py-24 text-sm"
                role="status"
              >
                @if (detailLoading()) {
                  <hlm-spinner /> {{ t('common.loading') }}
                } @else {
                  {{ t('content.history.selectHint') }}
                }
              </div>
            } @else {
              @let version = detail()!;
              <div hlmCardHeader class="border-b">
                <h2 hlmCardTitle class="flex flex-wrap items-center gap-2">
                  <ng-icon [name]="icon(version.event)" class="text-muted-foreground" />
                  {{ eventLabel(version.event) }}
                  @if (type()!.draftAndPublish) {
                    <span
                      hlmBadge
                      [variant]="version.status === 'published' ? 'secondary' : 'outline'"
                      >{{ statusLabel(version.status) }}</span
                    >
                  }
                </h2>
                <p hlmCardDescription [title]="i18n.formatDate(version.createdAt, 'long')">
                  {{
                    t('content.history.byAuthor', {
                      date: i18n.formatDate(version.createdAt, 'long'),
                      author: author(version),
                    })
                  }}
                </p>
              </div>
              <div hlmCardContent class="flex flex-col gap-6">
                @if (version.unknownFields.length) {
                  <div hlmAlert>
                    <ng-icon hlmAlertIcon name="lucideTriangleAlert" />
                    <p hlmAlertTitle>{{ t('content.history.unknownFields') }}</p>
                    <ul hlmAlertDescription class="flex flex-wrap gap-1">
                      @for (field of version.unknownFields; track field) {
                        <li>
                          <span hlmBadge variant="outline" class="font-mono">{{ field }}</span>
                        </li>
                      }
                    </ul>
                  </div>
                }
                <vd-document-view [attributes]="type()!.attributes" [data]="version.data" />
              </div>
            }
          </section>

          <aside hlmCard size="sm" class="lg:sticky lg:top-6">
            <div hlmCardHeader>
              <h2 hlmCardTitle>{{ t('content.history.versions') }}</h2>
              @if (total()) {
                <div hlmCardAction>
                  <span hlmBadge variant="outline" class="tabular-nums">{{
                    i18n.formatNumber(total())
                  }}</span>
                </div>
              }
            </div>
            <ol class="flex flex-col px-2" [attr.aria-label]="t('content.history.versions')">
              @for (version of versions(); track version.id; let first = $first) {
                <li>
                  <button
                    type="button"
                    class="hover:bg-muted/60 focus-visible:ring-ring/50 flex w-full items-start gap-3 rounded-md px-2 py-2.5 text-start transition-colors outline-none focus-visible:ring-[3px]"
                    [class.bg-muted]="version.id === selectedId()"
                    [attr.aria-current]="version.id === selectedId() || null"
                    (click)="select(version.id)"
                  >
                    <hlm-avatar class="size-8">
                      @if (initials(version); as initials) {
                        <span
                          hlmAvatarFallback
                          class="bg-primary/10 text-primary text-xs font-medium"
                          >{{ initials }}</span
                        >
                      } @else {
                        <span hlmAvatarFallback class="bg-muted text-muted-foreground">
                          <ng-icon name="lucideKeyRound" size="14" />
                        </span>
                      }
                    </hlm-avatar>
                    <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span class="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                        {{ eventLabel(version.event) }}
                        @if (first && page() === 1) {
                          <span hlmBadge variant="secondary">{{
                            t('content.history.latest')
                          }}</span>
                        }
                        @if (type()!.draftAndPublish) {
                          <span
                            hlmBadge
                            class="ms-auto"
                            [variant]="version.status === 'published' ? 'secondary' : 'outline'"
                          >
                            <span
                              class="size-1.5 rounded-full"
                              aria-hidden="true"
                              [class]="
                                version.status === 'published'
                                  ? 'bg-emerald-500'
                                  : 'bg-muted-foreground/60'
                              "
                            ></span>
                            {{ statusLabel(version.status) }}
                          </span>
                        }
                      </span>
                      <span
                        class="text-muted-foreground text-xs tabular-nums"
                        [title]="i18n.formatDate(version.createdAt, 'long')"
                        >{{ i18n.formatDate(version.createdAt, 'datetime') }}</span
                      >
                      <span class="text-muted-foreground truncate text-xs">{{
                        author(version)
                      }}</span>
                    </span>
                  </button>
                </li>
              }
            </ol>
            @if (pageCount() > 1) {
              <div hlmCardFooter class="flex flex-wrap items-center gap-2 border-t">
                <span class="text-muted-foreground me-auto text-xs tabular-nums">
                  {{ t('common.page', { page: page(), count: pageCount() }) }}
                </span>
                <button
                  hlmBtn
                  variant="outline"
                  size="icon-sm"
                  type="button"
                  [attr.aria-label]="t('common.previous')"
                  [title]="t('common.previous')"
                  [disabled]="page() <= 1 || listLoading()"
                  (click)="page.set(page() - 1)"
                >
                  <ng-icon name="lucideArrowLeft" />
                </button>
                <button
                  hlmBtn
                  variant="outline"
                  size="icon-sm"
                  type="button"
                  [attr.aria-label]="t('common.next')"
                  [title]="t('common.next')"
                  [disabled]="page() >= pageCount() || listLoading()"
                  (click)="page.set(page() + 1)"
                >
                  <ng-icon name="lucideArrowRight" />
                </button>
              </div>
            }
          </aside>
        </div>
      }
    </div>
  `,
})
export class ContentHistory {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly auth = inject(Auth);
  private readonly features = inject(Features);
  private readonly schema = inject(Schema);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;

  readonly uid = input.required<string>();
  readonly documentId = input.required<string>();

  protected readonly type = computed(() => this.schema.type(this.uid()));
  protected readonly versions = signal<Version[] | null>(null);
  protected readonly meta = signal<PageMeta>({});
  protected readonly page = signal(1);
  protected readonly pageCount = computed(() => this.meta().pageCount ?? 1);
  protected readonly total = computed(() => this.meta().total ?? 0);
  protected readonly listLoading = signal(false);
  protected readonly listProblem = signal<Problem | null>(null);
  protected readonly problemMessage = signal('');

  protected readonly selectedId = signal<number | null>(null);
  protected readonly detail = signal<VersionDetail | null>(null);
  protected readonly detailLoading = signal(false);
  protected readonly detailError = signal<string | null>(null);
  protected readonly restoring = signal(false);

  /** The feature switch, once the catalog is known (the server's 404 covers the rest). */
  protected readonly problem = computed<Problem | null>(() =>
    this.features.catalog() && !this.features.enabled('history')
      ? 'unavailable'
      : this.listProblem(),
  );
  protected readonly editor = computed(() =>
    editorLink(this.type()?.kind ?? 'collectionType', this.uid(), this.documentId()),
  );
  protected readonly canRestore = computed(() =>
    this.auth.canContent('content.update', this.uid()),
  );
  /** The document's title in the selected version, else the type name. */
  protected readonly subtitle = computed(() => {
    const type = this.type();
    if (!type) return null;
    const field = this.schema.titleField(type);
    const title = field ? this.detail()?.data?.[field] : null;
    return title ? `${type.displayName} · ${title}` : type.displayName;
  });

  private listRequest = 0;
  private detailRequest = 0;

  constructor() {
    // A new document starts over at page 1.
    effect(() => {
      this.uid();
      this.documentId();
      untracked(() => {
        this.page.set(1);
        this.selectedId.set(null);
        this.versions.set(null);
      });
    });
    effect(() => {
      const uid = this.uid();
      const documentId = this.documentId();
      const page = this.page();
      untracked(() => void this.loadList(uid, documentId, page));
    });
    effect(() => {
      const id = this.selectedId();
      untracked(() => void this.loadDetail(id));
    });
  }

  protected select(id: number): void {
    this.selectedId.set(id);
  }

  protected eventLabel(event: string): string {
    const key = eventLabelKey(event);
    return key ? this.t(key) : event;
  }

  protected icon(event: string): string {
    return eventIcon(event);
  }

  protected statusLabel(status: string): string {
    return this.t(status === 'published' ? 'content.status.published' : 'content.status.draft');
  }

  protected author(version: Version): string {
    return authorName(version.createdBy) ?? this.t('content.history.api');
  }

  protected initials(version: Version): string | null {
    return authorInitials(version.createdBy);
  }

  private async loadList(uid: string, documentId: string, page: number): Promise<void> {
    if (!this.type()) return;
    const request = ++this.listRequest;
    this.listLoading.set(true);
    try {
      const response = await this.api.list<Version>(
        `/history/${uid}/${documentId}`,
        toQuery({ page, pageSize: PAGE_SIZE }),
      );
      if (request !== this.listRequest) return;
      this.listProblem.set(null);
      this.versions.set(response.data);
      this.meta.set(response.meta.pagination ?? {});
      // Show the newest version until the admin picks one.
      if (this.selectedId() === null) this.selectedId.set(response.data[0]?.id ?? null);
    } catch (error) {
      if (request !== this.listRequest) return;
      const failure = ApiFailure.from(error);
      this.problemMessage.set(failure.message);
      this.listProblem.set(
        failure.status === 403 ? 'forbidden' : failure.status === 404 ? 'unavailable' : 'other',
      );
    } finally {
      if (request === this.listRequest) this.listLoading.set(false);
    }
  }

  private async loadDetail(id: number | null): Promise<void> {
    const request = ++this.detailRequest;
    this.detailError.set(null);
    if (id === null) {
      this.detail.set(null);
      this.detailLoading.set(false);
      return;
    }
    this.detailLoading.set(true);
    try {
      const detail = await this.api.get<VersionDetail>(`/history/versions/${id}`);
      if (request !== this.detailRequest) return;
      this.detail.set({ ...detail, unknownFields: detail.unknownFields ?? [] });
    } catch (error) {
      if (request !== this.detailRequest) return;
      const failure = ApiFailure.from(error);
      this.detail.set(null);
      this.detailError.set(
        failure.status === 403 ? this.t('content.history.forbidden') : failure.message,
      );
    } finally {
      if (request === this.detailRequest) this.detailLoading.set(false);
    }
  }

  protected async restore(): Promise<void> {
    const version = this.detail();
    const type = this.type();
    if (!version || !type) return;
    this.restoring.set(true);
    try {
      const result = await this.api.post<RestoreResult>(`/history/versions/${version.id}/restore`);
      const dropped = droppedSummary(result?.dropped ?? [], humanize);
      toast.success(
        this.t('content.history.restored'),
        dropped.count
          ? {
              description: this.t('content.history.restoredDropped', {
                count: dropped.count,
                fields: dropped.fields,
              }),
            }
          : undefined,
      );
      await this.router.navigate(
        editorLink(type.kind, this.uid(), result?.documentId ?? this.documentId()),
      );
    } catch (error) {
      const failure = ApiFailure.from(error);
      toast.error(
        failure.status === 403
          ? this.t('content.history.restoreForbidden')
          : `${this.t('content.history.restoreError')}: ${failure.message}`,
      );
    } finally {
      this.restoring.set(false);
    }
  }
}
