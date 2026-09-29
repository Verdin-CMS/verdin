import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButtonImports } from '@spartan-ng/helm/button';

import { I18n } from '../../core/i18n/i18n';

/** A page's data could not be loaded: the reason and a retry button. */
@Component({
  selector: 'vd-load-error',
  imports: [NgIcon, HlmAlertImports, HlmButtonImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div hlmAlert variant="destructive" data-testid="load-error">
      <ng-icon hlmAlertIcon name="lucideCircleAlert" />
      <p hlmAlertTitle>{{ t('common.loadError') }}</p>
      <p hlmAlertDescription>{{ message() }}</p>
      <div class="col-start-2 mt-2">
        <button hlmBtn variant="outline" size="sm" type="button" (click)="retry.emit()">
          <ng-icon name="lucideRotateCcw" /> {{ t('common.retry') }}
        </button>
      </div>
    </div>
  `,
})
export class LoadError {
  protected readonly t = inject(I18n).t;
  readonly message = input.required<string>();
  readonly retry = output<void>();
}
