import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { HlmTableImports } from '@spartan-ng/helm/table';
import { HlmToggleGroupImports } from '@spartan-ng/helm/toggle-group';

import { Api, ApiFailure } from '../../core/api';
import { ApiToken, Grant, TokenKind } from '../../core/types';
import { GrantsMatrix } from './grants';

@Component({
  selector: 'vd-tokens',
  imports: [
    DatePipe,
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
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center gap-3">
        <div>
          <h1 class="text-2xl font-semibold">API tokens</h1>
          <p class="text-muted-foreground text-sm">
            Send them as <code>Authorization: Bearer …</code> to the content API.
          </p>
        </div>
        <button hlmBtn class="ms-auto" (click)="openCreate()">
          <ng-icon name="lucidePlus" /> Create token
        </button>
      </div>

      <div hlmTableContainer class="rounded-md border">
        <table hlmTable>
          <thead hlmTHead>
            <tr hlmTr>
              <th hlmTh>Name</th>
              <th hlmTh>Type</th>
              <th hlmTh>Token</th>
              <th hlmTh>Last used</th>
              <th hlmTh>Expires</th>
              <th hlmTh></th>
            </tr>
          </thead>
          <tbody hlmTBody>
            @for (token of tokens(); track token.id) {
              <tr hlmTr>
                <td hlmTd>{{ token.name }}</td>
                <td hlmTd>
                  <span hlmBadge variant="secondary">{{ token.kind }}</span>
                </td>
                <td hlmTd class="font-mono text-xs">{{ token.tokenPrefix }}…</td>
                <td hlmTd class="text-muted-foreground">
                  {{ token.lastUsedAt ? (token.lastUsedAt | date: 'short') : 'Never' }}
                </td>
                <td hlmTd class="text-muted-foreground">
                  {{ token.expiresAt ? (token.expiresAt | date: 'mediumDate') : 'Never' }}
                </td>
                <td hlmTd class="text-end">
                  <button
                    hlmBtn
                    size="icon-sm"
                    variant="ghost"
                    [attr.aria-label]="'Delete ' + token.name"
                    (click)="remove(token)"
                  >
                    <ng-icon name="lucideTrash2" />
                  </button>
                </td>
              </tr>
            } @empty {
              <tr hlmTr>
                <td hlmTd colspan="6" class="text-muted-foreground">No tokens yet.</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>

    <hlm-dialog [state]="dialogOpen() ? 'open' : 'closed'" (closed)="closeDialog()">
      <hlm-dialog-content *hlmDialogPortal="let ctx" class="sm:max-w-3xl">
        <hlm-dialog-header>
          <h2 hlmDialogTitle>{{ created() ? 'Copy your token' : 'Create an API token' }}</h2>
          <p hlmDialogDescription>
            {{
              created()
                ? 'This is the only time it is shown. Store it somewhere safe.'
                : 'Tokens give their holder access to the content API.'
            }}
          </p>
        </hlm-dialog-header>
        @if (created(); as secret) {
          <div class="flex items-center gap-2">
            <input hlmInput readonly class="font-mono" [value]="secret" aria-label="Token" />
            <button hlmBtn variant="outline" (click)="copy(secret)">
              <ng-icon name="lucideCopy" /> Copy
            </button>
          </div>
          <hlm-dialog-footer
            ><button hlmBtn (click)="closeDialog()">Done</button></hlm-dialog-footer
          >
        } @else {
          <div class="flex flex-col gap-4">
            <div hlmField>
              <label hlmFieldLabel for="token-name">Name</label>
              <input
                hlmInput
                id="token-name"
                [value]="name()"
                (input)="name.set($any($event.target).value)"
              />
            </div>
            <div hlmField>
              <label hlmFieldLabel for="token-description">Description</label>
              <input
                hlmInput
                id="token-description"
                [value]="description()"
                (input)="description.set($any($event.target).value)"
              />
            </div>
            <div class="flex flex-wrap gap-6">
              <div hlmField>
                <span hlmFieldLabel>Type</span>
                <hlm-toggle-group
                  type="single"
                  [value]="kind()"
                  (valueChange)="kind.set($any($event) || kind())"
                  variant="outline"
                >
                  <button hlmToggleGroupItem value="read-only">Read-only</button>
                  <button hlmToggleGroupItem value="full-access">Full access</button>
                  <button hlmToggleGroupItem value="custom">Custom</button>
                </hlm-toggle-group>
              </div>
              <div hlmField>
                <label hlmFieldLabel for="token-expiry">Expires</label>
                <hlm-native-select
                  selectId="token-expiry"
                  [value]="expiry()"
                  (valueChange)="expiry.set($event ?? '')"
                >
                  <option hlmNativeSelectOption value="">Never</option>
                  <option hlmNativeSelectOption value="7">In 7 days</option>
                  <option hlmNativeSelectOption value="30">In 30 days</option>
                  <option hlmNativeSelectOption value="90">In 90 days</option>
                </hlm-native-select>
              </div>
            </div>
            @if (kind() === 'custom') {
              <vd-grants-matrix [(grants)]="grants" />
            }
            @if (error()) {
              <div hlmAlert variant="destructive">
                <p hlmAlertDescription>{{ error() }}</p>
              </div>
            }
          </div>
          <hlm-dialog-footer>
            <button hlmBtn variant="outline" (click)="closeDialog()">Cancel</button>
            <button hlmBtn [disabled]="!name().trim()" (click)="create()">Create</button>
          </hlm-dialog-footer>
        }
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class TokensPage implements OnInit {
  private readonly api = inject(Api);
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
    toast.success('Copied');
  }

  protected async remove(token: ApiToken): Promise<void> {
    if (!confirm(`Delete the token "${token.name}"? Clients using it lose access.`)) return;
    try {
      await this.api.delete(`/api-tokens/${token.id}`);
      await this.reload();
      toast.success('Token deleted');
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    }
  }
}
