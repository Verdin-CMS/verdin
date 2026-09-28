import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';

import { DeploymentStatus, statusLook } from '../../core/deploy';
import { I18n } from '../../core/i18n/i18n';
import { MessageKey } from '../../core/i18n/keys';

export const DEPLOY_STATUS_LABELS: Record<DeploymentStatus, MessageKey> = {
  triggered: 'deploy.status.triggered',
  failed: 'deploy.status.failed',
  building: 'deploy.status.building',
  ready: 'deploy.status.ready',
  error: 'deploy.status.error',
};

/** A deployment status as a badge (`null`: never deployed). */
@Component({
  selector: 'vd-deploy-status',
  imports: [NgIcon, HlmBadgeImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (status(); as status) {
      <span hlmBadge [variant]="look().variant" data-deploy-status [attr.data-status]="status">
        <ng-icon
          [name]="look().icon"
          [class.animate-spin]="status === 'building'"
          aria-hidden="true"
        />
        {{ t(labels[status]) }}
      </span>
    } @else {
      <span class="text-muted-foreground text-xs">{{ t('deploy.status.never') }}</span>
    }
  `,
})
export class DeployStatusBadge {
  protected readonly t = inject(I18n).t;
  protected readonly labels = DEPLOY_STATUS_LABELS;
  readonly status = input<DeploymentStatus | null | undefined>(null);
  protected readonly look = computed(() => statusLook(this.status() ?? 'triggered'));
}
