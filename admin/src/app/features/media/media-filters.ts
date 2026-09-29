import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { HlmInputGroupImports } from '@spartan-ng/helm/input-group';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';

import { I18n } from '../../core/i18n/i18n';
import { MessageKey } from '../../core/i18n/keys';
import { MediaSort } from '../../core/media';
import { MediaKind } from '../../core/types';
import { KIND_LABELS, MEDIA_KINDS } from './media-format';
import { MediaListing } from './media-listing';

const SORTS: { value: MediaSort; label: MessageKey }[] = [
  { value: 'createdAtDesc', label: 'media.sort.createdAtDesc' },
  { value: 'createdAtAsc', label: 'media.sort.createdAtAsc' },
  { value: 'updatedAtDesc', label: 'media.sort.updatedAtDesc' },
  { value: 'nameAsc', label: 'media.sort.nameAsc' },
  { value: 'nameDesc', label: 'media.sort.nameDesc' },
  { value: 'sizeDesc', label: 'media.sort.sizeDesc' },
];

/**
 * Search, kind and (optionally) sort of a media listing; anything projected follows them
 * (the library's view toggle, the picker's upload button).
 */
@Component({
  selector: 'vd-media-filters',
  imports: [NgIcon, HlmInputGroupImports, HlmNativeSelectImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-wrap items-center' },
  template: `
    <div hlmInputGroup class="w-full" [class]="compact() ? 'sm:max-w-60' : 'sm:max-w-xs'">
      <div hlmInputGroupAddon><ng-icon name="lucideSearch" /></div>
      <input
        hlmInputGroupInput
        type="search"
        [attr.aria-label]="t('media.search')"
        [placeholder]="t('media.search')"
        [value]="listing().searchText()"
        (input)="listing().setSearch($any($event.target).value)"
      />
    </div>
    @if (kinds().length > 1) {
      <hlm-native-select
        class="w-40"
        [size]="compact() ? 'sm' : 'default'"
        [attr.aria-label]="t('media.filter.type')"
        [value]="listing().kind()"
        (valueChange)="listing().setKind($any($event) ?? '')"
      >
        <option hlmNativeSelectOption value="">{{ t('media.filter.all') }}</option>
        @for (option of kinds(); track option) {
          <option hlmNativeSelectOption [value]="option">{{ t(kindLabels[option]) }}</option>
        }
      </hlm-native-select>
    }
    @if (sortable()) {
      <hlm-native-select
        class="w-48"
        [attr.aria-label]="t('media.sort.label')"
        [value]="listing().sort()"
        (valueChange)="listing().setSort($any($event))"
      >
        @for (option of sorts; track option.value) {
          <option hlmNativeSelectOption [value]="option.value">{{ t(option.label) }}</option>
        }
      </hlm-native-select>
    }
    <ng-content />
  `,
})
export class MediaFilters {
  protected readonly t = inject(I18n).t;
  protected readonly kindLabels = KIND_LABELS;
  protected readonly sorts = SORTS;

  readonly listing = input.required<MediaListing>();
  /** Kinds offered in the type filter (hidden with one kind or none). */
  readonly kinds = input<MediaKind[]>(MEDIA_KINDS);
  readonly sortable = input(false);
  /** Smaller controls (the picker dialog). */
  readonly compact = input(false);
}
