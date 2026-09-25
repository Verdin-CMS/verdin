import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { HlmTableImports } from '@spartan-ng/helm/table';

import { ApiFailure } from '../../core/api';
import { AUTHENTICATED_ROLE, EndUserRole, EndUsers } from '../../core/end-users';
import { I18n } from '../../core/i18n/i18n';
import { PageHeader } from '../../shared/components/page-header';
import { EndUsersNav } from './end-users-nav';

/** Settings → End users → Roles: what each kind of end user may do in the content API. */
@Component({
  selector: 'vd-end-user-roles',
  imports: [
    NgIcon,
    RouterLink,
    EndUsersNav,
    HlmAlertImports,
    HlmAlertDialogImports,
    HlmBadgeImports,
    HlmButtonImports,
    HlmSkeletonImports,
    HlmTableImports,
    PageHeader,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-6">
      <vd-page-header [title]="t('endUsers.title')" [description]="t('endUsers.description')">
        <span eyebrow class="text-primary flex items-center gap-1.5 text-xs font-medium">
          <ng-icon name="lucideContactRound" size="14" /> {{ t('shell.settings') }}
        </span>
        <div actions>
          <a hlmBtn routerLink="/settings/end-users/roles/new">
            <ng-icon name="lucidePlus" /> {{ t('endUsers.roles.create') }}
          </a>
        </div>
      </vd-page-header>
      <vd-end-users-nav />

      @if (error()) {
        <div hlmAlert variant="destructive">
          <ng-icon hlmAlertIcon name="lucideCircleAlert" />
          <p hlmAlertTitle>{{ t('endUsers.roles.loadError') }}</p>
          <p hlmAlertDescription>{{ error() }}</p>
        </div>
      } @else if (roles() === null) {
        <hlm-skeleton class="h-48 rounded-xl" />
      } @else {
        <div class="bg-card overflow-hidden rounded-xl border">
          <div hlmTableContainer>
            <table hlmTable>
              <thead hlmTHead class="bg-muted/50">
                <tr hlmTr class="hover:bg-transparent">
                  <th hlmTh class="ps-4">{{ t('common.name') }}</th>
                  <th hlmTh>{{ t('endUsers.roles.users') }}</th>
                  <th hlmTh>{{ t('endUsers.roles.permissions') }}</th>
                  <th hlmTh class="pe-4">
                    <span class="sr-only">{{ t('common.actions') }}</span>
                  </th>
                </tr>
              </thead>
              <tbody hlmTBody>
                @for (role of roles(); track role.id) {
                  <tr hlmTr>
                    <td hlmTd class="ps-4">
                      <a
                        class="group flex items-center gap-3"
                        [routerLink]="['/settings/end-users/roles', role.id]"
                      >
                        <span
                          class="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-lg"
                        >
                          <ng-icon name="lucideShieldCheck" size="16" />
                        </span>
                        <span class="flex min-w-0 flex-col">
                          <span class="flex items-center gap-2 font-medium group-hover:underline">
                            {{ role.name }}
                            @if (role.type === authenticated) {
                              <span hlmBadge variant="outline" class="font-normal">{{
                                t('endUsers.roles.default')
                              }}</span>
                            }
                          </span>
                          @if (role.description) {
                            <span class="text-muted-foreground max-w-md truncate text-xs">{{
                              role.description
                            }}</span>
                          }
                        </span>
                      </a>
                    </td>
                    <td hlmTd class="tabular-nums">
                      {{ t('endUsers.roles.userCount', { count: role.users }) }}
                    </td>
                    <td hlmTd class="tabular-nums">
                      <span hlmBadge variant="secondary">{{
                        t('endUsers.roles.grantCount', { count: role.permissions.length })
                      }}</span>
                    </td>
                    <td hlmTd class="pe-4">
                      <div class="flex justify-end gap-1">
                        <a
                          hlmBtn
                          size="icon-sm"
                          variant="ghost"
                          class="text-muted-foreground"
                          [routerLink]="['/settings/end-users/roles', role.id]"
                          [attr.aria-label]="t('endUsers.roles.editLabel', { name: role.name })"
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
                            [disabled]="role.type === authenticated"
                            [attr.aria-label]="t('endUsers.roles.deleteLabel', { name: role.name })"
                            [attr.title]="
                              role.type === authenticated
                                ? t('endUsers.roles.cannotDelete')
                                : t('common.delete')
                            "
                          >
                            <ng-icon name="lucideTrash2" />
                          </button>
                          <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx">
                            <hlm-alert-dialog-header>
                              <h2 hlmAlertDialogTitle>
                                {{ t('endUsers.roles.deleteTitle', { name: role.name }) }}
                              </h2>
                              <p hlmAlertDialogDescription>
                                {{ t('endUsers.roles.deleteHint', { count: role.users }) }}
                              </p>
                            </hlm-alert-dialog-header>
                            <hlm-alert-dialog-footer>
                              <button hlmAlertDialogCancel (click)="ctx.close()">
                                {{ t('common.cancel') }}
                              </button>
                              <button
                                hlmAlertDialogAction
                                variant="destructive"
                                (click)="ctx.close(); remove(role)"
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
          <div class="text-muted-foreground bg-muted/30 border-t px-4 py-2 text-xs">
            {{ t('endUsers.roles.count', { count: roles()!.length }) }}
          </div>
        </div>
      }
    </div>
  `,
})
export class EndUserRolesPage implements OnInit {
  private readonly service = inject(EndUsers);
  protected readonly t = inject(I18n).t;
  protected readonly authenticated = AUTHENTICATED_ROLE;
  protected readonly roles = signal<EndUserRole[] | null>(null);
  protected readonly error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  private async reload(): Promise<void> {
    try {
      this.roles.set(await this.service.roles());
      this.error.set(null);
    } catch (error) {
      this.error.set(ApiFailure.from(error).message);
    }
  }

  protected async remove(role: EndUserRole): Promise<void> {
    try {
      await this.service.removeRole(role.id);
      toast.success(this.t('endUsers.roles.deleted', { name: role.name }));
      // Its users moved to Authenticated: the counts changed.
      await this.reload();
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    }
  }
}
