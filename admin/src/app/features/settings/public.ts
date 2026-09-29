import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';

import { Api, ApiFailure } from '../../core/api';
import { I18n } from '../../core/i18n/i18n';
import { Grant } from '../../core/types';
import { LoadError } from '../../shared/components/load-error';
import { PageHeader } from '../../shared/components/page-header';
import { GrantsMatrix } from './grants';

@Component({
  selector: 'vd-public',
  imports: [GrantsMatrix, NgIcon, HlmButtonImports, HlmSpinnerImports, LoadError, PageHeader],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-6">
      <vd-page-header
        [title]="t('settings.public.title')"
        [description]="t('settings.public.description')"
      >
        <span eyebrow class="text-primary flex items-center gap-1.5 text-xs font-medium">
          <ng-icon name="lucideGlobe" size="14" /> {{ t('shell.settings') }}
        </span>
        <div actions>
          <button hlmBtn [disabled]="busy() || !loaded()" (click)="save()">
            @if (busy()) {
              <hlm-spinner />
            } @else {
              <ng-icon name="lucideSave" />
            }
            {{ t('common.save') }}
          </button>
        </div>
      </vd-page-header>
      @if (loadError(); as message) {
        <vd-load-error [message]="message" (retry)="load()" />
      } @else if (loaded()) {
        <vd-grants-matrix [(grants)]="grants" />
      } @else {
        <div class="bg-card flex justify-center rounded-xl border py-16">
          <hlm-spinner />
        </div>
      }
    </div>
  `,
})
export class PublicPage implements OnInit {
  private readonly api = inject(Api);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  protected readonly grants = signal<Grant[]>([]);
  protected readonly loaded = signal(false);
  protected readonly busy = signal(false);

  protected readonly loadError = signal<string | null>(null);

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loadError.set(null);
    try {
      this.grants.set(await this.api.get<Grant[]>('/public-permissions'));
      this.loaded.set(true);
    } catch (error) {
      this.loadError.set(ApiFailure.from(error).message);
    }
  }

  protected async save(): Promise<void> {
    this.busy.set(true);
    try {
      this.grants.set(
        await this.api.put<Grant[]>('/public-permissions', { permissions: this.grants() }),
      );
      toast.success(this.t('settings.public.saved'));
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    } finally {
      this.busy.set(false);
    }
  }
}
