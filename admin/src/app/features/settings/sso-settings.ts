import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  output,
  resource,
  signal,
  untracked,
} from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCheckboxImports } from '@spartan-ng/helm/checkbox';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { HlmSwitchImports } from '@spartan-ng/helm/switch';

import { Api, ApiFailure, RUNTIME_CONFIG } from '../../core/api';
import {
  SsoProblem,
  SsoProviderForm,
  emptySsoForm,
  splitList,
  ssoFormsFrom,
  ssoProblems,
  ssoRedirectUri,
  ssoSecretVariable,
  ssoSettingsFrom,
} from '../../core/feature-settings';
import { Feature, Features } from '../../core/features';
import { I18n } from '../../core/i18n/i18n';
import { MessageKey } from '../../core/i18n/keys';
import { Role } from '../../core/types';

const PROBLEMS: Record<SsoProblem, MessageKey> = {
  id: 'features.sso.problem.id',
  duplicate: 'features.sso.problem.duplicate',
  name: 'features.sso.problem.name',
  clientId: 'features.sso.problem.clientId',
  issuer: 'features.sso.problem.issuer',
  openid: 'features.sso.problem.openid',
  roles: 'features.sso.problem.roles',
};

/** Settings → Features → Single sign-on: the OpenID Connect providers. */
@Component({
  selector: 'vd-sso-settings',
  imports: [
    NgIcon,
    HlmAlertImports,
    HlmButtonImports,
    HlmCheckboxImports,
    HlmDialogImports,
    HlmFieldImports,
    HlmInputImports,
    HlmNativeSelectImports,
    HlmSpinnerImports,
    HlmSwitchImports,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-dialog [state]="open() ? 'open' : 'closed'" (closed)="closed.emit()">
      <hlm-dialog-content
        *hlmDialogPortal="let ctx"
        class="max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-3xl"
        [closeLabel]="t('common.close')"
      >
        <hlm-dialog-header>
          <h2 hlmDialogTitle>{{ t('features.sso.settingsTitle') }}</h2>
          <p hlmDialogDescription>{{ t('features.sso.settingsDescription') }}</p>
        </hlm-dialog-header>
        <form
          id="sso-settings-form"
          class="-mx-6 flex min-h-0 flex-col gap-6 overflow-y-auto px-6"
          novalidate
          (submit)="$event.preventDefault(); save()"
        >
          @for (provider of providers(); track $index; let index = $index) {
            @let p = 'sso-' + index;
            @let problems = problemsOf(index);
            <fieldset class="flex flex-col gap-4 rounded-xl border p-4">
              <legend class="flex items-center gap-2 px-1 text-sm font-medium">
                <ng-icon name="lucideKeyRound" size="14" aria-hidden="true" />
                {{ provider.name || t('features.sso.untitled', { number: index + 1 }) }}
              </legend>
              <div class="grid gap-4 sm:grid-cols-2">
                <div hlmField [attr.data-invalid]="problems.id ? true : null">
                  <label hlmFieldLabel [for]="p + '-id'">{{ t('features.sso.id') }}</label>
                  <input
                    dir="ltr"
                    hlmInput
                    autocomplete="off"
                    spellcheck="false"
                    class="font-mono"
                    maxlength="32"
                    placeholder="corp"
                    [id]="p + '-id'"
                    [attr.aria-invalid]="problems.id ? true : null"
                    [attr.aria-describedby]="
                      p + '-id-hint' + (problems.id ? ' ' + p + '-id-error' : '')
                    "
                    [value]="provider.id"
                    (input)="patch(index, { id: $any($event.target).value })"
                    (blur)="touch()"
                  />
                  <p class="text-muted-foreground text-xs" [id]="p + '-id-hint'">
                    {{ t('features.sso.idHint') }}
                  </p>
                  @if (problems.id) {
                    <p class="text-destructive text-sm" [id]="p + '-id-error'">
                      {{ t(problemKeys[problems.id]) }}
                    </p>
                  }
                </div>
                <div hlmField [attr.data-invalid]="problems.name ? true : null">
                  <label hlmFieldLabel [for]="p + '-name'">{{
                    t('features.sso.buttonName')
                  }}</label>
                  <input
                    hlmInput
                    autocomplete="off"
                    [placeholder]="t('features.sso.namePlaceholder')"
                    [id]="p + '-name'"
                    [attr.aria-invalid]="problems.name ? true : null"
                    [attr.aria-describedby]="problems.name ? p + '-name-error' : null"
                    [value]="provider.name"
                    (input)="patch(index, { name: $any($event.target).value })"
                    (blur)="touch()"
                  />
                  @if (problems.name) {
                    <p class="text-destructive text-sm" [id]="p + '-name-error'">
                      {{ t(problemKeys[problems.name]) }}
                    </p>
                  }
                </div>
                <div
                  hlmField
                  class="sm:col-span-2"
                  [attr.data-invalid]="problems.issuer ? true : null"
                >
                  <label hlmFieldLabel [for]="p + '-issuer'">{{ t('features.sso.issuer') }}</label>
                  <input
                    dir="ltr"
                    hlmInput
                    type="url"
                    autocomplete="off"
                    spellcheck="false"
                    class="font-mono text-xs"
                    placeholder="https://login.example.com/realms/corp"
                    [id]="p + '-issuer'"
                    [attr.aria-invalid]="problems.issuer ? true : null"
                    [attr.aria-describedby]="
                      p + '-issuer-hint' + (problems.issuer ? ' ' + p + '-issuer-error' : '')
                    "
                    [value]="provider.issuer"
                    (input)="patch(index, { issuer: $any($event.target).value })"
                    (blur)="touch()"
                  />
                  <p class="text-muted-foreground text-xs" [id]="p + '-issuer-hint'">
                    {{ t('features.sso.issuerHint') }}
                  </p>
                  @if (problems.issuer) {
                    <p class="text-destructive text-sm" [id]="p + '-issuer-error'">
                      {{ t(problemKeys[problems.issuer]) }}
                    </p>
                  }
                </div>
                <div hlmField [attr.data-invalid]="problems.clientId ? true : null">
                  <label hlmFieldLabel [for]="p + '-client'">{{
                    t('features.sso.clientId')
                  }}</label>
                  <input
                    dir="ltr"
                    hlmInput
                    autocomplete="off"
                    spellcheck="false"
                    class="font-mono text-xs"
                    [id]="p + '-client'"
                    [attr.aria-invalid]="problems.clientId ? true : null"
                    [attr.aria-describedby]="problems.clientId ? p + '-client-error' : null"
                    [value]="provider.clientId"
                    (input)="patch(index, { clientId: $any($event.target).value })"
                    (blur)="touch()"
                  />
                  @if (problems.clientId) {
                    <p class="text-destructive text-sm" [id]="p + '-client-error'">
                      {{ t(problemKeys[problems.clientId]) }}
                    </p>
                  }
                </div>
                <div hlmField [attr.data-invalid]="problems.scopes ? true : null">
                  <label hlmFieldLabel [for]="p + '-scopes'">{{ t('features.sso.scopes') }}</label>
                  <input
                    dir="ltr"
                    hlmInput
                    autocomplete="off"
                    spellcheck="false"
                    class="font-mono text-xs"
                    placeholder="openid email profile"
                    [id]="p + '-scopes'"
                    [attr.aria-invalid]="problems.scopes ? true : null"
                    [attr.aria-describedby]="
                      p + '-scopes-hint' + (problems.scopes ? ' ' + p + '-scopes-error' : '')
                    "
                    [value]="provider.scopes"
                    (input)="patch(index, { scopes: $any($event.target).value })"
                    (blur)="touch()"
                  />
                  <p class="text-muted-foreground text-xs" [id]="p + '-scopes-hint'">
                    {{ t('features.sso.listHint') }}
                  </p>
                  @if (problems.scopes) {
                    <p class="text-destructive text-sm" [id]="p + '-scopes-error'">
                      {{ t(problemKeys[problems.scopes]) }}
                    </p>
                  }
                </div>
                <div hlmField class="sm:col-span-2">
                  <label hlmFieldLabel [for]="p + '-domains'">{{
                    t('features.sso.allowedDomains')
                  }}</label>
                  <input
                    hlmInput
                    autocomplete="off"
                    spellcheck="false"
                    placeholder="example.com"
                    [id]="p + '-domains'"
                    [attr.aria-describedby]="p + '-domains-hint'"
                    [value]="provider.allowedDomains"
                    (input)="patch(index, { allowedDomains: $any($event.target).value })"
                  />
                  <p class="text-muted-foreground text-xs" [id]="p + '-domains-hint'">
                    {{ t('features.sso.allowedDomainsHint') }}
                  </p>
                </div>
              </div>

              <div class="flex items-start gap-3">
                <hlm-switch
                  class="mt-0.5"
                  [inputId]="p + '-auto'"
                  [checked]="provider.autoCreate"
                  [aria-label]="t('features.sso.autoCreate')"
                  [aria-describedby]="p + '-auto-hint'"
                  (checkedChange)="patch(index, { autoCreate: $event })"
                />
                <div class="flex flex-col gap-0.5">
                  <label class="text-sm font-medium" [for]="p + '-auto'">{{
                    t('features.sso.autoCreate')
                  }}</label>
                  <p class="text-muted-foreground text-xs" [id]="p + '-auto-hint'">
                    {{ t('features.sso.autoCreateHint') }}
                  </p>
                </div>
              </div>

              <div class="flex items-start gap-3">
                <hlm-switch
                  class="mt-0.5"
                  [inputId]="p + '-verified'"
                  [checked]="provider.trustUnverifiedEmail"
                  [aria-label]="t('features.sso.trustUnverifiedEmail')"
                  [aria-describedby]="p + '-verified-hint'"
                  (checkedChange)="patch(index, { trustUnverifiedEmail: $event })"
                />
                <div class="flex flex-col gap-0.5">
                  <label class="text-sm font-medium" [for]="p + '-verified'">{{
                    t('features.sso.trustUnverifiedEmail')
                  }}</label>
                  <p class="text-muted-foreground text-xs" [id]="p + '-verified-hint'">
                    {{ t('features.sso.trustUnverifiedEmailHint') }}
                  </p>
                </div>
              </div>

              <div class="flex items-start gap-3">
                <hlm-switch
                  class="mt-0.5"
                  [inputId]="p + '-mfa'"
                  [checked]="provider.providerMfa"
                  [aria-label]="t('features.sso.providerMfa')"
                  [aria-describedby]="p + '-mfa-hint'"
                  (checkedChange)="patch(index, { providerMfa: $event })"
                />
                <div class="flex flex-col gap-0.5">
                  <label class="text-sm font-medium" [for]="p + '-mfa'">{{
                    t('features.sso.providerMfa')
                  }}</label>
                  <p class="text-muted-foreground text-xs" [id]="p + '-mfa-hint'">
                    {{ t('features.sso.providerMfaHint') }}
                  </p>
                </div>
              </div>

              <fieldset class="flex flex-col gap-2" [attr.aria-describedby]="p + '-roles-hint'">
                <legend class="text-sm font-medium">{{ t('features.sso.defaultRoles') }}</legend>
                <p class="text-muted-foreground text-xs" [id]="p + '-roles-hint'">
                  {{ t('features.sso.defaultRolesHint') }}
                </p>
                @if (roles(); as list) {
                  <div class="flex flex-wrap gap-x-5 gap-y-2">
                    @for (role of list; track role.code) {
                      <label class="flex items-center gap-2 text-sm">
                        <hlm-checkbox
                          [checked]="provider.defaultRoles.includes(role.code)"
                          [aria-label]="t('features.sso.roleOption', { role: role.name })"
                          (checkedChange)="toggleRole(index, role.code, $event)"
                        />
                        {{ role.name }}
                        <span class="text-muted-foreground font-mono text-xs">{{ role.code }}</span>
                      </label>
                    }
                  </div>
                } @else {
                  <input
                    dir="ltr"
                    hlmInput
                    autocomplete="off"
                    spellcheck="false"
                    class="font-mono text-xs"
                    placeholder="author editor"
                    [attr.aria-label]="t('features.sso.defaultRoles')"
                    [value]="provider.defaultRoles.join(' ')"
                    (input)="patch(index, { defaultRoles: split($any($event.target).value) })"
                  />
                }
                @if (problems.defaultRoles) {
                  <p class="text-destructive text-sm" role="alert">
                    {{ t(problemKeys[problems.defaultRoles]) }}
                  </p>
                }
              </fieldset>

              <fieldset class="flex flex-col gap-3">
                <legend class="text-sm font-medium">{{ t('features.sso.roleMapping') }}</legend>
                <div hlmField>
                  <label hlmFieldLabel [for]="p + '-claim'">{{
                    t('features.sso.roleClaim')
                  }}</label>
                  <input
                    dir="ltr"
                    hlmInput
                    autocomplete="off"
                    spellcheck="false"
                    class="max-w-64 font-mono text-xs"
                    placeholder="groups"
                    [id]="p + '-claim'"
                    [attr.aria-describedby]="p + '-claim-hint'"
                    [value]="provider.roleClaim"
                    (input)="patch(index, { roleClaim: $any($event.target).value })"
                  />
                  <p class="text-muted-foreground text-xs" [id]="p + '-claim-hint'">
                    {{ t('features.sso.roleClaimHint') }}
                  </p>
                </div>
                @for (row of provider.roleMap; track $index; let rowIndex = $index) {
                  <div class="flex flex-wrap items-end gap-2">
                    <div hlmField class="min-w-40 flex-1">
                      <label hlmFieldLabel class="text-xs" [for]="p + '-map-' + rowIndex">{{
                        t('features.sso.claimValue')
                      }}</label>
                      <input
                        dir="ltr"
                        hlmInput
                        autocomplete="off"
                        spellcheck="false"
                        class="font-mono text-xs"
                        [id]="p + '-map-' + rowIndex"
                        [value]="row.claim"
                        (input)="patchRow(index, rowIndex, { claim: $any($event.target).value })"
                      />
                    </div>
                    <ng-icon
                      name="lucideArrowRight"
                      class="text-muted-foreground mb-2.5 rtl:-scale-x-100"
                      aria-hidden="true"
                    />
                    <div hlmField class="min-w-40 flex-1">
                      <label hlmFieldLabel class="text-xs" [for]="p + '-map-role-' + rowIndex">{{
                        t('features.sso.mappedRole')
                      }}</label>
                      @if (roles(); as list) {
                        <hlm-native-select
                          [selectId]="p + '-map-role-' + rowIndex"
                          [value]="row.role"
                          (valueChange)="patchRow(index, rowIndex, { role: $event ?? '' })"
                        >
                          <option hlmNativeSelectOption value="">
                            {{ t('features.sso.chooseRole') }}
                          </option>
                          @for (role of list; track role.code) {
                            <option hlmNativeSelectOption [value]="role.code">
                              {{ role.name }} ({{ role.code }})
                            </option>
                          }
                        </hlm-native-select>
                      } @else {
                        <input
                          dir="ltr"
                          hlmInput
                          autocomplete="off"
                          spellcheck="false"
                          class="font-mono text-xs"
                          [id]="p + '-map-role-' + rowIndex"
                          [value]="row.role"
                          (input)="patchRow(index, rowIndex, { role: $any($event.target).value })"
                        />
                      }
                    </div>
                    <button
                      hlmBtn
                      type="button"
                      variant="ghost"
                      size="icon"
                      [attr.aria-label]="t('features.sso.removeMapping', { number: rowIndex + 1 })"
                      (click)="removeRow(index, rowIndex)"
                    >
                      <ng-icon name="lucideX" />
                    </button>
                  </div>
                }
                <button
                  hlmBtn
                  type="button"
                  variant="outline"
                  size="sm"
                  class="self-start"
                  (click)="addRow(index)"
                >
                  <ng-icon name="lucidePlus" /> {{ t('features.sso.addMapping') }}
                </button>
              </fieldset>

              <div class="bg-muted/50 flex flex-col gap-2 rounded-lg p-3 text-xs">
                <div class="flex flex-col gap-1">
                  <span class="font-medium">{{ t('features.sso.redirectUri') }}</span>
                  <span class="flex items-center gap-1">
                    <code class="min-w-0 font-mono break-all">{{ redirectUri(provider.id) }}</code>
                    <button
                      hlmBtn
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      [attr.aria-label]="t('features.sso.copyRedirect')"
                      [attr.title]="t('features.sso.copyRedirect')"
                      (click)="copy(redirectUri(provider.id))"
                    >
                      <ng-icon name="lucideCopy" />
                    </button>
                  </span>
                </div>
                <div class="flex flex-col gap-1">
                  <span class="font-medium">{{ t('features.sso.secret') }}</span>
                  <span class="text-muted-foreground">
                    {{ t('features.sso.secretHint') }}
                    <code class="text-foreground font-mono">{{ secretVariable(provider.id) }}</code>
                  </span>
                </div>
              </div>

              <button
                hlmBtn
                type="button"
                variant="ghost"
                size="sm"
                class="text-destructive self-end"
                (click)="remove(index)"
              >
                <ng-icon name="lucideTrash2" />
                {{
                  t('features.sso.removeProvider', {
                    name: provider.name || t('features.sso.untitled', { number: index + 1 }),
                  })
                }}
              </button>
            </fieldset>
          } @empty {
            <p
              class="text-muted-foreground rounded-xl border border-dashed p-6 text-center text-sm"
            >
              {{ t('features.sso.noProviders') }}
            </p>
          }

          <button hlmBtn type="button" variant="outline" class="self-start" (click)="add()">
            <ng-icon name="lucidePlus" /> {{ t('features.sso.addProvider') }}
          </button>

          @if (error()) {
            <div hlmAlert variant="destructive" role="alert">
              <ng-icon hlmAlertIcon name="lucideCircleAlert" />
              <p hlmAlertTitle>{{ t('features.settingsRejected') }}</p>
              <p hlmAlertDescription>{{ error() }}</p>
            </div>
          }
        </form>
        <hlm-dialog-footer>
          <button hlmBtn type="button" variant="outline" (click)="closed.emit()">
            {{ t('common.cancel') }}
          </button>
          <button hlmBtn type="submit" form="sso-settings-form" [disabled]="saving()">
            @if (saving()) {
              <hlm-spinner class="size-4" />
            }
            {{ t('common.save') }}
          </button>
        </hlm-dialog-footer>
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class SsoSettingsDialog {
  private readonly features = inject(Features);
  private readonly api = inject(Api);
  private readonly config = inject(RUNTIME_CONFIG);
  protected readonly t = inject(I18n).t;

  readonly open = input(false);
  readonly feature = input.required<Feature>();
  readonly closed = output<void>();

  protected readonly problemKeys = PROBLEMS;
  protected readonly providers = signal<SsoProviderForm[]>([]);
  /** Listed again each time the dialog opens (or its feature changes while open). */
  private readonly roleList = resource({
    params: () => (this.open() ? this.feature() : undefined),
    loader: () => this.api.get<Role[]>('/roles').catch(() => null),
  });
  /**
   * `null` when the roles cannot be listed: codes are typed instead. The last list stays
   * while the next one loads.
   */
  protected readonly roles = linkedSignal<Role[] | null | undefined, Role[] | null>({
    source: () => (this.roleList.hasValue() ? this.roleList.value() : undefined),
    computation: (roles, previous) => (roles === undefined ? (previous?.value ?? null) : roles),
  });
  protected readonly touched = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly problems = computed(() => ssoProblems(this.providers()));
  protected problemsOf(index: number): Partial<Record<keyof SsoProviderForm, SsoProblem>> {
    return (this.touched() ? this.problems()[index] : undefined) ?? {};
  }
  protected readonly split = splitList;
  protected readonly secretVariable = (id: string) => ssoSecretVariable(id.trim() || 'id');

  constructor() {
    effect(() => {
      if (!this.open()) return;
      const feature = this.feature();
      untracked(() => {
        this.providers.set(ssoFormsFrom(feature.settings));
        this.touched.set(false);
        this.error.set(null);
      });
    });
  }

  protected redirectUri(id: string): string {
    return ssoRedirectUri(this.config.apiBase, id.trim() || '<id>', location.origin);
  }

  protected touch(): void {
    this.touched.set(true);
  }

  protected patch(index: number, changes: Partial<SsoProviderForm>): void {
    this.providers.update((list) =>
      list.map((provider, i) => (i === index ? { ...provider, ...changes } : provider)),
    );
  }

  protected toggleRole(index: number, code: string, checked: boolean): void {
    const provider = this.providers()[index];
    if (!provider) return;
    const roles = checked
      ? [...new Set([...provider.defaultRoles, code])]
      : provider.defaultRoles.filter((role) => role !== code);
    this.patch(index, { defaultRoles: roles });
  }

  protected patchRow(
    index: number,
    row: number,
    changes: Partial<{ claim: string; role: string }>,
  ) {
    const provider = this.providers()[index];
    if (!provider) return;
    this.patch(index, {
      roleMap: provider.roleMap.map((item, i) => (i === row ? { ...item, ...changes } : item)),
    });
  }

  protected addRow(index: number): void {
    const provider = this.providers()[index];
    if (provider) this.patch(index, { roleMap: [...provider.roleMap, { claim: '', role: '' }] });
  }

  protected removeRow(index: number, row: number): void {
    const provider = this.providers()[index];
    if (provider) this.patch(index, { roleMap: provider.roleMap.filter((_, i) => i !== row) });
  }

  protected add(): void {
    this.providers.update((list) => [...list, emptySsoForm()]);
    const index = this.providers().length - 1;
    setTimeout(() => document.getElementById(`sso-${index}-id`)?.focus());
  }

  protected remove(index: number): void {
    this.providers.update((list) => list.filter((_, i) => i !== index));
  }

  protected async copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(this.t('common.copied'));
    } catch {
      toast.error(this.t('settings.plugins.copyFailed'));
    }
  }

  protected async save(): Promise<void> {
    this.touched.set(true);
    const problems = this.problems();
    const first = problems.findIndex((item) => Object.keys(item).length > 0);
    if (first >= 0) {
      const field = Object.keys(problems[first])[0];
      const suffix: Record<string, string> = {
        id: 'id',
        name: 'name',
        issuer: 'issuer',
        clientId: 'client',
        scopes: 'scopes',
      };
      const target = suffix[field] ? `sso-${first}-${suffix[field]}` : `sso-${first}-auto`;
      document.getElementById(target)?.focus();
      return;
    }
    if (this.saving()) return;
    const feature = this.feature();
    this.saving.set(true);
    this.error.set(null);
    try {
      const settings = ssoSettingsFrom(this.providers());
      await this.features.update(feature.id, feature.enabled, { ...settings });
      toast.success(this.t('features.settingsSaved', { name: this.t('features.sso.name') }));
      this.closed.emit();
    } catch (error) {
      this.error.set(ApiFailure.from(error).message);
    } finally {
      this.saving.set(false);
    }
  }
}
