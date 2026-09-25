import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { HlmTextareaImports } from '@spartan-ng/helm/textarea';

import { ApiFailure } from '../../core/api';
import { EndUserRole, EndUsers } from '../../core/end-users';
import { I18n } from '../../core/i18n/i18n';
import { Grant } from '../../core/types';
import { PageHeader } from '../../shared/components/page-header';
import { GrantsMatrix } from './grants';

/** Settings → End users → Roles → one role (or `new`): name, description and grants. */
@Component({
  selector: 'vd-end-user-role-edit',
  imports: [
    NgIcon,
    RouterLink,
    GrantsMatrix,
    HlmAlertImports,
    HlmButtonImports,
    HlmCardImports,
    HlmFieldImports,
    HlmInputImports,
    HlmSkeletonImports,
    HlmSpinnerImports,
    HlmTextareaImports,
    PageHeader,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-6">
      <vd-page-header
        [title]="creating() ? t('endUsers.roles.newTitle') : role()?.name || '…'"
        [description]="
          creating() ? t('endUsers.roles.newDescription') : t('endUsers.roles.editDescription')
        "
      >
        <a
          eyebrow
          routerLink="/settings/end-users/roles"
          class="text-primary flex items-center gap-1.5 text-xs font-medium hover:underline"
        >
          <ng-icon name="lucideArrowLeft" size="14" /> {{ t('endUsers.tab.roles') }}
        </a>
        <div actions>
          <button hlmBtn [disabled]="saving() || !valid()" (click)="save()">
            @if (saving()) {
              <hlm-spinner class="size-4" />
            } @else {
              <ng-icon name="lucideSave" />
            }
            {{ creating() ? t('common.create') : t('common.save') }}
          </button>
        </div>
      </vd-page-header>

      @if (loadError()) {
        <div hlmAlert variant="destructive">
          <ng-icon hlmAlertIcon name="lucideCircleAlert" />
          <p hlmAlertDescription>{{ loadError() }}</p>
        </div>
      } @else if (!creating() && !role()) {
        <hlm-skeleton class="h-96 rounded-xl" />
      } @else {
        @if (error()) {
          <div hlmAlert variant="destructive">
            <ng-icon hlmAlertIcon name="lucideCircleAlert" />
            <p hlmAlertDescription>{{ error() }}</p>
          </div>
        }

        <section hlmCard>
          <div hlmCardHeader>
            <h2 hlmCardTitle>{{ t('endUsers.roles.details') }}</h2>
          </div>
          <div hlmCardContent class="grid gap-4 md:grid-cols-2">
            <div hlmField>
              <label hlmFieldLabel for="end-role-name">{{ t('common.name') }}</label>
              <input
                hlmInput
                id="end-role-name"
                [value]="name()"
                (input)="name.set($any($event.target).value)"
              />
              @if (role(); as current) {
                <p hlmFieldDescription class="font-mono">{{ current.type }}</p>
              }
            </div>
            <div hlmField>
              <label hlmFieldLabel for="end-role-description">{{ t('common.description') }}</label>
              <textarea
                hlmTextarea
                id="end-role-description"
                rows="2"
                [value]="description()"
                (input)="description.set($any($event.target).value)"
              ></textarea>
            </div>
          </div>
        </section>

        <section class="flex flex-col gap-3">
          <div class="flex flex-col gap-1">
            <h2 class="font-medium">{{ t('endUsers.roles.permissions') }}</h2>
            <p class="text-muted-foreground text-sm">{{ t('endUsers.roles.permissionsHint') }}</p>
          </div>
          <vd-grants-matrix [(grants)]="grants" />
        </section>
      }
    </div>
  `,
})
export class EndUserRoleEditPage {
  private readonly service = inject(EndUsers);
  private readonly router = inject(Router);
  protected readonly t = inject(I18n).t;

  /** Route parameter: a role id, or `new`. */
  readonly id = input.required<string>();

  protected readonly creating = computed(() => this.id() === 'new');
  protected readonly role = signal<EndUserRole | null>(null);
  protected readonly name = signal('');
  protected readonly description = signal('');
  protected readonly grants = signal<Grant[]>([]);
  protected readonly loadError = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly valid = computed(() => !!this.name().trim());

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => void this.load(id));
    });
  }

  private async load(id: string): Promise<void> {
    this.error.set(null);
    this.loadError.set(null);
    if (id === 'new') {
      this.reset(null);
      return;
    }
    // Just created: the page already holds it.
    if (this.role()?.id === Number(id)) return;
    try {
      const role = (await this.service.roles()).find((item) => item.id === Number(id));
      if (!role) {
        this.loadError.set(this.t('endUsers.roles.notFound'));
        return;
      }
      this.reset(role);
    } catch (error) {
      this.loadError.set(ApiFailure.from(error).message);
    }
  }

  private reset(role: EndUserRole | null): void {
    this.role.set(role);
    this.name.set(role?.name ?? '');
    this.description.set(role?.description ?? '');
    this.grants.set(role ? [...role.permissions] : []);
  }

  protected async save(): Promise<void> {
    if (!this.valid()) return;
    this.error.set(null);
    this.saving.set(true);
    const input = {
      name: this.name().trim(),
      description: this.description().trim(),
      permissions: this.grants(),
    };
    try {
      const current = this.role();
      if (this.creating() || !current) {
        const known = new Set(
          (await this.service.roles().catch(() => [] as EndUserRole[])).map((role) => role.id),
        );
        const roles = await this.service.createRole(input);
        const created =
          roles.find((role) => !known.has(role.id) && role.name === input.name) ??
          roles.find((role) => role.name === input.name);
        toast.success(this.t('endUsers.roles.created', { name: input.name }));
        if (created) {
          this.reset(created);
          await this.router.navigate(['/settings/end-users/roles', created.id], {
            replaceUrl: true,
          });
        } else {
          await this.router.navigate(['/settings/end-users/roles']);
        }
      } else {
        await this.service.updateRole(current.id, input);
        this.role.set({ ...current, ...input });
        toast.success(this.t('endUsers.roles.saved', { name: input.name }));
      }
    } catch (error) {
      this.error.set(ApiFailure.from(error).message);
    } finally {
      this.saving.set(false);
    }
  }
}
