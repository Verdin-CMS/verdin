import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { HlmTableImports } from '@spartan-ng/helm/table';

import { ApiFailure } from '../../core/api';
import { Auth } from '../../core/auth';
import { Features } from '../../core/features';
import { I18n } from '../../core/i18n/i18n';
import { Release, Releases, isEditable, sortReleases } from '../../core/releases';
import { PageHeader } from '../../shared/components/page-header';
import { ReleaseDialog, ReleaseStatusBadge } from './release-parts';

/** Releases: entries published or unpublished together, now or at a scheduled date. */
@Component({
  selector: 'vd-releases',
  imports: [
    NgIcon,
    RouterLink,
    HlmAlertImports,
    HlmAlertDialogImports,
    HlmButtonImports,
    HlmEmptyImports,
    HlmSkeletonImports,
    HlmTableImports,
    PageHeader,
    ReleaseDialog,
    ReleaseStatusBadge,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-6">
      <vd-page-header [title]="t('releases.title')" [description]="t('releases.description')">
        <span eyebrow class="text-primary flex items-center gap-1.5 text-xs font-medium">
          <ng-icon name="lucideCalendarClock" size="14" /> {{ t('releases.eyebrow') }}
        </span>
        @if (available()) {
          <div actions>
            <button hlmBtn (click)="dialogOpen.set(true)">
              <ng-icon name="lucidePlus" /> {{ t('releases.create') }}
            </button>
          </div>
        }
      </vd-page-header>

      @if (!available()) {
        <div hlmAlert>
          <ng-icon hlmAlertIcon name="lucideInfo" />
          <p hlmAlertTitle>{{ t('releases.unavailable') }}</p>
          <p hlmAlertDescription>{{ t('releases.unavailableHint') }}</p>
        </div>
      } @else if (error()) {
        <div hlmAlert variant="destructive" role="alert">
          <ng-icon hlmAlertIcon name="lucideCircleAlert" />
          <p hlmAlertTitle>{{ t('releases.loadError') }}</p>
          <p hlmAlertDescription>{{ error() }}</p>
        </div>
      } @else if (releases() === null) {
        <hlm-skeleton class="h-48 rounded-xl" />
      } @else if (releases()!.length === 0) {
        <div hlmEmpty class="rounded-xl border border-dashed py-16">
          <div hlmEmptyHeader>
            <div hlmEmptyMedia variant="icon"><ng-icon name="lucideCalendarClock" /></div>
            <h2 hlmEmptyTitle>{{ t('releases.emptyTitle') }}</h2>
            <p hlmEmptyDescription>{{ t('releases.emptyHint') }}</p>
          </div>
          <div hlmEmptyContent>
            <button hlmBtn variant="outline" (click)="dialogOpen.set(true)">
              <ng-icon name="lucidePlus" /> {{ t('releases.create') }}
            </button>
          </div>
        </div>
      } @else {
        <div class="bg-card overflow-hidden rounded-xl border">
          <div hlmTableContainer>
            <table hlmTable>
              <caption class="sr-only">
                {{
                  t('releases.title')
                }}
              </caption>
              <thead hlmTHead class="bg-muted/50">
                <tr hlmTr class="hover:bg-transparent">
                  <th hlmTh class="ps-4">{{ t('common.name') }}</th>
                  <th hlmTh>{{ t('releases.statusColumn') }}</th>
                  <th hlmTh>{{ t('releases.scheduled') }}</th>
                  <th hlmTh>{{ t('releases.entries') }}</th>
                  <th hlmTh class="pe-4">
                    <span class="sr-only">{{ t('common.actions') }}</span>
                  </th>
                </tr>
              </thead>
              <tbody hlmTBody>
                @for (release of releases(); track release.id) {
                  <tr hlmTr>
                    <td hlmTd class="ps-4">
                      <a
                        class="hover:text-primary font-medium underline-offset-2 hover:underline"
                        [routerLink]="['/releases', release.id]"
                        >{{ release.name }}</a
                      >
                    </td>
                    <td hlmTd><vd-release-status [status]="release.status" /></td>
                    <td
                      hlmTd
                      class="whitespace-nowrap tabular-nums"
                      [attr.title]="i18n.formatDate(release.scheduledAt, 'long')"
                    >
                      @if (release.status === 'done' || release.status === 'failed') {
                        <span class="text-muted-foreground">{{
                          t('releases.ranAt', { date: i18n.formatDate(release.releasedAt) })
                        }}</span>
                      } @else if (release.scheduledAt) {
                        {{ i18n.formatDate(release.scheduledAt) }}
                      } @else {
                        <span class="text-muted-foreground">{{ t('releases.notScheduled') }}</span>
                      }
                    </td>
                    <td hlmTd class="tabular-nums">
                      {{ t('releases.entryCount', { count: release.actions.length }) }}
                    </td>
                    <td hlmTd class="pe-4">
                      <div class="flex justify-end gap-1">
                        @if (editable(release)) {
                          <button
                            hlmBtn
                            size="icon-sm"
                            variant="ghost"
                            [attr.aria-label]="t('releases.editNamed', { name: release.name })"
                            (click)="edit(release)"
                          >
                            <ng-icon name="lucidePencil" />
                          </button>
                        }
                        <hlm-alert-dialog>
                          <button
                            hlmAlertDialogTrigger
                            hlmBtn
                            size="icon-sm"
                            variant="ghost"
                            class="text-destructive"
                            [attr.aria-label]="t('releases.deleteNamed', { name: release.name })"
                          >
                            <ng-icon name="lucideTrash2" />
                          </button>
                          <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx">
                            <hlm-alert-dialog-header>
                              <h2 hlmAlertDialogTitle>
                                {{ t('releases.deleteTitle', { name: release.name }) }}
                              </h2>
                              <p hlmAlertDialogDescription>{{ t('releases.deleteHint') }}</p>
                            </hlm-alert-dialog-header>
                            <hlm-alert-dialog-footer>
                              <button hlmAlertDialogCancel (click)="ctx.close()">
                                {{ t('common.cancel') }}
                              </button>
                              <button
                                hlmAlertDialogAction
                                variant="destructive"
                                (click)="ctx.close(); remove(release)"
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

    <vd-release-dialog
      [open]="dialogOpen()"
      [release]="editing()"
      (saved)="saved($event)"
      (closed)="closeDialog()"
    />
  `,
})
export class ReleasesPage implements OnInit {
  private readonly service = inject(Releases);
  private readonly features = inject(Features);
  private readonly router = inject(Router);
  protected readonly auth = inject(Auth);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;

  protected readonly releases = signal<Release[] | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly dialogOpen = signal(false);
  protected readonly editing = signal<Release | null>(null);
  protected readonly editable = isEditable;
  /** Off (or not loaded yet, until the catalog says otherwise). */
  protected readonly available = computed(() => {
    const catalog = this.features.catalog();
    return catalog === null || this.features.enabled('releases');
  });

  async ngOnInit(): Promise<void> {
    if (this.features.catalog() === null) await this.features.load().catch(() => undefined);
    if (this.features.enabled('releases')) await this.load();
  }

  protected async load(): Promise<void> {
    try {
      this.releases.set(sortReleases(await this.service.list()));
      this.error.set(null);
    } catch (error) {
      const failure = ApiFailure.from(error);
      // The feature was switched off meanwhile.
      if (failure.status === 404) void this.features.load().catch(() => undefined);
      this.error.set(failure.message);
    }
  }

  protected edit(release: Release): void {
    this.editing.set(release);
    this.dialogOpen.set(true);
  }

  protected closeDialog(): void {
    this.dialogOpen.set(false);
    this.editing.set(null);
  }

  protected async saved(release: Release): Promise<void> {
    const created = !this.editing();
    this.closeDialog();
    toast.success(
      this.t(created ? 'releases.toast.created' : 'releases.toast.saved', { name: release.name }),
    );
    if (created) await this.router.navigate(['/releases', release.id]);
    else await this.load();
  }

  protected async remove(release: Release): Promise<void> {
    try {
      await this.service.remove(release.id);
      toast.success(this.t('releases.toast.deleted', { name: release.name }));
      await this.load();
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    }
  }
}
