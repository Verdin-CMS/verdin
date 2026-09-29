import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  untracked,
} from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';

import { I18n } from '../../core/i18n/i18n';
import { Schema } from '../../core/schema';
import { HasUnsavedChanges } from '../../shared/components/confirm';
import { PageHeader } from '../../shared/components/page-header';
import { AttributeList } from './attribute-list';
import { segments } from './builder-model';
import { BuilderSidebar } from './builder-sidebar';
import { BuilderStore } from './builder-store';
import { FieldDialog } from './field-dialog';
import { PlanDialog } from './plan-dialog';
import { TypeSettings } from './type-settings';

/**
 * The content-type builder page: the list of types and components, and the drafted one's
 * settings and fields, saved through a reviewed migration plan. Its state is `BuilderStore`.
 */
@Component({
  selector: 'vd-builder',
  imports: [
    NgIcon,
    PageHeader,
    HlmAlertImports,
    HlmButtonImports,
    HlmCardImports,
    HlmSpinnerImports,
    BuilderSidebar,
    TypeSettings,
    AttributeList,
    FieldDialog,
    PlanDialog,
  ],
  providers: [BuilderStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:beforeunload)': 'beforeUnload($event)' },
  template: `
    @if (!schema.devMode()) {
      <div hlmAlert>
        <ng-icon name="lucideInfo" />
        <p hlmAlertTitle>{{ t('builder.devOnly.title') }}</p>
        <p hlmAlertDescription>
          @for (part of segments(t('builder.devOnly.description')); track $index) {
            @if ($odd) {
              <code class="bg-muted rounded px-1 py-0.5 font-mono text-xs">{{ part }}</code>
            } @else {
              {{ part }}
            }
          }
        </p>
      </div>
    } @else if (!store.sources()) {
      <div class="flex justify-center py-16"><hlm-spinner /></div>
    } @else {
      <div class="grid items-start gap-6 lg:grid-cols-[16rem_1fr]">
        <aside vdBuilderSidebar></aside>

        @if (store.draft()) {
          <section class="flex min-w-0 flex-col gap-6">
            <vd-page-header [title]="headerTitle()" [description]="headerDescription()">
              <div actions>
                @if (!store.isNew()) {
                  <button hlmBtn variant="ghost" (click)="store.remove()" [disabled]="store.busy()">
                    <ng-icon name="lucideTrash2" /> {{ t('common.delete') }}
                  </button>
                }
                <button hlmBtn (click)="store.plan()" [disabled]="store.busy()">
                  @if (store.busy()) {
                    <hlm-spinner />
                  } @else {
                    <ng-icon name="lucideSave" />
                  }
                  {{ t('common.save') }}
                </button>
              </div>
            </vd-page-header>

            <section hlmCard vdTypeSettings></section>
            <section hlmCard vdAttributeList></section>
          </section>
        }
      </div>
    }

    <vd-field-dialog />
    <vd-plan-dialog />
  `,
})
export class Builder implements HasUnsavedChanges {
  protected readonly store = inject(BuilderStore);
  protected readonly schema = inject(Schema);
  protected readonly t = inject(I18n).t;
  protected readonly segments = segments;

  /** A content type's singularName, `component:category.name`, `new` or `new-component`. */
  readonly name = input<string>();

  protected readonly headerTitle = computed(() => {
    const displayName = this.store.draft()?.['displayName'];
    if (displayName) return String(displayName);
    return this.t(
      this.store.isComponent() ? 'builder.header.newComponent' : 'builder.header.newContentType',
    );
  });
  protected readonly headerDescription = computed(() => {
    const file = this.store.draft();
    if (!file || this.store.isNew()) return this.t('builder.header.newDescription');
    if (this.store.isComponent())
      return this.t('builder.header.component', { name: this.store.componentUid() });
    return this.t(
      file['kind'] === 'singleType' ? 'builder.header.singleType' : 'builder.header.collectionType',
      { name: String(file['singularName'] ?? '') },
    );
  });

  constructor() {
    this.store.connect(this.name);
    void this.store.reloadSources();
    effect(() => {
      const name = this.name();
      const sources = this.store.sources();
      untracked(() => void this.store.reopen(name, sources));
    });
  }

  /** Edits to the type or component that are not applied yet. */
  hasUnsavedChanges(): boolean {
    return this.store.hasUnsavedChanges();
  }

  /** Closing or reloading the tab with unsaved edits: the browser asks first. */
  protected beforeUnload(event: BeforeUnloadEvent): void {
    if (this.hasUnsavedChanges()) event.preventDefault();
  }
}
