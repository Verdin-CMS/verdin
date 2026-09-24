import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { HlmTableImports } from '@spartan-ng/helm/table';
import { HlmToggleGroupImports } from '@spartan-ng/helm/toggle-group';

import { Api, ApiFailure } from '../../core/api';
import { I18n } from '../../core/i18n/i18n';
import { MessageKey } from '../../core/i18n/messages/en';
import { ApiToken, Grant, TokenKind } from '../../core/types';
import { PageHeader } from '../../shared/components/page-header';
import { GrantsMatrix } from './grants';

const KINDS: Record<
  TokenKind,
  { label: MessageKey; icon: string; variant: 'secondary' | 'default' | 'outline' }
> = {
  'read-only': { label: 'settings.tokens.kind.read-only', icon: 'lucideEye', variant: 'secondary' },
  'full-access': {
    label: 'settings.tokens.kind.full-access',
    icon: 'lucideShieldCheck',
    variant: 'default',
  },
  custom: { label: 'settings.tokens.kind.custom', icon: 'lucideSettings', variant: 'outline' },
};

@Component({
  selector: 'vd-tokens',
  imports: [
    NgIcon,
    GrantsMatrix,
    HlmTableImports,
    HlmButtonImports,
    HlmBadgeImports,
    HlmDialogImports,
    HlmFieldImports,
    HlmInputImports,
    HlmNativeSelectImports,
    HlmToggleGroupImports,
    HlmAlertImports,
    HlmEmptyImports,
    PageHeader,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-6">
      <vd-page-header
        [title]="t('settings.tokens.title')"
        [description]="t('settings.tokens.description', { header: 'Authorization: Bearer …' })"
      >
        <span eyebrow class="text-primary flex items-center gap-1.5 text-xs font-medium">
          <ng-icon name="lucideKeyRound" size="14" /> {{ t('shell.settings') }}
        </span>
        <div actions>
          <button hlmBtn (click)="openCreate()">
            <ng-icon name="lucidePlus" /> {{ t('settings.tokens.create') }}
          </button>
        </div>
      </vd-page-header>

      @if (tokens().length === 0) {
        <div hlmEmpty class="rounded-xl border border-dashed py-16">
          <div hlmEmptyHeader>
            <div hlmEmptyMedia variant="icon"><ng-icon name="lucideKeyRound" /></div>
            <h2 hlmEmptyTitle>{{ t('settings.tokens.emptyTitle') }}</h2>
            <p hlmEmptyDescription>{{ t('settings.tokens.emptyHint') }}</p>
          </div>
          <div hlmEmptyContent>
            <button hlmBtn variant="outline" (click)="openCreate()">
              <ng-icon name="lucidePlus" /> {{ t('settings.tokens.create') }}
            </button>
          </div>
        </div>
      } @else {
        <div class="bg-card overflow-hidden rounded-xl border">
          <div hlmTableContainer>
            <table hlmTable>
              <thead hlmTHead class="bg-muted/50">
                <tr hlmTr class="hover:bg-transparent">
                  <th hlmTh class="ps-4">{{ t('common.name') }}</th>
                  <th hlmTh>{{ t('settings.tokens.type') }}</th>
                  <th hlmTh>{{ t('settings.tokens.token') }}</th>
                  <th hlmTh>{{ t('settings.tokens.lastUsed') }}</th>
                  <th hlmTh>{{ t('settings.tokens.expires') }}</th>
                  <th hlmTh class="pe-4">
                    <span class="sr-only">{{ t('common.actions') }}</span>
                  </th>
                </tr>
              </thead>
              <tbody hlmTBody>
                @for (token of tokens(); track token.id) {
                  <tr hlmTr>
                    <td hlmTd class="ps-4">
                      <div class="flex items-center gap-3">
                        <span
                          class="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-lg"
                        >
                          <ng-icon name="lucideKeyRound" size="16" />
                        </span>
                        <div class="flex min-w-0 flex-col">
                          <span class="font-medium">{{ token.name }}</span>
                          @if (token.description) {
                            <span class="text-muted-foreground max-w-xs truncate text-xs">{{
                              token.description
                            }}</span>
                          }
                        </div>
                      </div>
                    </td>
                    <td hlmTd>
                      <span hlmBadge [variant]="kindVariant(token.kind)">
                        <ng-icon [name]="kindIcon(token.kind)" />
                        {{ t(kindLabel(token.kind)) }}
                      </span>
                    </td>
                    <td hlmTd>
                      <code class="bg-muted rounded px-1.5 py-0.5 font-mono text-xs"
                        >{{ token.tokenPrefix }}…</code
                      >
                    </td>
                    <td
                      hlmTd
                      class="text-muted-foreground"
                      [attr.title]="
                        token.lastUsedAt ? i18n.formatDate(token.lastUsedAt, 'long') : null
                      "
                    >
                      {{
                        token.lastUsedAt
                          ? i18n.formatRelative(token.lastUsedAt)
                          : t('settings.tokens.neverUsed')
                      }}
                    </td>
                    <td hlmTd>
                      @if (!token.expiresAt) {
                        <span class="text-muted-foreground">{{ t('settings.tokens.never') }}</span>
                      } @else if (isExpired(token)) {
                        <span hlmBadge variant="destructive">{{
                          t('settings.tokens.expired')
                        }}</span>
                      } @else {
                        <span class="text-muted-foreground">{{
                          i18n.formatDate(token.expiresAt, 'date')
                        }}</span>
                      }
                    </td>
                    <td hlmTd class="pe-4 text-end">
                      <button
                        hlmBtn
                        size="icon-sm"
                        variant="ghost"
                        class="text-muted-foreground hover:text-destructive"
                        [attr.aria-label]="t('settings.tokens.deleteLabel', { name: token.name })"
                        (click)="remove(token)"
                      >
                        <ng-icon name="lucideTrash2" />
                      </button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }
    </div>

    <hlm-dialog [state]="dialogOpen() ? 'open' : 'closed'" (closed)="closeDialog()">
      <hlm-dialog-content *hlmDialogPortal="let ctx" class="sm:max-w-3xl">
        <hlm-dialog-header>
          <h2 hlmDialogTitle>
            {{ created() ? t('settings.tokens.copyTitle') : t('settings.tokens.createTitle') }}
          </h2>
          <p hlmDialogDescription>
            {{
              created()
                ? t('settings.tokens.copyDescription')
                : t('settings.tokens.createDescription')
            }}
          </p>
        </hlm-dialog-header>
        @if (created(); as secret) {
          <div class="flex items-center gap-2">
            <input
              hlmInput
              readonly
              class="font-mono"
              [value]="secret"
              [attr.aria-label]="t('settings.tokens.token')"
            />
            <button hlmBtn variant="outline" (click)="copy(secret)">
              <ng-icon name="lucideCopy" /> {{ t('common.copy') }}
            </button>
          </div>
          <hlm-dialog-footer>
            <button hlmBtn (click)="closeDialog()">{{ t('settings.tokens.done') }}</button>
          </hlm-dialog-footer>
        } @else {
          <div class="flex flex-col gap-4">
            <div class="grid gap-4 sm:grid-cols-2">
              <div hlmField>
                <label hlmFieldLabel for="token-name">{{ t('common.name') }}</label>
                <input
                  hlmInput
                  id="token-name"
                  [value]="name()"
                  (input)="name.set($any($event.target).value)"
                />
              </div>
              <div hlmField>
                <label hlmFieldLabel for="token-description">{{ t('common.description') }}</label>
                <input
                  hlmInput
                  id="token-description"
                  [value]="description()"
                  (input)="description.set($any($event.target).value)"
                />
              </div>
            </div>
            <div class="flex flex-wrap gap-6">
              <div hlmField>
                <span hlmFieldLabel>{{ t('settings.tokens.type') }}</span>
                <hlm-toggle-group
                  type="single"
                  [value]="kind()"
                  (valueChange)="kind.set($any($event) || kind())"
                  variant="outline"
                >
                  @for (option of kinds; track option) {
                    <button hlmToggleGroupItem [value]="option">
                      <ng-icon [name]="kindIcon(option)" />
                      {{ t(kindLabel(option)) }}
                    </button>
                  }
                </hlm-toggle-group>
              </div>
              <div hlmField>
                <label hlmFieldLabel for="token-expiry">{{ t('settings.tokens.expires') }}</label>
                <hlm-native-select
                  selectId="token-expiry"
                  [value]="expiry()"
                  (valueChange)="expiry.set($event ?? '')"
                >
                  <option hlmNativeSelectOption value="">{{ t('settings.tokens.never') }}</option>
                  @for (days of expiryOptions; track days) {
                    <option hlmNativeSelectOption [value]="'' + days">
                      {{ t('settings.tokens.expiresIn', { count: days }) }}
                    </option>
                  }
                </hlm-native-select>
              </div>
            </div>
            @if (kind() === 'custom') {
              <div class="flex flex-col gap-2">
                <span class="text-sm font-medium">{{ t('settings.tokens.permissions') }}</span>
                <vd-grants-matrix [(grants)]="grants" />
              </div>
            }
            @if (error()) {
              <div hlmAlert variant="destructive">
                <ng-icon name="lucideCircleAlert" />
                <p hlmAlertDescription>{{ error() }}</p>
              </div>
            }
          </div>
          <hlm-dialog-footer>
            <button hlmBtn variant="outline" (click)="closeDialog()">
              {{ t('common.cancel') }}
            </button>
            <button hlmBtn [disabled]="!name().trim()" (click)="create()">
              {{ t('common.create') }}
            </button>
          </hlm-dialog-footer>
        }
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class TokensPage implements OnInit {
  private readonly api = inject(Api);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  protected readonly kinds = Object.keys(KINDS) as TokenKind[];
  protected readonly expiryOptions = [7, 30, 90];
  protected readonly tokens = signal<ApiToken[]>([]);
  protected readonly dialogOpen = signal(false);
  protected readonly created = signal<string | null>(null);
  protected readonly name = signal('');
  protected readonly description = signal('');
  protected readonly kind = signal<TokenKind>('read-only');
  protected readonly expiry = signal('');
  protected readonly grants = signal<Grant[]>([]);
  protected readonly error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  private async reload(): Promise<void> {
    this.tokens.set(await this.api.get<ApiToken[]>('/api-tokens'));
  }

  protected kindLabel(kind: TokenKind): MessageKey {
    return KINDS[kind]?.label ?? 'settings.tokens.kind.custom';
  }

  protected kindIcon(kind: TokenKind): string {
    return KINDS[kind]?.icon ?? 'lucideKeyRound';
  }

  protected kindVariant(kind: TokenKind): 'secondary' | 'default' | 'outline' {
    return KINDS[kind]?.variant ?? 'outline';
  }

  protected isExpired(token: ApiToken): boolean {
    return !!token.expiresAt && new Date(token.expiresAt).getTime() < Date.now();
  }

  protected openCreate(): void {
    this.name.set('');
    this.description.set('');
    this.kind.set('read-only');
    this.expiry.set('');
    this.grants.set([]);
    this.error.set(null);
    this.created.set(null);
    this.dialogOpen.set(true);
  }

  protected closeDialog(): void {
    this.dialogOpen.set(false);
    this.created.set(null);
  }

  protected async create(): Promise<void> {
    this.error.set(null);
    try {
      const token = await this.api.post<ApiToken>('/api-tokens', {
        name: this.name().trim(),
        description: this.description().trim() || null,
        kind: this.kind(),
        expiresInDays: this.expiry() ? Number(this.expiry()) : null,
        permissions: this.kind() === 'custom' ? this.grants() : [],
      });
      this.created.set(token.accessKey ?? null);
      await this.reload();
    } catch (error) {
      this.error.set(ApiFailure.from(error).message);
    }
  }

  protected async copy(secret: string): Promise<void> {
    await navigator.clipboard.writeText(secret);
    toast.success(this.t('common.copied'));
  }

  protected async remove(token: ApiToken): Promise<void> {
    if (!confirm(this.t('settings.tokens.confirmDelete', { name: token.name }))) return;
    try {
      await this.api.delete(`/api-tokens/${token.id}`);
      await this.reload();
      toast.success(this.t('settings.tokens.deleted'));
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    }
  }
}
