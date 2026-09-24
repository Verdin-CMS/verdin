import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';

import { Api, ApiFailure } from '../../core/api';
import { Grant } from '../../core/types';
import { GrantsMatrix } from './grants';

@Component({
  selector: 'vd-public',
  imports: [GrantsMatrix, NgIcon, HlmButtonImports, HlmSpinnerImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center gap-3">
        <div>
          <h1 class="text-2xl font-semibold">Public access</h1>
          <p class="text-muted-foreground text-sm">
            What anyone can do through the content API without a token. Everything is closed by
            default.
          </p>
        </div>
        <button hlmBtn class="ms-auto" [disabled]="busy()" (click)="save()">
          @if (busy()) {
            <hlm-spinner />
          } @else {
            <ng-icon name="lucideSave" />
          }
          Save
        </button>
      </div>
      @if (loaded()) {
        <vd-grants-matrix [(grants)]="grants" />
      } @else {
        <hlm-spinner />
      }
    </div>
  `,
})
export class PublicPage implements OnInit {
  private readonly api = inject(Api);
  protected readonly grants = signal<Grant[]>([]);
  protected readonly loaded = signal(false);
  protected readonly busy = signal(false);

  async ngOnInit(): Promise<void> {
    this.grants.set(await this.api.get<Grant[]>('/public-permissions'));
    this.loaded.set(true);
  }

  protected async save(): Promise<void> {
    this.busy.set(true);
    try {
      this.grants.set(
        await this.api.put<Grant[]>('/public-permissions', { permissions: this.grants() }),
      );
      toast.success('Public access saved');
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    } finally {
      this.busy.set(false);
    }
  }
}
