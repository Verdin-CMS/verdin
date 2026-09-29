import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButtonImports } from '@spartan-ng/helm/button';

import { I18n } from '../../core/i18n/i18n';
import { BuilderStore } from './builder-store';

/** The builder's side list of content types and components, with links to create more. */
@Component({
  selector: 'aside[vdBuilderSidebar]',
  imports: [RouterLink, NgIcon, HlmButtonImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'bg-card flex flex-col gap-4 rounded-xl border p-3 shadow-xs lg:sticky lg:top-4',
  },
  template: `
    <nav class="flex flex-col gap-1" [attr.aria-label]="t('builder.sidebar.contentTypes')">
      <div class="flex items-center justify-between gap-2 px-2 pb-1">
        <h2 class="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {{ t('builder.sidebar.contentTypes') }}
        </h2>
        <a
          hlmBtn
          size="icon-xs"
          variant="ghost"
          routerLink="/builder/new"
          [attr.aria-label]="t('builder.sidebar.newContentType')"
          [attr.title]="t('builder.sidebar.newContentType')"
          ><ng-icon name="lucidePlus"
        /></a>
      </div>
      @for (entry of store.typeEntries(); track entry.key) {
        @let current = store.name() === entry.key;
        <a
          class="hover:bg-muted flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors"
          [class.bg-primary/10]="current"
          [class.text-primary]="current"
          [class.font-medium]="current"
          [attr.aria-current]="current ? 'page' : null"
          [routerLink]="['/builder', entry.key]"
        >
          <ng-icon
            [name]="entry.single ? 'lucideFile' : 'lucideDatabase'"
            size="16"
            class="shrink-0 opacity-70"
          />
          <span class="truncate">{{ entry.label }}</span>
          @if (entry.single) {
            <span class="text-muted-foreground ms-auto text-xs">{{
              t('builder.sidebar.single')
            }}</span>
          }
        </a>
      } @empty {
        <p class="text-muted-foreground px-2 py-1 text-sm">
          {{ t('builder.sidebar.noContentTypes') }}
        </p>
      }
    </nav>
    <div class="border-t"></div>
    <nav class="flex flex-col gap-1" [attr.aria-label]="t('builder.sidebar.components')">
      <div class="flex items-center justify-between gap-2 px-2 pb-1">
        <h2 class="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {{ t('builder.sidebar.components') }}
        </h2>
        <a
          hlmBtn
          size="icon-xs"
          variant="ghost"
          routerLink="/builder/new-component"
          [attr.aria-label]="t('builder.sidebar.newComponent')"
          [attr.title]="t('builder.sidebar.newComponent')"
          ><ng-icon name="lucidePlus"
        /></a>
      </div>
      @for (entry of store.componentEntries(); track entry.key) {
        @let current = store.name() === entry.key;
        <a
          class="hover:bg-muted flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors"
          [class.bg-primary/10]="current"
          [class.text-primary]="current"
          [class.font-medium]="current"
          [attr.aria-current]="current ? 'page' : null"
          [routerLink]="['/builder', entry.key]"
        >
          <ng-icon name="lucideBlocks" size="16" class="shrink-0 opacity-70" />
          <span class="flex min-w-0 flex-col">
            <span class="truncate">{{ entry.displayName }}</span>
            <span class="text-muted-foreground truncate font-mono text-xs font-normal">{{
              entry.uid
            }}</span>
          </span>
        </a>
      } @empty {
        <p class="text-muted-foreground px-2 py-1 text-sm">
          {{ t('builder.sidebar.noComponents') }}
        </p>
      }
    </nav>
  `,
})
export class BuilderSidebar {
  protected readonly store = inject(BuilderStore);
  protected readonly t = inject(I18n).t;
}
