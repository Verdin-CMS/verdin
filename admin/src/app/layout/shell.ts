import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDropdownMenuImports } from '@spartan-ng/helm/dropdown-menu';
import { HlmSidebarImports } from '@spartan-ng/helm/sidebar';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { HlmAlertImports } from '@spartan-ng/helm/alert';

import { ApiFailure } from '../core/api';
import { Auth } from '../core/auth';
import { Schema } from '../core/schema';

@Component({
  selector: 'vd-shell',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    NgIcon,
    HlmSidebarImports,
    HlmDropdownMenuImports,
    HlmButtonImports,
    HlmSpinnerImports,
    HlmAlertImports,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div hlmSidebarWrapper>
      <hlm-sidebar>
        <div hlmSidebarHeader>
          <a routerLink="/" class="flex items-center gap-2 px-2 py-1.5 font-semibold">
            <ng-icon name="lucideLeaf" />
            Verdin
          </a>
        </div>
        <div hlmSidebarContent>
          <div hlmSidebarGroup>
            <div hlmSidebarGroupLabel>Collections</div>
            <div hlmSidebarGroupContent>
              <ul hlmSidebarMenu>
                @for (type of schema.collections(); track type.uid) {
                  <li hlmSidebarMenuItem>
                    <a
                      hlmSidebarMenuButton
                      [routerLink]="['/content', type.uid]"
                      routerLinkActive
                      #collection="routerLinkActive"
                      [isActive]="collection.isActive"
                    >
                      <ng-icon name="lucideFileText" />
                      <span>{{ type.displayName }}</span>
                    </a>
                  </li>
                } @empty {
                  <li class="text-muted-foreground px-2 text-sm">No content types yet</li>
                }
              </ul>
            </div>
          </div>
          @if (schema.singles().length) {
            <div hlmSidebarGroup>
              <div hlmSidebarGroupLabel>Single types</div>
              <div hlmSidebarGroupContent>
                <ul hlmSidebarMenu>
                  @for (type of schema.singles(); track type.uid) {
                    <li hlmSidebarMenuItem>
                      <a
                        hlmSidebarMenuButton
                        [routerLink]="['/single', type.uid]"
                        routerLinkActive
                        #single="routerLinkActive"
                        [isActive]="single.isActive"
                      >
                        <ng-icon name="lucideFile" />
                        <span>{{ type.displayName }}</span>
                      </a>
                    </li>
                  }
                </ul>
              </div>
            </div>
          }
          <div hlmSidebarGroup>
            <div hlmSidebarGroupLabel>Settings</div>
            <div hlmSidebarGroupContent>
              <ul hlmSidebarMenu>
                @if (schema.devMode() && auth.can('schema.manage')) {
                  <li hlmSidebarMenuItem>
                    <a
                      hlmSidebarMenuButton
                      routerLink="/builder"
                      routerLinkActive
                      #builder="routerLinkActive"
                      [isActive]="builder.isActive"
                    >
                      <ng-icon name="lucideBlocks" />
                      <span>Content-type builder</span>
                    </a>
                  </li>
                }
                @if (auth.can('users.manage')) {
                  <li hlmSidebarMenuItem>
                    <a
                      hlmSidebarMenuButton
                      routerLink="/settings/users"
                      routerLinkActive
                      #users="routerLinkActive"
                      [isActive]="users.isActive"
                    >
                      <ng-icon name="lucideUsers" />
                      <span>Users</span>
                    </a>
                  </li>
                }
                @if (auth.can('roles.manage')) {
                  <li hlmSidebarMenuItem>
                    <a
                      hlmSidebarMenuButton
                      routerLink="/settings/roles"
                      routerLinkActive
                      #roles="routerLinkActive"
                      [isActive]="roles.isActive"
                    >
                      <ng-icon name="lucideShieldCheck" />
                      <span>Roles</span>
                    </a>
                  </li>
                  <li hlmSidebarMenuItem>
                    <a
                      hlmSidebarMenuButton
                      routerLink="/settings/public"
                      routerLinkActive
                      #public="routerLinkActive"
                      [isActive]="public.isActive"
                    >
                      <ng-icon name="lucideGlobe" />
                      <span>Public access</span>
                    </a>
                  </li>
                }
                @if (auth.can('tokens.manage')) {
                  <li hlmSidebarMenuItem>
                    <a
                      hlmSidebarMenuButton
                      routerLink="/settings/tokens"
                      routerLinkActive
                      #tokens="routerLinkActive"
                      [isActive]="tokens.isActive"
                    >
                      <ng-icon name="lucideKeyRound" />
                      <span>API tokens</span>
                    </a>
                  </li>
                }
              </ul>
            </div>
          </div>
        </div>
        <div hlmSidebarFooter>
          <ul hlmSidebarMenu>
            <li hlmSidebarMenuItem>
              <button
                hlmSidebarMenuButton
                [hlmDropdownMenuTrigger]="account"
                align="start"
                side="top"
              >
                <span class="truncate">{{ auth.user()?.email }}</span>
                <ng-icon name="lucideChevronsUpDown" class="ms-auto" />
              </button>
              <ng-template #account>
                <hlm-dropdown-menu class="w-56">
                  <button hlmDropdownMenuItem (click)="auth.logout()">
                    <ng-icon name="lucideLogOut" />
                    Log out
                  </button>
                </hlm-dropdown-menu>
              </ng-template>
            </li>
          </ul>
        </div>
      </hlm-sidebar>
      <main hlmSidebarInset>
        <header class="flex h-12 items-center gap-2 border-b px-4">
          <button hlmSidebarTrigger><span class="sr-only">Toggle sidebar</span></button>
          @if (schema.info(); as info) {
            <span class="text-muted-foreground ms-auto text-xs"
              >v{{ info.version }} · {{ info.database }} · {{ info.mode }}</span
            >
          }
        </header>
        <div class="p-6">
          @if (error()) {
            <div hlmAlert variant="destructive">
              <p hlmAlertTitle>Could not load the schema</p>
              <p hlmAlertDescription>{{ error() }}</p>
            </div>
          } @else if (!schema.loaded()) {
            <hlm-spinner />
          } @else {
            <router-outlet />
          }
        </div>
      </main>
    </div>
  `,
})
export class Shell implements OnInit {
  protected readonly auth = inject(Auth);
  protected readonly schema = inject(Schema);
  protected readonly error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    try {
      await this.schema.load();
    } catch (error) {
      this.error.set(ApiFailure.from(error).message);
    }
  }
}
