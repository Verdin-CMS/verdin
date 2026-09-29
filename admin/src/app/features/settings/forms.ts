import { ChangeDetectionStrategy, Component, inject, resource } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { HlmTableImports } from '@spartan-ng/helm/table';

import { ApiFailure, RUNTIME_CONFIG } from '../../core/api';
import { I18n } from '../../core/i18n/i18n';
import { loadErrorOf } from '../../core/loading';
import { Form, Site } from '../../core/site';
import { PageHeader } from '../../shared/components/page-header';
import { SiteAccessNotice, siteAccess } from './site-access';

/** Settings → Forms: forms that sites render and post to `/api/_forms/{slug}`. */
@Component({
  selector: 'vd-forms',
  imports: [
    NgIcon,
    RouterLink,
    SiteAccessNotice,
    HlmAlertDialogImports,
    HlmBadgeImports,
    HlmButtonImports,
    HlmEmptyImports,
    HlmSkeletonImports,
    HlmTableImports,
    PageHeader,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-6">
      <vd-page-header
        [title]="t('forms.title')"
        [description]="t('forms.description', { endpoint: endpoint })"
      >
        <span eyebrow class="text-primary flex items-center gap-1.5 text-xs font-medium">
          <ng-icon name="lucideClipboardList" size="14" /> {{ t('shell.settings') }}
        </span>
        @if (access() === 'ok') {
          <div actions>
            <a hlmBtn routerLink="/settings/forms/new">
              <ng-icon name="lucidePlus" /> {{ t('forms.create') }}
            </a>
          </div>
        }
      </vd-page-header>

      @if (access() !== 'ok') {
        <vd-site-access [access]="access()" feature="forms" />
      } @else if (error(); as message) {
        <p class="text-destructive text-sm" role="alert">{{ message }}</p>
      } @else if (!forms.hasValue()) {
        <hlm-skeleton class="h-48 rounded-xl" />
      } @else if (forms.value().length === 0) {
        <div hlmEmpty class="rounded-xl border border-dashed py-16">
          <div hlmEmptyHeader>
            <div hlmEmptyMedia variant="icon"><ng-icon name="lucideClipboardList" /></div>
            <h2 hlmEmptyTitle>{{ t('forms.emptyTitle') }}</h2>
            <p hlmEmptyDescription>{{ t('forms.emptyHint') }}</p>
          </div>
          <div hlmEmptyContent>
            <a hlmBtn variant="outline" routerLink="/settings/forms/new">
              <ng-icon name="lucidePlus" /> {{ t('forms.create') }}
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
                  <th hlmTh>{{ t('forms.fields') }}</th>
                  <th hlmTh>{{ t('forms.updated') }}</th>
                  <th hlmTh class="pe-4">
                    <span class="sr-only">{{ t('common.actions') }}</span>
                  </th>
                </tr>
              </thead>
              <tbody hlmTBody>
                @for (form of forms.value(); track form.id) {
                  <tr hlmTr data-form>
                    <td hlmTd class="ps-4">
                      <a class="group flex flex-col" [routerLink]="['/settings/forms', form.id]">
                        <span class="font-medium group-hover:underline">{{ form.name }}</span>
                        <span dir="ltr" class="text-muted-foreground font-mono text-xs">{{
                          form.slug
                        }}</span>
                      </a>
                    </td>
                    <td hlmTd>
                      <span hlmBadge variant="secondary">{{
                        t('forms.fieldCount', { count: form.fields.length })
                      }}</span>
                    </td>
                    <td hlmTd class="text-muted-foreground text-xs">
                      {{ i18n.formatRelative(form.updatedAt) }}
                    </td>
                    <td hlmTd class="pe-4">
                      <div class="flex justify-end gap-1">
                        <a
                          hlmBtn
                          size="icon-sm"
                          variant="ghost"
                          class="text-muted-foreground"
                          [routerLink]="['/settings/forms', form.id]"
                          [attr.aria-label]="t('forms.editLabel', { name: form.name })"
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
                            [attr.aria-label]="t('forms.deleteLabel', { name: form.name })"
                            [attr.title]="t('common.delete')"
                          >
                            <ng-icon name="lucideTrash2" />
                          </button>
                          <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx">
                            <hlm-alert-dialog-header>
                              <h2 hlmAlertDialogTitle>
                                {{ t('forms.deleteTitle', { name: form.name }) }}
                              </h2>
                              <p hlmAlertDialogDescription>{{ t('forms.deleteHint') }}</p>
                            </hlm-alert-dialog-header>
                            <hlm-alert-dialog-footer>
                              <button hlmAlertDialogCancel (click)="ctx.close()">
                                {{ t('common.cancel') }}
                              </button>
                              <button
                                hlmAlertDialogAction
                                variant="destructive"
                                (click)="ctx.close(); remove(form)"
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
export class FormsPage {
  private readonly site = inject(Site);
  private readonly config = inject(RUNTIME_CONFIG);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  protected readonly access = siteAccess('forms');
  protected readonly endpoint = `${this.config.contentApiBase}/_forms/{slug}`;
  /** The forms, loaded once the page can be used (idle until then). */
  protected readonly forms = resource({
    params: () => (this.access() === 'ok' ? true : undefined),
    loader: () => this.site.forms(),
  });
  protected readonly error = loadErrorOf(this.forms);

  protected async remove(form: Form): Promise<void> {
    try {
      await this.site.deleteForm(form.id);
      if (this.forms.hasValue()) {
        this.forms.update((list) => (list ?? []).filter((item) => item.id !== form.id));
      }
      toast.success(this.t('forms.deleted', { name: form.name }));
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    }
  }
}
