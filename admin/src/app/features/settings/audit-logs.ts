import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  linkedSignal,
  resource,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { HlmTableImports } from '@spartan-ng/helm/table';

import { Api, ListResponse } from '../../core/api';
import {
  AUDIT_ACTION_PRESETS,
  AuditEntry,
  AuditFilters,
  AuditLogs,
  EMPTY_AUDIT_FILTERS,
  hasAuditFilters,
} from '../../core/audit';
import { Auth } from '../../core/auth';
import { Features } from '../../core/features';
import { I18n } from '../../core/i18n/i18n';
import { MessageKey } from '../../core/i18n/keys';
import { loadErrorOf } from '../../core/loading';
import { Schema } from '../../core/schema';
import { AdminUser, PageMeta } from '../../core/types';
import { PageHeader } from '../../shared/components/page-header';
import { Pagination } from '../../shared/components/pagination';

const PAGE_SIZE = 50;

const PRESET_LABELS: Record<(typeof AUDIT_ACTION_PRESETS)[number], MessageKey> = {
  'entry.*': 'settings.audit.preset.entry',
  'media.*': 'settings.audit.preset.media',
  'admin.login': 'settings.audit.preset.login',
};

/** Settings → Audit logs (`audit.read`): who did what, and when. */
@Component({
  selector: 'vd-audit-logs',
  imports: [
    Pagination,
    NgIcon,
    RouterLink,
    HlmAlertImports,
    HlmBadgeImports,
    HlmButtonImports,
    HlmEmptyImports,
    HlmFieldImports,
    HlmInputImports,
    HlmNativeSelectImports,
    HlmSkeletonImports,
    HlmSpinnerImports,
    HlmTableImports,
    PageHeader,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-6">
      <vd-page-header
        [title]="t('settings.audit.title')"
        [description]="t('settings.audit.description')"
      >
        <span eyebrow class="text-primary flex items-center gap-1.5 text-xs font-medium">
          <ng-icon name="lucideScrollText" size="14" /> {{ t('shell.settings') }}
        </span>
        <div actions>
          <button hlmBtn variant="outline" [disabled]="loading()" (click)="list.reload()">
            @if (loading()) {
              <hlm-spinner class="size-4" />
            } @else {
              <ng-icon name="lucideRefreshCw" />
            }
            {{ t('settings.audit.refresh') }}
          </button>
        </div>
      </vd-page-header>

      @if (!auth.can('audit.read')) {
        <div hlmAlert variant="destructive">
          <ng-icon hlmAlertIcon name="lucideLock" />
          <p hlmAlertTitle>{{ t('settings.audit.forbidden') }}</p>
        </div>
      } @else {
        @if (recordingOff()) {
          <div hlmAlert>
            <ng-icon hlmAlertIcon name="lucideInfo" />
            <p hlmAlertTitle>{{ t('settings.audit.off') }}</p>
            <p hlmAlertDescription>{{ t('settings.audit.offHint') }}</p>
          </div>
        }

        <form
          role="search"
          class="bg-card flex flex-col gap-4 rounded-xl border p-4"
          [attr.aria-label]="t('settings.audit.filters')"
          (submit)="$event.preventDefault(); apply()"
        >
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-muted-foreground text-sm" id="audit-presets-label">{{
              t('settings.audit.quick')
            }}</span>
            <div class="flex flex-wrap gap-1.5" role="group" aria-labelledby="audit-presets-label">
              @for (preset of presets; track preset) {
                <button
                  hlmBtn
                  type="button"
                  size="sm"
                  [variant]="draft().action === preset ? 'default' : 'outline'"
                  [attr.aria-pressed]="draft().action === preset"
                  (click)="togglePreset(preset)"
                >
                  {{ t(presetLabels[preset]) }}
                  <code class="font-mono text-[11px] opacity-70">{{ preset }}</code>
                </button>
              }
            </div>
          </div>
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <div hlmField>
              <label hlmFieldLabel for="audit-action">{{ t('settings.audit.action') }}</label>
              <input
                hlmInput
                id="audit-action"
                list="audit-action-list"
                autocomplete="off"
                spellcheck="false"
                aria-describedby="audit-action-hint"
                [placeholder]="t('settings.audit.actionPlaceholder')"
                [value]="draft().action"
                (input)="patch({ action: $any($event.target).value })"
              />
              <datalist id="audit-action-list">
                @for (action of knownActions; track action) {
                  <option [value]="action"></option>
                }
              </datalist>
              <p id="audit-action-hint" class="text-muted-foreground text-xs">
                {{ t('settings.audit.actionHint') }}
              </p>
            </div>
            <div hlmField>
              <label hlmFieldLabel for="audit-actor">{{ t('settings.audit.actor') }}</label>
              @if (users(); as list) {
                <hlm-native-select
                  selectId="audit-actor"
                  [value]="draft().actor"
                  (valueChange)="patch({ actor: $event ?? '' }); apply()"
                >
                  <option hlmNativeSelectOption value="">{{ t('settings.audit.anyActor') }}</option>
                  @for (user of list; track user.id) {
                    <option hlmNativeSelectOption [value]="'' + user.id">
                      {{ userLabel(user) }}
                    </option>
                  }
                </hlm-native-select>
              } @else {
                <input
                  hlmInput
                  id="audit-actor"
                  inputmode="numeric"
                  autocomplete="off"
                  [placeholder]="t('settings.audit.actorPlaceholder')"
                  [value]="draft().actor"
                  (input)="patch({ actor: $any($event.target).value })"
                />
              }
            </div>
            <div hlmField>
              <label hlmFieldLabel for="audit-subject">{{ t('settings.audit.subject') }}</label>
              <input
                hlmInput
                id="audit-subject"
                list="audit-subject-list"
                autocomplete="off"
                spellcheck="false"
                [placeholder]="t('settings.audit.subjectPlaceholder')"
                [value]="draft().subject"
                (input)="patch({ subject: $any($event.target).value })"
              />
              <datalist id="audit-subject-list">
                @for (type of schema.contentTypes(); track type.uid) {
                  <option [value]="type.uid">{{ type.displayName }}</option>
                }
                <option value="plugin::upload.file">{{ t('media.title') }}</option>
              </datalist>
            </div>
            <div hlmField>
              <label hlmFieldLabel for="audit-from">{{ t('settings.audit.from') }}</label>
              <input
                hlmInput
                id="audit-from"
                type="date"
                [attr.max]="draft().to || null"
                [value]="draft().from"
                (change)="patch({ from: $any($event.target).value }); apply()"
              />
            </div>
            <div hlmField>
              <label hlmFieldLabel for="audit-to">{{ t('settings.audit.to') }}</label>
              <input
                hlmInput
                id="audit-to"
                type="date"
                [attr.min]="draft().from || null"
                [value]="draft().to"
                (change)="patch({ to: $any($event.target).value }); apply()"
              />
            </div>
          </div>
          <div class="flex flex-wrap items-center justify-end gap-2">
            <span class="text-muted-foreground me-auto text-sm tabular-nums" aria-live="polite">
              @if (meta().total !== undefined) {
                {{ t('settings.audit.total', { count: meta().total ?? 0 }) }}
              }
            </span>
            @if (filtered()) {
              <button hlmBtn type="button" variant="ghost" size="sm" (click)="clear()">
                <ng-icon name="lucideX" /> {{ t('settings.audit.clearFilters') }}
              </button>
            }
            <button hlmBtn type="submit" size="sm">
              <ng-icon name="lucideSearch" /> {{ t('settings.audit.apply') }}
            </button>
          </div>
        </form>

        @if (error()) {
          <div hlmAlert variant="destructive" role="alert">
            <ng-icon hlmAlertIcon name="lucideCircleAlert" />
            <p hlmAlertTitle>{{ t('settings.audit.loadError') }}</p>
            <p hlmAlertDescription>{{ error() }}</p>
          </div>
        }

        @if (entries() === null) {
          @if (!error()) {
            <hlm-skeleton class="h-64 rounded-xl" />
          }
        } @else if (entries()!.length === 0) {
          <div hlmEmpty class="rounded-xl border border-dashed py-16">
            <div hlmEmptyHeader>
              <div hlmEmptyMedia variant="icon"><ng-icon name="lucideScrollText" /></div>
              <h2 hlmEmptyTitle>{{ t('settings.audit.emptyTitle') }}</h2>
              <p hlmEmptyDescription>
                {{ filtered() ? t('settings.audit.emptyFiltered') : t('settings.audit.emptyHint') }}
              </p>
            </div>
          </div>
        } @else {
          <section
            class="bg-card overflow-hidden rounded-xl border"
            [attr.aria-label]="t('settings.audit.title')"
            [attr.aria-busy]="loading()"
          >
            <div hlmTableContainer>
              <table hlmTable>
                <thead hlmTHead class="bg-muted/50">
                  <tr hlmTr class="hover:bg-transparent">
                    <th hlmTh class="ps-4">{{ t('settings.audit.time') }}</th>
                    <th hlmTh>{{ t('settings.audit.action') }}</th>
                    <th hlmTh>{{ t('settings.audit.actor') }}</th>
                    <th hlmTh>{{ t('settings.audit.subject') }}</th>
                    <th hlmTh>{{ t('settings.audit.ip') }}</th>
                    <th hlmTh class="pe-4">
                      <span class="sr-only">{{ t('settings.audit.details') }}</span>
                    </th>
                  </tr>
                </thead>
                <tbody hlmTBody>
                  @for (entry of entries(); track entry.id) {
                    @let open = expanded().has(entry.id);
                    <tr hlmTr>
                      <td
                        hlmTd
                        class="ps-4 whitespace-nowrap tabular-nums"
                        [attr.title]="i18n.formatDate(entry.at, 'long')"
                      >
                        {{ i18n.formatDate(entry.at) }}
                      </td>
                      <td hlmTd>
                        <button
                          type="button"
                          class="bg-muted hover:bg-muted/70 focus-visible:ring-ring/50 rounded px-1.5 py-0.5 font-mono text-xs outline-none focus-visible:ring-3"
                          [attr.title]="t('settings.audit.filterBy', { value: entry.action })"
                          (click)="filterBy({ action: entry.action })"
                        >
                          {{ entry.action }}
                        </button>
                      </td>
                      <td hlmTd class="max-w-56">
                        @if (entry.actor.id !== null) {
                          <button
                            type="button"
                            class="hover:text-primary focus-visible:ring-ring/50 flex max-w-full min-w-0 flex-col rounded text-start outline-none focus-visible:ring-3"
                            [attr.title]="
                              t('settings.audit.filterBy', { value: actorLabel(entry) })
                            "
                            (click)="filterBy({ actor: '' + entry.actor.id })"
                          >
                            <span class="truncate text-sm">{{ actorLabel(entry) }}</span>
                            @if (entry.actor.name && entry.actor.email) {
                              <span class="text-muted-foreground truncate text-xs">{{
                                entry.actor.email
                              }}</span>
                            }
                          </button>
                        } @else {
                          <span hlmBadge variant="outline" class="font-normal">{{
                            actorKind(entry)
                          }}</span>
                        }
                      </td>
                      <td hlmTd class="max-w-64">
                        @if (entry.subject) {
                          <span class="flex min-w-0 flex-col">
                            <button
                              type="button"
                              class="hover:text-primary focus-visible:ring-ring/50 truncate rounded text-start text-sm outline-none focus-visible:ring-3"
                              [attr.title]="t('settings.audit.filterBy', { value: entry.subject })"
                              (click)="filterBy({ subject: entry.subject })"
                            >
                              {{ subjectLabel(entry.subject) }}
                            </button>
                            @if (entry.subjectId) {
                              @if (entryLink(entry); as link) {
                                <a
                                  class="text-muted-foreground hover:text-foreground truncate font-mono text-xs underline-offset-2 hover:underline"
                                  [routerLink]="link"
                                  >{{ entry.subjectId }}</a
                                >
                              } @else {
                                <span class="text-muted-foreground truncate font-mono text-xs">{{
                                  entry.subjectId
                                }}</span>
                              }
                            }
                          </span>
                        } @else {
                          <span class="text-muted-foreground">—</span>
                        }
                      </td>
                      <td hlmTd class="text-muted-foreground font-mono text-xs">
                        {{ entry.ip ?? '—' }}
                      </td>
                      <td hlmTd class="pe-4 text-end">
                        <button
                          hlmBtn
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          class="text-muted-foreground"
                          [attr.aria-expanded]="open"
                          [attr.aria-controls]="'audit-details-' + entry.id"
                          [attr.aria-label]="
                            t('settings.audit.showDetails', { action: entry.action })
                          "
                          (click)="toggle(entry.id)"
                        >
                          <ng-icon [name]="open ? 'lucideChevronUp' : 'lucideChevronDown'" />
                        </button>
                      </td>
                    </tr>
                    @if (open) {
                      <tr hlmTr class="bg-muted/30 hover:bg-muted/30">
                        <td hlmTd colspan="6" class="px-4" [id]="'audit-details-' + entry.id">
                          <dl class="grid gap-x-6 gap-y-2 py-1 text-sm sm:grid-cols-[auto_1fr]">
                            <dt class="text-muted-foreground">{{ t('settings.audit.when') }}</dt>
                            <dd>{{ i18n.formatDate(entry.at, 'long') }} · {{ entry.at }}</dd>
                            <dt class="text-muted-foreground">{{ t('settings.audit.actor') }}</dt>
                            <dd>
                              {{ actorKind(entry) }}
                              @if (entry.actor.id !== null) {
                                · #{{ entry.actor.id }} {{ entry.actor.email ?? '' }}
                              }
                            </dd>
                            <dt class="text-muted-foreground">{{ t('settings.audit.details') }}</dt>
                            <dd class="min-w-0">
                              @if (hasDetails(entry)) {
                                <pre
                                  dir="ltr"
                                  class="bg-muted max-h-64 overflow-auto rounded-lg p-3 font-mono text-xs"
                                  >{{ json(entry.details) }}</pre>
                              } @else {
                                <span class="text-muted-foreground">{{ t('common.none') }}</span>
                              }
                            </dd>
                          </dl>
                        </td>
                      </tr>
                    }
                  }
                </tbody>
              </table>
            </div>

            @if (pageCount() > 1) {
              <vd-pagination
                class="border-t px-4 py-3"
                [(page)]="page"
                [pageCount]="pageCount()"
                [disabled]="loading()"
                [label]="t('settings.audit.pagination')"
              />
            }
          </section>
        }
      }
    </div>
  `,
})
export class AuditLogsPage {
  private readonly service = inject(AuditLogs);
  private readonly api = inject(Api);
  private readonly features = inject(Features);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly auth = inject(Auth);
  protected readonly schema = inject(Schema);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;

  protected readonly presets = AUDIT_ACTION_PRESETS;
  protected readonly presetLabels = PRESET_LABELS;
  protected readonly knownActions = [
    'entry.*',
    'entry.create',
    'entry.update',
    'entry.publish',
    'entry.unpublish',
    'entry.discard-draft',
    'entry.delete',
    'entry.stage',
    'entry.assign',
    'media.*',
    'media.create',
    'media.update',
    'media.delete',
    'admin.login',
    'POST *',
    'PUT *',
    'DELETE *',
  ];

  /** What the form shows; `filters` is what was last applied. */
  protected readonly draft = signal<AuditFilters>({ ...EMPTY_AUDIT_FILTERS });
  protected readonly filters = signal<AuditFilters>({ ...EMPTY_AUDIT_FILTERS });
  protected readonly page = signal(1);
  /** Refetches whenever the applied filters or the page change; idle without `audit.read`. */
  protected readonly list = resource({
    params: () =>
      this.auth.can('audit.read') ? { filters: this.filters(), page: this.page() } : undefined,
    loader: ({ params }) => this.service.list(params.filters, params.page, PAGE_SIZE),
  });
  private readonly loadError = loadErrorOf(this.list);
  /**
   * What the table shows: the last page that loaded, kept while the next one loads (and after
   * it fails), with the last failure kept until a load succeeds.
   */
  private readonly shown = linkedSignal<
    { response: ListResponse<AuditEntry> | undefined; error: string | null; loading: boolean },
    { entries: AuditEntry[] | null; meta: PageMeta; error: string | null }
  >({
    source: () => ({
      response: this.list.hasValue() ? this.list.value() : undefined,
      error: this.loadError(),
      loading: this.list.isLoading(),
    }),
    computation: ({ response, error, loading }, previous) => {
      const last = previous?.value ?? { entries: null, meta: {}, error: null };
      if (response && !loading) {
        return { entries: response.data ?? [], meta: response.meta?.pagination ?? {}, error: null };
      }
      if (error) return { ...last, entries: last.entries ?? [], error };
      return last;
    },
  });
  protected readonly entries = computed(() => this.shown().entries);
  protected readonly meta = computed(() => this.shown().meta);
  protected readonly pageCount = computed(() => this.meta().pageCount ?? 1);
  protected readonly loading = this.list.isLoading;
  protected readonly error = computed(() => this.shown().error);
  protected readonly expanded = signal<ReadonlySet<number>>(new Set());
  /** The actor filter's choices; without them (or `users.manage`) it falls back to an id. */
  private readonly usersList = resource({
    params: () => this.auth.can('users.manage') || undefined,
    loader: () => this.api.get<AdminUser[]>('/users').catch(() => null),
  });
  protected readonly users = computed(() =>
    this.usersList.hasValue() ? this.usersList.value() : null,
  );
  protected readonly filtered = computed(
    () => hasAuditFilters(this.filters()) || hasAuditFilters(this.draft()),
  );
  protected readonly recordingOff = computed(() => {
    const audit = (this.features.catalog() ?? []).find((feature) => feature.id === 'audit');
    return !!audit && !audit.enabled;
  });

  private typing: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.typing) clearTimeout(this.typing);
    });
  }

  /** Changes the form; text filters apply after a short pause. */
  protected patch(changes: Partial<AuditFilters>): void {
    this.draft.update((draft) => ({ ...draft, ...changes }));
    if (this.typing) clearTimeout(this.typing);
    this.typing = setTimeout(() => this.apply(), 400);
  }

  protected apply(): void {
    if (this.typing) clearTimeout(this.typing);
    this.typing = null;
    const next = this.draft();
    const current = this.filters();
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    this.page.set(1);
    this.expanded.set(new Set());
    this.filters.set({ ...next });
  }

  protected togglePreset(preset: string): void {
    this.patch({ action: this.draft().action === preset ? '' : preset });
    this.apply();
  }

  protected filterBy(changes: Partial<AuditFilters>): void {
    this.patch(changes);
    this.apply();
  }

  protected clear(): void {
    this.draft.set({ ...EMPTY_AUDIT_FILTERS });
    this.apply();
  }

  protected toggle(id: number): void {
    this.expanded.update((ids) => {
      const next = new Set(ids);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  protected userLabel(user: AdminUser): string {
    const name = [user.firstname, user.lastname].filter(Boolean).join(' ');
    return name ? `${name} (${user.email})` : user.email;
  }

  protected actorLabel(entry: AuditEntry): string {
    return entry.actor.name ?? entry.actor.email ?? `#${entry.actor.id}`;
  }

  protected actorKind(entry: AuditEntry): string {
    switch (entry.actor.kind) {
      case 'admin':
        return this.t('settings.audit.kind.admin');
      case 'api':
        return this.t('settings.audit.kind.api');
      case 'system':
        return this.t('settings.audit.kind.system');
      default:
        return entry.actor.kind ?? '—';
    }
  }

  protected subjectLabel(subject: string): string {
    if (subject === 'plugin::upload.file') return this.t('media.title');
    return this.schema.type(subject)?.displayName ?? subject;
  }

  /** The editor of the entry an action is about (not after it was deleted). */
  protected entryLink(entry: AuditEntry): unknown[] | null {
    if (!entry.subject || !entry.subjectId || !entry.action.startsWith('entry.')) return null;
    if (entry.action === 'entry.delete') return null;
    const type = this.schema.type(entry.subject);
    if (!type) return null;
    return type.kind === 'singleType'
      ? ['/single', type.uid]
      : ['/content', type.uid, entry.subjectId];
  }

  protected hasDetails(entry: AuditEntry): boolean {
    return !!entry.details && Object.keys(entry.details).length > 0;
  }

  protected json(value: unknown): string {
    return JSON.stringify(value, null, 2);
  }
}
