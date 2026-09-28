import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { HlmTableImports } from '@spartan-ng/helm/table';

import { ApiFailure, RUNTIME_CONFIG } from '../../core/api';
import { I18n } from '../../core/i18n/i18n';
import { MessageKey } from '../../core/i18n/keys';
import {
  REDIRECT_STATUSES,
  Redirect,
  RedirectInput,
  RedirectProblem,
  RedirectStatus,
  Site,
  filterRedirects,
  redirectProblems,
  redirectsFromCsv,
  redirectsToCsv,
  saveBlob,
} from '../../core/site';
import { PageHeader } from '../../shared/components/page-header';
import { SiteAccessNotice, siteAccess } from './site-access';

/** The row being edited: `id` is `null` for the new row. */
interface RedirectDraft extends RedirectInput {
  id: number | null;
}

const PROBLEM_LABELS: Record<RedirectProblem, MessageKey> = {
  source: 'redirects.problem.source',
  destination: 'redirects.problem.destination',
  status: 'redirects.problem.status',
  same: 'redirects.problem.same',
  duplicate: 'redirects.problem.duplicate',
};

const STATUS_LABELS: Record<RedirectStatus, MessageKey> = {
  301: 'redirects.status.301',
  302: 'redirects.status.302',
  307: 'redirects.status.307',
  308: 'redirects.status.308',
};

