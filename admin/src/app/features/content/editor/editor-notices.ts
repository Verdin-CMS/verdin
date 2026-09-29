import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButtonImports } from '@spartan-ng/helm/button';

import { ContentLocales } from '../../../core/content-locales';
import { I18n } from '../../../core/i18n/i18n';

/**
 * A locale the document has no version in yet: saving creates it, and its localized
 * fields can be copied (or translated) from another locale's version.
 */
@Component({
  selector: 'vd-missing-locale-notice',
  imports: [NgIcon, HlmAlertImports, HlmButtonImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    <div hlmAlert>
      <ng-icon hlmAlertIcon name="lucideLanguages" />
      <p hlmAlertTitle>
        {{ t('content.locale.missingTitle', { locale: locales.name(locale()) }) }}
      </p>
      <p hlmAlertDescription>{{ t('content.locale.missingHint') }}</p>
      @if (canFill()) {
        <div class="col-start-2 mt-2 flex flex-wrap gap-2">
          <button
            hlmBtn
            variant="outline"
            size="sm"
            type="button"
            [disabled]="busy()"
            (click)="fill.emit()"
          >
            <ng-icon name="lucideCopy" /> {{ t('content.locale.fill') }}
          </button>
          @if (canTranslate()) {
            <button
              hlmBtn
              variant="outline"
              size="sm"
              type="button"
              [disabled]="busy() || translating()"
              (click)="translate.emit()"
            >
              <ng-icon name="lucideSparkles" />
              {{ t('ai.translate.action', { locale: locales.name(translateFrom()) }) }}
            </button>
          }
        </div>
      }
    </div>
  `,
})
export class MissingLocaleNotice {
  protected readonly t = inject(I18n).t;
  protected readonly locales = inject(ContentLocales);

  readonly locale = input<string | null>(null);
  /** Another locale has a version to copy from. */
  readonly canFill = input(false);
  readonly canTranslate = input(false);
  readonly translateFrom = input('');
  readonly busy = input(false);
  readonly translating = input(false);
  readonly fill = output<void>();
  readonly translate = output<void>();
}

/** An AI translation applied to the form: its fields, to review, keep or undo. */
export interface TranslationChanges {
  /** The locale translated from. */
  source: string;
  /** The changed fields' paths. */
  fields: string[];
}

/** The banner of an AI translation: jump to the changed fields, keep them or undo them. */
@Component({
  selector: 'vd-translation-review',
  imports: [NgIcon, HlmAlertImports, HlmButtonImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    @let current = changes();
    <div hlmAlert role="status">
      <ng-icon hlmAlertIcon name="lucideSparkles" />
      <p hlmAlertTitle>
        {{
          t('ai.translate.reviewTitle', {
            count: current.fields.length,
            locale: locales.name(current.source),
          })
        }}
      </p>
      <div hlmAlertDescription class="flex flex-col gap-2">
        <p>{{ t('ai.translate.reviewHint') }}</p>
        <ul class="flex flex-wrap gap-1" [attr.aria-label]="t('ai.translate.changedFields')">
          @for (name of current.fields; track name) {
            <li>
              <button
                hlmBtn
                variant="secondary"
                size="xs"
                type="button"
                (click)="focusField.emit(name)"
              >
                {{ fieldLabel()(name) }}
              </button>
            </li>
          }
        </ul>
      </div>
      <div class="col-start-2 mt-2 flex flex-wrap gap-2">
        <button hlmBtn variant="outline" size="sm" type="button" (click)="undo.emit()">
          <ng-icon name="lucideUndo2" /> {{ t('ai.translate.undo') }}
        </button>
        <button hlmBtn variant="ghost" size="sm" type="button" (click)="keep.emit()">
          <ng-icon name="lucideCheck" /> {{ t('ai.translate.keep') }}
        </button>
      </div>
    </div>
  `,
})
export class TranslationReview {
  protected readonly t = inject(I18n).t;
  protected readonly locales = inject(ContentLocales);

  readonly changes = input.required<TranslationChanges>();
  /** A field path as it reads to the admin. */
  readonly fieldLabel = input<(path: string) => string>((path) => path);
  readonly focusField = output<string>();
  readonly undo = output<void>();
  readonly keep = output<void>();
}

/** Another admin changed (or deleted) the open entry: reload it, or carry on. */
@Component({
  selector: 'vd-remote-change-notice',
  imports: [NgIcon, HlmAlertImports, HlmButtonImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    @let change = event();
    <div hlmAlert>
      <ng-icon hlmAlertIcon name="lucideRefreshCw" />
      <p hlmAlertTitle>
        {{
          change === 'entry.delete'
            ? t('presence.remote.deleted')
            : change === 'entry.publish'
              ? t('presence.remote.published')
              : change === 'entry.unpublish'
                ? t('presence.remote.unpublished')
                : t('presence.remote.updated')
        }}
      </p>
      <p hlmAlertDescription>
        {{
          change === 'entry.delete' ? t('presence.remote.deletedHint') : t('presence.remote.hint')
        }}
      </p>
      <div class="col-start-2 mt-2 flex flex-wrap gap-2">
        @if (change !== 'entry.delete') {
          <button hlmBtn variant="outline" size="sm" type="button" (click)="reload.emit()">
            <ng-icon name="lucideRefreshCw" /> {{ t('presence.remote.reload') }}
          </button>
        }
        <button hlmBtn variant="ghost" size="sm" type="button" (click)="dismiss.emit()">
          {{ t('presence.remote.dismiss') }}
        </button>
      </div>
    </div>
  `,
})
export class RemoteChangeNotice {
  protected readonly t = inject(I18n).t;

  /** The realtime event's name (`entry.update`, `entry.delete`…). */
  readonly event = input.required<string>();
  readonly reload = output<void>();
  readonly dismiss = output<void>();
}
