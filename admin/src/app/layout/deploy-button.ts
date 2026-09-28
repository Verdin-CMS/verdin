import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmDropdownMenuImports } from '@spartan-ng/helm/dropdown-menu';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';

import { ApiFailure } from '../core/api';
import { Auth } from '../core/auth';
import { DeployTarget, Deployment, DeploymentPoller, Deploys, inProgress } from '../core/deploy';
import { I18n } from '../core/i18n/i18n';
import { DeployStatusBadge } from '../shared/components/deploy-status';

/**
 * The header's "Deploy" button (`deploy.trigger`), shown when a target exists: a menu of
 * targets with their last status, a confirmation, then the status as the provider reports it.
 */
@Component({
  selector: 'vd-deploy-button',
  imports: [
    NgIcon,
    DeployStatusBadge,
    HlmButtonImports,
    HlmDialogImports,
    HlmDropdownMenuImports,
    HlmSpinnerImports,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (targets().length) {
      <button
        hlmBtn
        size="sm"
        variant="outline"
        data-deploy-button
        [hlmDropdownMenuTrigger]="menu"
        align="end"
        [attr.aria-label]="t('deploy.buttonLabel')"
        (click)="refresh()"
      >
        @if (busy()) {
          <hlm-spinner class="size-4" />
        } @else {
          <ng-icon name="lucideRocket" />
        }
        <span class="hidden sm:inline">{{ t('deploy.button') }}</span>
      </button>
      <ng-template #menu>
        <hlm-dropdown-menu class="w-72">
          <hlm-dropdown-menu-label>{{ t('deploy.menuTitle') }}</hlm-dropdown-menu-label>
          <hlm-dropdown-menu-separator />
          @for (target of targets(); track target.id) {
            <button hlmDropdownMenuItem class="items-start" (click)="confirm.set(target)">
              <ng-icon name="lucideRocket" class="mt-0.5" />
              <span class="flex min-w-0 flex-1 flex-col gap-1">
                <span class="truncate font-medium">{{ target.name }}</span>
                <span dir="ltr" class="text-muted-foreground truncate font-mono text-xs">{{
                  target.host
                }}</span>
              </span>
              <vd-deploy-status [status]="target.lastDeployment?.status" />
            </button>
          }
        </hlm-dropdown-menu>
      </ng-template>
    }
    <p class="sr-only" aria-live="polite">{{ announcement() }}</p>

    <hlm-dialog [state]="confirm() ? 'open' : 'closed'" (closed)="confirm.set(null)">
      <hlm-dialog-content
        *hlmDialogPortal="let ctx"
        class="sm:max-w-md"
        [closeLabel]="t('common.close')"
      >
        @if (confirm(); as target) {
          <hlm-dialog-header>
            <h2 hlmDialogTitle>{{ t('deploy.confirmTitle', { name: target.name }) }}</h2>
            <p hlmDialogDescription>{{ t('deploy.confirmHint', { host: target.host }) }}</p>
          </hlm-dialog-header>
          @if (target.lastDeployment; as last) {
            <p class="text-muted-foreground flex items-center gap-2 text-sm">
              {{ t('deploy.lastDeploy') }}
              <vd-deploy-status [status]="last.status" />
              <span>{{ i18n.formatRelative(last.createdAt) }}</span>
            </p>
          }
          <hlm-dialog-footer>
            <button hlmBtn variant="outline" (click)="confirm.set(null)">
              {{ t('common.cancel') }}
            </button>
            <button hlmBtn data-deploy-confirm [disabled]="busy()" (click)="deploy(target)">
              @if (busy()) {
                <hlm-spinner class="size-4" />
              } @else {
                <ng-icon name="lucideRocket" />
              }
              {{ t('deploy.confirm') }}
            </button>
          </hlm-dialog-footer>
        }
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class DeployButton implements OnInit {
  private readonly service = inject(Deploys);
  private readonly auth = inject(Auth);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;

  protected readonly targets = signal<DeployTarget[]>([]);
  protected readonly confirm = signal<DeployTarget | null>(null);
  protected readonly busy = signal(false);
  protected readonly announcement = signal('');
  private readonly allowed = computed(
    () => this.auth.can('deploy.trigger') || this.auth.can('deploy.manage'),
  );

  private readonly poller = new DeploymentPoller(
    (id) => this.service.latest(id),
    (id, deployment) => this.onPolled(id, deployment),
  );

  constructor() {
    inject(DestroyRef).onDestroy(() => this.poller.stop());
  }

  ngOnInit(): void {
    void this.refresh();
  }

  /** Reloads the targets (when the menu opens); failures keep the button as it was. */
  protected async refresh(): Promise<void> {
    if (!this.allowed()) return;
    try {
      const targets = await this.service.targets();
      this.targets.set(targets);
      for (const target of targets) this.poller.watch(target.id, target.lastDeployment);
    } catch {
      // No deploys on this server (404) or no permission: the button stays hidden.
    }
  }

  protected async deploy(target: DeployTarget): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const deployment = await this.service.trigger(target.id);
      this.setLast(target.id, deployment);
      this.confirm.set(null);
      if (deployment.status === 'failed') {
        toast.error(this.t('deploy.triggerFailed', { name: target.name }), {
          description: deployment.message ?? undefined,
        });
      } else {
        toast.success(this.t('deploy.triggered', { name: target.name }));
        this.poller.watch(target.id, deployment);
      }
    } catch (error) {
      const failure = ApiFailure.from(error);
      toast.error(failure.status === 429 ? this.t('deploy.tooSoon') : failure.message);
    } finally {
      this.busy.set(false);
    }
  }

  private setLast(id: number, deployment: Deployment | null): void {
    this.targets.update((list) =>
      list.map((target) => (target.id === id ? { ...target, lastDeployment: deployment } : target)),
    );
  }

  /** Tells the user when a deploy they are following settles. */
  private onPolled(id: number, deployment: Deployment | null): void {
    const before = this.targets().find((target) => target.id === id);
    this.setLast(id, deployment);
    if (!before || !deployment || inProgress(deployment.status)) return;
    if (before.lastDeployment?.id !== deployment.id && !inProgress(before.lastDeployment?.status)) {
      return;
    }
    const name = before.name;
    if (deployment.status === 'ready') {
      const message = this.t('deploy.ready', { name });
      this.announcement.set(message);
      const url = deployment.url;
      toast.success(message, {
        description: url ?? undefined,
        action: url
          ? {
              label: this.t('deploy.openSite'),
              onClick: () => window.open(url, '_blank', 'noopener'),
            }
          : undefined,
      });
    } else {
      const message = this.t('deploy.errored', { name });
      this.announcement.set(message);
      toast.error(message, { description: deployment.message ?? undefined });
    }
  }
}
