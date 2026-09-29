import { ChangeDetectionStrategy, Component, inject, input, model, output } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';

import { AiActions } from '../../../core/ai';
import { ContentLocales } from '../../../core/content-locales';
import { I18n } from '../../../core/i18n/i18n';

/** "Fill from another locale": the locale whose localized fields are copied into the form. */
@Component({
  selector: 'vd-locale-fill-dialog',
  imports: [
    NgIcon,
    HlmButtonImports,
    HlmDialogImports,
    HlmFieldImports,
    HlmNativeSelectImports,
    HlmSpinnerImports,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-dialog [state]="open() ? 'open' : 'closed'" (closed)="closed.emit()">
      <hlm-dialog-content
        *hlmDialogPortal="let ctx"
        class="sm:max-w-md"
        [closeLabel]="t('common.close')"
      >
        <hlm-dialog-header>
          <h2 hlmDialogTitle>{{ t('content.locale.fill') }}</h2>
          <p hlmDialogDescription>{{ t('content.locale.fillDescription') }}</p>
        </hlm-dialog-header>
        <div hlmField>
          <label hlmFieldLabel for="fill-source">{{ t('content.locale.fillSource') }}</label>
          <hlm-native-select
            selectId="fill-source"
            [value]="source()"
            (valueChange)="source.set($event ?? '')"
          >
            @for (code of sources(); track code) {
              <option hlmNativeSelectOption [value]="code">
                {{ locales.name(code) }} ({{ code }})
              </option>
            }
          </hlm-native-select>
        </div>
        <hlm-dialog-footer>
          <button hlmBtn variant="outline" type="button" (click)="closed.emit()">
            {{ t('common.cancel') }}
          </button>
          <button hlmBtn type="button" [disabled]="!source() || busy()" (click)="confirm.emit()">
            @if (busy()) {
              <hlm-spinner />
            } @else {
              <ng-icon name="lucideCopy" />
            }
            {{ t('content.locale.fillAction') }}
          </button>
        </hlm-dialog-footer>
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class LocaleFillDialog {
  protected readonly t = inject(I18n).t;
  protected readonly locales = inject(ContentLocales);

  readonly open = input(false);
  /** Locales with a version to copy from. */
  readonly sources = input<readonly string[]>([]);
  readonly source = model('');
  readonly busy = input(false);
  readonly confirm = output<void>();
  readonly closed = output<void>();
}

/** "Translate from…": the locale whose draft the AI translates into the edited locale. */
@Component({
  selector: 'vd-translate-dialog',
  imports: [
    NgIcon,
    HlmButtonImports,
    HlmDialogImports,
    HlmFieldImports,
    HlmNativeSelectImports,
    HlmSpinnerImports,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-dialog [state]="open() ? 'open' : 'closed'" (closed)="closed.emit()">
      <hlm-dialog-content
        *hlmDialogPortal="let ctx"
        class="sm:max-w-md"
        [closeLabel]="t('common.close')"
      >
        <hlm-dialog-header>
          <h2 hlmDialogTitle>{{ t('ai.translate.title') }}</h2>
          <p hlmDialogDescription>
            {{ t('ai.translate.description', { locale: locales.name(locale()) }) }}
          </p>
        </hlm-dialog-header>
        <div hlmField>
          <label hlmFieldLabel for="translate-source">{{ t('ai.translate.source') }}</label>
          <hlm-native-select
            selectId="translate-source"
            [value]="source()"
            (valueChange)="source.set($event ?? '')"
          >
            @for (code of sources(); track code) {
              <option hlmNativeSelectOption [value]="code">
                {{ locales.name(code) }} ({{ code }})
              </option>
            }
          </hlm-native-select>
          <p hlmFieldDescription>{{ t('ai.translate.sourceHint') }}</p>
        </div>
        @if (ai.status(); as status) {
          @if (status.model) {
            <p class="text-muted-foreground text-xs">
              {{ t('ai.poweredBy', { provider: status.provider ?? '', model: status.model }) }}
            </p>
          }
        }
        <hlm-dialog-footer>
          <button hlmBtn variant="outline" type="button" (click)="closed.emit()">
            {{ t('common.cancel') }}
          </button>
          <button
            hlmBtn
            type="button"
            [disabled]="!source() || translating()"
            (click)="confirm.emit()"
          >
            @if (translating()) {
              <hlm-spinner />
            } @else {
              <ng-icon name="lucideLanguages" />
            }
            {{ translating() ? t('ai.translate.running') : t('ai.translate.run') }}
          </button>
        </hlm-dialog-footer>
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class TranslateDialog {
  protected readonly t = inject(I18n).t;
  protected readonly locales = inject(ContentLocales);
  protected readonly ai = inject(AiActions);

  readonly open = input(false);
  /** The edited locale (translated into). */
  readonly locale = input<string | null>(null);
  /** Locales with a version to translate from. */
  readonly sources = input<readonly string[]>([]);
  readonly source = model('');
  readonly translating = input(false);
  readonly confirm = output<void>();
  readonly closed = output<void>();
}