/** Settings → Redirects: source paths sent elsewhere, fetched by sites from `/api/_redirects`. */
@Component({
  selector: 'vd-redirects',
  imports: [
    NgIcon,
    NgTemplateOutlet,
    SiteAccessNotice,
    HlmAlertDialogImports,
    HlmBadgeImports,
    HlmButtonImports,
    HlmEmptyImports,
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
        [title]="t('redirects.title')"
        [description]="t('redirects.description', { endpoint: endpoint })"
      >
        <span eyebrow class="text-primary flex items-center gap-1.5 text-xs font-medium">
          <ng-icon name="lucideSignpost" size="14" /> {{ t('shell.settings') }}
        </span>
        @if (access() === 'ok' && redirects() !== null) {
          <div actions class="flex flex-wrap gap-2">
            <input
              #csvFile
              type="file"
              accept=".csv,text/csv"
              class="hidden"
              tabindex="-1"
              aria-hidden="true"
              (change)="importCsv($event)"
            />
            <button hlmBtn variant="outline" [disabled]="importing()" (click)="csvFile.click()">
              @if (importing()) {
                <hlm-spinner class="size-4" />
              } @else {
                <ng-icon name="lucideUpload" />
              }
              {{ t('redirects.import') }}
            </button>
            <button
              hlmBtn
              variant="outline"
              [disabled]="!redirects()!.length"
              (click)="exportCsv()"
            >
              <ng-icon name="lucideDownload" /> {{ t('redirects.export') }}
            </button>
            <button hlmBtn (click)="startNew()">
              <ng-icon name="lucidePlus" /> {{ t('redirects.add') }}
            </button>
          </div>
        }
      </vd-page-header>

      @if (access() !== 'ok') {
        <vd-site-access [access]="access()" feature="redirects" />
      } @else if (error()) {
        <p class="text-destructive text-sm" role="alert">{{ error() }}</p>
      } @else if (redirects() === null) {
        <hlm-skeleton class="h-48 rounded-xl" />
      } @else {
        <div class="bg-card overflow-hidden rounded-xl border">
          <div class="flex items-center gap-2 border-b px-4 py-3">
            <div class="relative max-w-sm flex-1">
              <ng-icon
                name="lucideSearch"
                size="16"
                class="text-muted-foreground pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2"
              />
              <input
                hlmInput
                type="search"
                class="ps-8"
                [attr.aria-label]="t('redirects.search')"
                [placeholder]="t('redirects.search')"
                [value]="search()"
                (input)="search.set($any($event.target).value)"
              />
            </div>
            <span class="text-muted-foreground ms-auto text-xs" aria-live="polite">{{
              t('redirects.count', { count: visible().length })
            }}</span>
          </div>
          <div hlmTableContainer>
            <table hlmTable>
              <thead hlmTHead class="bg-muted/50">
                <tr hlmTr class="hover:bg-transparent">
                  <th hlmTh class="ps-4">{{ t('redirects.source') }}</th>
                  <th hlmTh>{{ t('redirects.destination') }}</th>
                  <th hlmTh class="w-56">{{ t('redirects.statusLabel') }}</th>
                  <th hlmTh class="pe-4">
                    <span class="sr-only">{{ t('common.actions') }}</span>
                  </th>
                </tr>
              </thead>
              <tbody hlmTBody>
                @if (draft()?.id === null) {
                  <ng-container *ngTemplateOutlet="editor" />
                }
                @for (redirect of visible(); track redirect.id) {
                  @if (draft()?.id === redirect.id) {
                    <ng-container *ngTemplateOutlet="editor" />
                  } @else {
                    <tr hlmTr data-redirect>
                      <td hlmTd class="ps-4">
                        <span dir="ltr" class="font-mono text-xs break-all">{{
                          redirect.source
                        }}</span>
                      </td>
                      <td hlmTd>
                        <span class="flex items-center gap-1.5">
                          <ng-icon
                            name="lucideCornerDownRight"
                            size="14"
                            class="text-muted-foreground shrink-0 rtl:-scale-x-100"
                            aria-hidden="true"
                          />
                          <span dir="ltr" class="font-mono text-xs break-all">{{
                            redirect.destination
                          }}</span>
                        </span>
                      </td>
                      <td hlmTd>
                        <span hlmBadge variant="outline" class="font-normal tabular-nums">{{
                          t(statusLabels[redirect.status] ?? 'redirects.status.301')
                        }}</span>
                      </td>
                      <td hlmTd class="pe-4">
                        <div class="flex justify-end gap-1">
                          <button
                            hlmBtn
                            size="icon-sm"
                            variant="ghost"
                            class="text-muted-foreground"
                            [attr.aria-label]="
                              t('redirects.editLabel', { source: redirect.source })
                            "
                            [attr.title]="t('common.edit')"
                            (click)="startEdit(redirect)"
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
                              [attr.aria-label]="
                                t('redirects.deleteLabel', { source: redirect.source })
                              "
                              [attr.title]="t('common.delete')"
                            >
                              <ng-icon name="lucideTrash2" />
                            </button>
                            <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx">
                              <hlm-alert-dialog-header>
                                <h2 hlmAlertDialogTitle>
                                  {{ t('redirects.deleteTitle', { source: redirect.source }) }}
                                </h2>
                                <p hlmAlertDialogDescription>{{ t('redirects.deleteHint') }}</p>
                              </hlm-alert-dialog-header>
                              <hlm-alert-dialog-footer>
                                <button hlmAlertDialogCancel (click)="ctx.close()">
                                  {{ t('common.cancel') }}
                                </button>
                                <button
                                  hlmAlertDialogAction
                                  variant="destructive"
                                  (click)="ctx.close(); remove(redirect)"
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
                } @empty {
                  @if (draft()?.id !== null) {
                    <tr hlmTr class="hover:bg-transparent">
                      <td hlmTd colspan="4">
                        <div hlmEmpty class="py-10">
                          <div hlmEmptyHeader>
                            <div hlmEmptyMedia variant="icon">
                              <ng-icon name="lucideSignpost" />
                            </div>
                            <h2 hlmEmptyTitle>
                              {{ search() ? t('redirects.noMatches') : t('redirects.emptyTitle') }}
                            </h2>
                            @if (!search()) {
                              <p hlmEmptyDescription>{{ t('redirects.emptyHint') }}</p>
                            }
                          </div>
                        </div>
                      </td>
                    </tr>
                  }
                }
              </tbody>
            </table>
          </div>
        </div>
      }
    </div>

    <ng-template #editor>
      @if (draft(); as row) {
        <tr hlmTr class="bg-muted/30 hover:bg-muted/30" data-redirect-editor>
          <td hlmTd class="ps-4 align-top">
            <label for="redirect-source" class="sr-only">{{ t('redirects.source') }}</label>
            <input
              hlmInput
              dir="ltr"
              id="redirect-source"
              autocomplete="off"
              spellcheck="false"
              class="h-8 font-mono text-xs"
              placeholder="/old-path"
              [attr.aria-invalid]="sourceInvalid() ? true : null"
              [attr.aria-describedby]="problems().length ? 'redirect-problems' : null"
              [value]="row.source"
              (input)="patch({ source: $any($event.target).value })"
              (keydown.enter)="save()"
              (keydown.escape)="cancel()"
            />
          </td>
          <td hlmTd class="align-top">
            <label for="redirect-destination" class="sr-only">{{
              t('redirects.destination')
            }}</label>
            <input
              hlmInput
              dir="ltr"
              id="redirect-destination"
              autocomplete="off"
              spellcheck="false"
              class="h-8 font-mono text-xs"
              placeholder="/new-path"
              [attr.aria-invalid]="destinationInvalid() ? true : null"
              [attr.aria-describedby]="problems().length ? 'redirect-problems' : null"
              [value]="row.destination"
              (input)="patch({ destination: $any($event.target).value })"
              (keydown.enter)="save()"
              (keydown.escape)="cancel()"
            />
            @if (showErrors() && problems().length) {
              <ul id="redirect-problems" class="text-destructive mt-1.5 text-xs" role="alert">
                @for (problem of problems(); track problem) {
                  <li>{{ t(problemLabels[problem]) }}</li>
                }
              </ul>
            }
            @if (serverError()) {
              <p class="text-destructive mt-1.5 text-xs" role="alert">{{ serverError() }}</p>
            }
          </td>
          <td hlmTd class="align-top">
            <label for="redirect-status" class="sr-only">{{ t('redirects.statusLabel') }}</label>
            <hlm-native-select
              selectId="redirect-status"
              size="sm"
              [value]="'' + row.status"
              (valueChange)="patch({ status: toStatus($event) })"
            >
              @for (status of statuses; track status) {
                <option hlmNativeSelectOption [value]="'' + status">
                  {{ t(statusLabels[status]) }}
                </option>
              }
            </hlm-native-select>
          </td>
          <td hlmTd class="pe-4 align-top">
            <div class="flex justify-end gap-1">
              <button
                hlmBtn
                size="icon-sm"
                [disabled]="saving()"
                [attr.aria-label]="t('common.save')"
                [attr.title]="t('common.save')"
                (click)="save()"
              >
                @if (saving()) {
                  <hlm-spinner class="size-4" />
                } @else {
                  <ng-icon name="lucideCheck" />
                }
              </button>
              <button
                hlmBtn
                size="icon-sm"
                variant="ghost"
                [attr.aria-label]="t('common.cancel')"
                [attr.title]="t('common.cancel')"
                (click)="cancel()"
              >
                <ng-icon name="lucideX" />
              </button>
            </div>
          </td>
        </tr>
      }
    </ng-template>
  `,
})
export class RedirectsPage {
  private readonly site = inject(Site);
  private readonly config = inject(RUNTIME_CONFIG);
  protected readonly t = inject(I18n).t;
  protected readonly access = siteAccess('redirects');

  protected readonly endpoint = `${this.config.contentApiBase}/_redirects`;
  protected readonly statuses = REDIRECT_STATUSES;
  protected readonly statusLabels = STATUS_LABELS;
  protected readonly problemLabels = PROBLEM_LABELS;
  protected readonly redirects = signal<Redirect[] | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly search = signal('');
  protected readonly draft = signal<RedirectDraft | null>(null);
  protected readonly showErrors = signal(false);
  protected readonly serverError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly importing = signal(false);

  protected readonly visible = computed(() =>
    filterRedirects(this.redirects() ?? [], this.search()),
  );
  protected readonly problems = computed(() => {
    const draft = this.draft();
    return draft ? redirectProblems(draft, this.redirects() ?? [], draft.id) : [];
  });
  protected readonly sourceInvalid = computed(
    () => this.showErrors() && this.problems().some((p) => p === 'source' || p === 'duplicate'),
  );
  protected readonly destinationInvalid = computed(
    () => this.showErrors() && this.problems().some((p) => p === 'destination' || p === 'same'),
  );

  private loaded = false;

  constructor() {
    // The list loads once the feature is known to be on.
    effect(() => {
      if (this.access() === 'ok' && !this.loaded) untracked(() => void this.load());
    });
  }

  private async load(): Promise<void> {
    this.loaded = true;
    try {
      this.redirects.set(await this.site.redirects());
      this.error.set(null);
    } catch (error) {
      this.error.set(ApiFailure.from(error).message);
    }
  }

  protected toStatus(value: string | null | undefined): RedirectStatus {
    const code = Number(value);
    return (REDIRECT_STATUSES as readonly number[]).includes(code) ? (code as RedirectStatus) : 301;
  }

  private open(draft: RedirectDraft): void {
    this.showErrors.set(false);
    this.serverError.set(null);
    this.draft.set(draft);
    setTimeout(() => document.getElementById('redirect-source')?.focus());
  }

  protected startNew(): void {
    this.search.set('');
    this.open({ id: null, source: '', destination: '', status: 301 });
  }

  protected startEdit(redirect: Redirect): void {
    this.open({
      id: redirect.id,
      source: redirect.source,
      destination: redirect.destination,
      status: redirect.status,
    });
  }

  protected patch(change: Partial<RedirectInput>): void {
    this.serverError.set(null);
    this.draft.update((draft) => (draft ? { ...draft, ...change } : draft));
  }

  protected cancel(): void {
    this.draft.set(null);
  }

  protected async save(): Promise<void> {
    const draft = this.draft();
    if (!draft || this.saving()) return;
    this.showErrors.set(true);
    if (this.problems().length) return;
    this.saving.set(true);
    const input: RedirectInput = {
      source: draft.source.trim(),
      destination: draft.destination.trim(),
      status: draft.status,
    };
    try {
      if (draft.id === null) {
        const created = await this.site.createRedirect(input);
        this.redirects.update((list) => sortBySource([...(list ?? []), created]));
        toast.success(this.t('redirects.created', { source: created.source }));
      } else {
        const updated = await this.site.updateRedirect(draft.id, input);
        this.redirects.update((list) =>
          sortBySource((list ?? []).map((item) => (item.id === updated.id ? updated : item))),
        );
        toast.success(this.t('redirects.saved', { source: updated.source }));
      }
      this.draft.set(null);
    } catch (error) {
      const failure = ApiFailure.from(error);
      this.serverError.set(
        failure.status === 409 ? this.t('redirects.problem.duplicate') : failure.message,
      );
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove(redirect: Redirect): Promise<void> {
    try {
      await this.site.deleteRedirect(redirect.id);
      this.redirects.update((list) => (list ?? []).filter((item) => item.id !== redirect.id));
      toast.success(this.t('redirects.deleted', { source: redirect.source }));
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    }
  }

  protected exportCsv(): void {
    const csv = redirectsToCsv(this.redirects() ?? []);
    saveBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'redirects.csv');
  }

  /** Creates the redirects of a CSV file, one by one; existing sources are updated. */
  protected async importCsv(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.importing.set(true);
    try {
      const { redirects, invalid } = redirectsFromCsv(await file.text());
      let created = 0;
      let updated = 0;
      const failed: string[] = [];
      for (const redirect of redirects) {
        const existing = (this.redirects() ?? []).find((item) => item.source === redirect.source);
        try {
          if (existing) {
            const saved = await this.site.updateRedirect(existing.id, redirect);
            this.redirects.update((list) =>
              (list ?? []).map((item) => (item.id === saved.id ? saved : item)),
            );
            updated++;
          } else {
            const saved = await this.site.createRedirect(redirect);
            this.redirects.update((list) => [...(list ?? []), saved]);
            created++;
          }
        } catch (error) {
          failed.push(`${redirect.source}: ${ApiFailure.from(error).message}`);
        }
      }
      this.redirects.update((list) => sortBySource(list ?? []));
      const skipped = invalid.length + failed.length;
      const summary = this.t('redirects.imported', { created, updated, skipped });
      if (skipped) {
        toast.warning(summary, {
          description: [
            ...(invalid.length
              ? [this.t('redirects.invalidLines', { lines: invalid.join(', ') })]
              : []),
            ...failed.slice(0, 3),
          ].join('\n'),
        });
      } else {
        toast.success(summary);
      }
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    } finally {
      this.importing.set(false);
    }
  }
}

function sortBySource(list: Redirect[]): Redirect[] {
  return [...list].sort((a, b) => a.source.localeCompare(b.source) || a.id - b.id);
}
