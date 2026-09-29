import { ChangeDetectionStrategy, Component, Injectable, inject, signal } from '@angular/core';
import { CanDeactivateFn } from '@angular/router';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';

import { I18n } from '../../core/i18n/i18n';

/** What a confirmation asks (texts already translated). */
export interface ConfirmOptions {
  title: string;
  description?: string;
  /** The confirming button's label (default: "Continue"). */
  confirm?: string;
  /** A destructive action: the confirming button is red. */
  destructive?: boolean;
}

interface ConfirmRequest extends ConfirmOptions {
  resolve: (confirmed: boolean) => void;
}

/**
 * Asks the admin to confirm an action, from code (route guards, actions that discard
 * work). One question at a time: a new one answers the previous with "no". The dialog
 * renders in `vd-confirm-host`, placed once at the root.
 */
@Injectable({ providedIn: 'root' })
export class Confirm {
  private readonly i18n = inject(I18n);
  readonly request = signal<ConfirmRequest | null>(null);

  ask(options: ConfirmOptions): Promise<boolean> {
    this.answer(false);
    return new Promise<boolean>((resolve) => this.request.set({ ...options, resolve }));
  }

  /** "Discard the unsaved changes?" */
  discardChanges(): Promise<boolean> {
    const t = this.i18n.t;
    return this.ask({
      title: t('common.unsaved.title'),
      description: t('common.unsaved.hint'),
      confirm: t('common.unsaved.discard'),
      destructive: true,
    });
  }

  /** Answers the open question, if any. */
  answer(confirmed: boolean): void {
    const request = this.request();
    if (!request) return;
    this.request.set(null);
    request.resolve(confirmed);
  }
}

/** The dialog of `Confirm`. */
@Component({
  selector: 'vd-confirm-host',
  imports: [HlmAlertDialogImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-alert-dialog
      [state]="confirm.request() ? 'open' : 'closed'"
      (closed)="confirm.answer(false)"
    >
      <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx" data-testid="confirm-dialog">
        @if (confirm.request(); as request) {
          <hlm-alert-dialog-header>
            <h2 hlmAlertDialogTitle>{{ request.title }}</h2>
            @if (request.description) {
              <p hlmAlertDialogDescription>{{ request.description }}</p>
            }
          </hlm-alert-dialog-header>
          <hlm-alert-dialog-footer>
            <button hlmAlertDialogCancel type="button" (click)="confirm.answer(false)">
              {{ t('common.cancel') }}
            </button>
            <button
              hlmAlertDialogAction
              type="button"
              data-testid="confirm-accept"
              [variant]="request.destructive ? 'destructive' : 'default'"
              (click)="confirm.answer(true)"
            >
              {{ request.confirm ?? t('common.continue') }}
            </button>
          </hlm-alert-dialog-footer>
        }
      </hlm-alert-dialog-content>
    </hlm-alert-dialog>
  `,
})
export class ConfirmHost {
  protected readonly confirm = inject(Confirm);
  protected readonly t = inject(I18n).t;
}

/** A page that may hold unsaved changes. */
export interface HasUnsavedChanges {
  hasUnsavedChanges(): boolean;
}

/** Leaving a page with unsaved changes asks first. */
export const unsavedChangesGuard: CanDeactivateFn<HasUnsavedChanges> = (page) =>
  page?.hasUnsavedChanges?.() ? inject(Confirm).discardChanges() : true;
