import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';

import { ContentLocales } from '../../../core/content-locales';
import { I18n } from '../../../core/i18n/i18n';
import { UsageProbe, Usages } from '../../../core/usage';
import { UsageWarning } from '../../../shared/components/usage';

/**
 * The editor's "Danger zone": deleting the entry (its version in `locale`, for localized
 * types), confirmed in a dialog that says where the entry is used.
 */
@Component({
  selector: 'vd-entry-danger-zone',
  imports: [NgIcon, UsageWarning, HlmAlertDialogImports, HlmButtonImports, HlmCardImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    <section hlmCard size="sm" class="ring-destructive/30">
      <div hlmCardHeader>
        <h2 hlmCardTitle>{{ t('content.edit.dangerZone') }}</h2>
        <p hlmCardDescription>
          {{
            locale()
              ? t('content.locale.dangerHint', { locale: locales.name(locale()) })
              : t('content.edit.dangerHint')
          }}
        </p>
      </div>
      <div hlmCardFooter>
        <hlm-alert-dialog>
          <button
            hlmAlertDialogTrigger
            hlmBtn
            variant="destructive"
            size="sm"
            type="button"
            class="w-full"
            (click)="checkUsage()"
          >
            <ng-icon name="lucideTrash2" /> {{ t('common.delete') }}
          </button>
          <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx">
            <hlm-alert-dialog-header>
              <h2 hlmAlertDialogTitle>{{ t('content.edit.deleteTitle') }}</h2>
              <p hlmAlertDialogDescription>{{ t('content.edit.deleteHint') }}</p>
            </hlm-alert-dialog-header>
            <vd-usage-warning [state]="usage.state()" />
            <hlm-alert-dialog-footer>
              <button hlmAlertDialogCancel (click)="ctx.close()">
                {{ t('common.cancel') }}
              </button>
              <button
                hlmAlertDialogAction
                variant="destructive"
                (click)="ctx.close(); confirmed.emit()"
              >
                {{ t('common.delete') }}
              </button>
            </hlm-alert-dialog-footer>
          </hlm-alert-dialog-content>
        </hlm-alert-dialog>
      </div>
    </section>
  `,
})
export class EntryDangerZone {
  protected readonly t = inject(I18n).t;
  protected readonly locales = inject(ContentLocales);
  private readonly usages = inject(Usages);

  readonly uid = input.required<string>();
  readonly documentId = input.required<string>();
  readonly locale = input<string | null>(null);
  /** The admin confirmed the deletion. */
  readonly confirmed = output<void>();

  /** Where the entry is used, for the confirmation. */
  protected readonly usage = new UsageProbe();

  protected checkUsage(): void {
    const uid = this.uid();
    const documentId = this.documentId();
    // References from the entry itself go with it.
    void this.usage.start(async () => {
      const result = await this.usages.forEntry(uid, documentId, this.locale());
      return {
        ...result,
        data: result.data.filter((usage) => usage.uid !== uid || usage.documentId !== documentId),
      };
    });
  }
}
