import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmSwitchImports } from '@spartan-ng/helm/switch';
import { HlmToggleGroupImports } from '@spartan-ng/helm/toggle-group';

import { I18n } from '../../core/i18n/i18n';
import { kebab, segments } from './builder-model';
import { BuilderStore } from './builder-store';

/**
 * The drafted type's settings card: display name and API names, kind, draft and publish and
 * localization for content types; display name and UID for components.
 */
@Component({
  selector: 'section[vdTypeSettings]',
  imports: [
    NgIcon,
    HlmCardImports,
    HlmFieldImports,
    HlmInputImports,
    HlmSwitchImports,
    HlmToggleGroupImports,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.draft(); as file) {
      <div hlmCardHeader>
        <h2 hlmCardTitle>{{ t('builder.settings.title') }}</h2>
      </div>
      <div hlmCardContent class="grid gap-4 sm:grid-cols-2">
        <div hlmField>
          <label hlmFieldLabel for="display-name">{{ t('builder.settings.displayName') }}</label>
          <input
            hlmInput
            id="display-name"
            [value]="file['displayName'] ?? ''"
            (input)="store.setDisplayName($any($event.target).value)"
          />
        </div>
        @if (store.isComponent()) {
          <div hlmField>
            <label hlmFieldLabel for="component-uid">{{
              t('builder.settings.componentUid')
            }}</label>
            <input
              dir="ltr"
              hlmInput
              id="component-uid"
              class="font-mono"
              [value]="store.componentUid()"
              [disabled]="!store.isNew()"
              (input)="store.componentUid.set($any($event.target).value)"
            />
            <p hlmFieldDescription>
              @for (part of segments(t('builder.settings.componentUidHint')); track $index) {
                @if ($odd) {
                  <code>{{ part }}</code>
                } @else {
                  {{ part }}
                }
              }
            </p>
          </div>
        } @else {
          <div hlmField>
            <label hlmFieldLabel for="singular">{{ t('builder.settings.singular') }}</label>
            <input
              dir="ltr"
              hlmInput
              id="singular"
              class="font-mono"
              [value]="file['singularName'] ?? ''"
              [disabled]="!store.isNew()"
              (input)="store.setFileValue('singularName', kebab($any($event.target).value))"
            />
            @if (!store.isNew()) {
              <p hlmFieldDescription>{{ t('builder.settings.lockedHint') }}</p>
            }
          </div>
          <div hlmField>
            <label hlmFieldLabel for="plural">{{ t('builder.settings.plural') }}</label>
            <input
              dir="ltr"
              hlmInput
              id="plural"
              class="font-mono"
              [value]="file['pluralName'] ?? ''"
              [disabled]="!store.isNew()"
              (input)="store.setFileValue('pluralName', kebab($any($event.target).value))"
            />
            @if (!store.isNew()) {
              <p hlmFieldDescription>{{ t('builder.settings.lockedHint') }}</p>
            }
          </div>
          <div hlmField>
            <span hlmFieldLabel>{{ t('builder.settings.kind') }}</span>
            <hlm-toggle-group
              type="single"
              variant="outline"
              [value]="file['kind']"
              (valueChange)="$event && store.setFileValue('kind', $event)"
            >
              <button hlmToggleGroupItem value="collectionType">
                <ng-icon name="lucideDatabase" size="16" />
                {{ t('builder.settings.collection') }}
              </button>
              <button hlmToggleGroupItem value="singleType">
                <ng-icon name="lucideFile" size="16" />
                {{ t('builder.settings.single') }}
              </button>
            </hlm-toggle-group>
          </div>
          <div hlmField orientation="horizontal" class="self-end">
            <hlm-switch
              inputId="dp"
              [checked]="store.draftAndPublish()"
              (checkedChange)="store.setDraftAndPublish($event)"
            />
            <div hlmFieldContent>
              <label hlmFieldLabel for="dp">{{ t('builder.settings.draftAndPublish') }}</label>
              <p hlmFieldDescription>{{ t('builder.settings.draftAndPublishHint') }}</p>
            </div>
          </div>
          <div hlmField orientation="horizontal">
            <hlm-switch
              inputId="localized"
              [checked]="store.localized()"
              (checkedChange)="store.setLocalized($event)"
            />
            <div hlmFieldContent>
              <label hlmFieldLabel for="localized">{{ t('builder.settings.localized') }}</label>
              <p hlmFieldDescription>{{ t('builder.settings.localizedHint') }}</p>
            </div>
          </div>
        }
      </div>
    }
  `,
})
export class TypeSettings {
  protected readonly store = inject(BuilderStore);
  protected readonly t = inject(I18n).t;
  protected readonly segments = segments;
  protected readonly kebab = kebab;
}
