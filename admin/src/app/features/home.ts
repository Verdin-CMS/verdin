import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';

import { Auth } from '../core/auth';
import { Schema } from '../core/schema';

@Component({
  selector: 'vd-home',
  imports: [RouterLink, NgIcon, HlmCardImports, HlmButtonImports, HlmEmptyImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-6">
      <div>
        <h1 class="text-2xl font-semibold">
          Hello{{ auth.user()?.firstname ? ', ' + auth.user()?.firstname : '' }}
        </h1>
        <p class="text-muted-foreground">
          Manage your content, or shape it in the content-type builder.
        </p>
      </div>
      @if (schema.contentTypes().length === 0) {
        <div hlmEmpty>
          <div hlmEmptyHeader>
            <div hlmEmptyMedia variant="icon"><ng-icon name="lucideBlocks" /></div>
            <h2 hlmEmptyTitle>No content types yet</h2>
            <p hlmEmptyDescription>
              @if (schema.devMode()) {
                Create your first one in the content-type builder.
              } @else {
                Add schema files and restart, or run <code>verdin dev</code> to use the builder.
              }
            </p>
          </div>
          @if (schema.devMode() && auth.can('schema.manage')) {
            <div hlmEmptyContent><a hlmBtn routerLink="/builder/new">Create a content type</a></div>
          }
        </div>
      } @else {
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          @for (type of schema.contentTypes(); track type.uid) {
            <a
              hlmCard
              [routerLink]="
                type.kind === 'singleType' ? ['/single', type.uid] : ['/content', type.uid]
              "
              class="hover:bg-accent transition-colors"
            >
              <div hlmCardHeader>
                <h2 hlmCardTitle>{{ type.displayName }}</h2>
                <p hlmCardDescription>
                  {{ type.kind === 'singleType' ? 'Single type' : 'Collection' }} · {{ type.uid }}
                </p>
              </div>
            </a>
          }
        </div>
      }
    </div>
  `,
})
export class HomePage {
  protected readonly auth = inject(Auth);
  protected readonly schema = inject(Schema);
}
