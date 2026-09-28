import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
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
import { fromItems, countItems } from '../../core/menu-tree';
import { Menu, Site } from '../../core/site';
import { PageHeader } from '../../shared/components/page-header';
import { SiteAccessNotice, siteAccess } from './site-access';

/** Settings → Menus: navigation trees that sites fetch from `/api/_menus/{slug}`. */
@Component({
  selector: 'vd-menus',
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
        [title]="t('menus.title')"
        [description]="t('menus.description', { endpoint: endpoint })"
      >
        <span eyebrow class="text-primary flex items-center gap-1.5 text-xs font-medium">
          <ng-icon name="lucideListTree" size="14" /> {{ t('shell.settings') }}
        </span>
        @if (access() === 'ok') {
          <div actions>
            <a hlmBtn routerLink="/settings/menus/new">
              <ng-icon name="lucidePlus" /> {{ t('menus.create') }}
            </a>
          </div>
        }
      </vd-page-header>

      @if (access() !== 'ok') {
        <vd-site-access [access]="access()" feature="menus" />
      } @else if (error()) {
        <p class="text-destructive text-sm" role="alert">{{ error() }}</p>
      } @else if (menus() === null) {
        <hlm-skeleton class="h-48 rounded-xl" />
      } @else if (menus()!.length === 0) {
        <div hlmEmpty class="rounded-xl border border-dashed py-16">
          <div hlmEmptyHeader>
            <div hlmEmptyMedia variant="icon"><ng-icon name="lucideListTree" /></div>
            <h2 hlmEmptyTitle>{{ t('menus.emptyTitle') }}</h2>
            <p hlmEmptyDescription>{{ t('menus.emptyHint') }}</p>
          </div>
          <div hlmEmptyContent>
            <a hlmBtn variant="outline" routerLink="/settings/menus/new">
              <ng-icon name="lucidePlus" /> {{ t('menus.create') }}
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
                  <th hlmTh>{{ t('menus.items') }}</th>
                  <th hlmTh>{{ t('menus.updated') }}</th>
                  <th hlmTh class="pe-4">
                    <span class="sr-only">{{ t('common.actions') }}</span>
                  </th>
                </tr>
              </thead>
              <tbody hlmTBody>
                @for (menu of menus(); track menu.id) {
                  <tr hlmTr data-menu>
                    <td hlmTd class="ps-4">
                      <a class="group flex flex-col" [routerLink]="['/settings/menus', menu.id]">
                        <span class="font-medium group-hover:underline">{{ menu.name }}</span>
                        <span dir="ltr" class="text-muted-foreground font-mono text-xs">{{
                          menu.slug
                        }}</span>
                      </a>
                    </td>
                    <td hlmTd>
                      <span hlmBadge variant="secondary">{{
                        t('menus.itemCount', { count: count(menu) })
                      }}</span>
                    </td>
                    <td hlmTd class="text-muted-foreground text-xs">
                      {{ i18n.formatRelative(menu.updatedAt) }}
                    </td>
                    <td hlmTd class="pe-4">
                      <div class="flex justify-end gap-1">
                        <a
                          hlmBtn
                          size="icon-sm"
                          variant="ghost"
                          class="text-muted-foreground"
                          [routerLink]="['/settings/menus', menu.id]"
                          [attr.aria-label]="t('menus.editLabel', { name: menu.name })"
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
                            [attr.aria-label]="t('menus.deleteLabel', { name: menu.name })"
                            [attr.title]="t('common.delete')"
                          >
                            <ng-icon name="lucideTrash2" />
                          </button>
                          <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx">
                            <hlm-alert-dialog-header>
                              <h2 hlmAlertDialogTitle>
                                {{ t('menus.deleteTitle', { name: menu.name }) }}
                              </h2>
                              <p hlmAlertDialogDescription>{{ t('menus.deleteHint') }}</p>
                            </hlm-alert-dialog-header>
                            <hlm-alert-dialog-footer>
                              <button hlmAlertDialogCancel (click)="ctx.close()">
                                {{ t('common.cancel') }}
                              </button>
                              <button
                                hlmAlertDialogAction
                                variant="destructive"
                                (click)="ctx.close(); remove(menu)"
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
export class MenusPage {
  private readonly site = inject(Site);
  private readonly config = inject(RUNTIME_CONFIG);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  protected readonly access = siteAccess('menus');
  protected readonly endpoint = `${this.config.contentApiBase}/_menus/{slug}`;
  protected readonly menus = signal<Menu[] | null>(null);
  protected readonly error = signal<string | null>(null);
  private loaded = false;

  constructor() {
    effect(() => {
      if (this.access() === 'ok' && !this.loaded) untracked(() => void this.load());
    });
  }

  private async load(): Promise<void> {
    this.loaded = true;
    try {
      this.menus.set(await this.site.menus());
    } catch (error) {
      this.error.set(ApiFailure.from(error).message);
    }
  }

  protected count(menu: Menu): number {
    return countItems(fromItems(menu.items));
  }

  protected async remove(menu: Menu): Promise<void> {
    try {
      await this.site.deleteMenu(menu.id);
      this.menus.update((list) => (list ?? []).filter((item) => item.id !== menu.id));
      toast.success(this.t('menus.deleted', { name: menu.name }));
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    }
  }
}
