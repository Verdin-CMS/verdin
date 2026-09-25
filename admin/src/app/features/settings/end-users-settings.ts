import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { HlmSwitchImports } from '@spartan-ng/helm/switch';
import { HlmTextareaImports } from '@spartan-ng/helm/textarea';

import { ApiFailure, RUNTIME_CONFIG } from '../../core/api';
import { Auth } from '../../core/auth';
import {
  AUTHENTICATED_ROLE,
  EndUserRole,
  EndUsers,
  PRESET_PROVIDERS,
  ProviderRow,
  TEMPLATE_PLACEHOLDERS,
  TemplateName,
  UsersSettingsForm,
  addProvider,
  callbackUrl,
  isPresetProvider,
  providerProblem,
  removeProvider,
  secretEnvVar,
  settingsForm,
  settingsFromForm,
  updateProvider,
  usersSettings,
} from '../../core/end-users';
import { Features } from '../../core/features';
import { I18n } from '../../core/i18n/i18n';
import { MessageKey } from '../../core/i18n/keys';
import { PageHeader } from '../../shared/components/page-header';
import { EndUsersNav } from './end-users-nav';

const FEATURE = 'users';

interface TemplateSection {
  name: TemplateName;
  label: MessageKey;
  hint: MessageKey;
}

const TEMPLATES: TemplateSection[] = [
  {
    name: 'confirmation',
    label: 'endUsers.settings.template.confirmation',
    hint: 'endUsers.settings.template.confirmationHint',
  },
  {
    name: 'resetPassword',
    label: 'endUsers.settings.template.resetPassword',
    hint: 'endUsers.settings.template.resetPasswordHint',
  },
];

type UrlField = 'authorizeUrl' | 'tokenUrl' | 'userInfoUrl';

const URL_FIELDS: { key: UrlField; label: MessageKey }[] = [
  { key: 'authorizeUrl', label: 'endUsers.settings.provider.authorizeUrl' },
  { key: 'tokenUrl', label: 'endUsers.settings.provider.tokenUrl' },
  { key: 'userInfoUrl', label: 'endUsers.settings.provider.userInfoUrl' },
];

/** Settings → End users → Settings: the `users` feature and its settings. */
@Component({
  selector: 'vd-end-users-settings',
  imports: [
    NgIcon,
    EndUsersNav,
    HlmAlertImports,
    HlmBadgeImports,
    HlmButtonImports,
    HlmCardImports,
    HlmFieldImports,
    HlmInputImports,
    HlmNativeSelectImports,
    HlmSkeletonImports,
    HlmSpinnerImports,
    HlmSwitchImports,
    HlmTextareaImports,
    PageHeader,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-6">
      <vd-page-header [title]="t('endUsers.title')" [description]="t('endUsers.description')">
        <span eyebrow class="text-primary flex items-center gap-1.5 text-xs font-medium">
          <ng-icon name="lucideContactRound" size="14" /> {{ t('shell.settings') }}
        </span>
        <div actions>
          <button hlmBtn [disabled]="!canSave()" (click)="save()">
            @if (saving()) {
              <hlm-spinner class="size-4" />
            } @else {
              <ng-icon name="lucideSave" />
            }
            {{ t('common.save') }}
          </button>
        </div>
      </vd-page-header>
      <vd-end-users-nav />

      @if (!canManage()) {
        <div hlmAlert>
          <ng-icon hlmAlertIcon name="lucideInfo" />
          <p hlmAlertDescription>{{ t('endUsers.settings.readOnly') }}</p>
        </div>
      }

      @if (loadError()) {
        <div hlmAlert variant="destructive">
          <ng-icon hlmAlertIcon name="lucideCircleAlert" />
          <p hlmAlertDescription>{{ loadError() }}</p>
        </div>
      } @else if (!form()) {
        <hlm-skeleton class="h-96 rounded-xl" />
      } @else {
        @if (form(); as form) {
          @if (error()) {
            <div hlmAlert variant="destructive">
              <ng-icon hlmAlertIcon name="lucideCircleAlert" />
              <p hlmAlertDescription>{{ error() }}</p>
            </div>
          }

          <div class="grid gap-6 lg:grid-cols-2">
            <section hlmCard>
              <div hlmCardHeader>
                <h2 hlmCardTitle>{{ t('endUsers.settings.general') }}</h2>
              </div>
              <div hlmCardContent class="flex flex-col gap-4">
                <label class="flex items-start gap-3">
                  <hlm-switch [checked]="enabled()" (checkedChange)="enabled.set($event)" />
                  <span class="flex flex-col">
                    <span class="text-sm font-medium">{{ t('endUsers.settings.enabled') }}</span>
                    <span class="text-muted-foreground text-xs">{{
                      t('endUsers.settings.enabledHint')
                    }}</span>
                  </span>
                </label>
                <label class="flex items-start gap-3">
                  <hlm-switch
                    [checked]="form.allowRegister"
                    (checkedChange)="patch({ allowRegister: $event })"
                  />
                  <span class="flex flex-col">
                    <span class="text-sm font-medium">{{
                      t('endUsers.settings.allowRegister')
                    }}</span>
                    <span class="text-muted-foreground text-xs">{{
                      t('endUsers.settings.allowRegisterHint')
                    }}</span>
                  </span>
                </label>
                <label class="flex items-start gap-3">
                  <hlm-switch
                    [checked]="form.emailConfirmation"
                    (checkedChange)="patch({ emailConfirmation: $event })"
                  />
                  <span class="flex flex-col">
                    <span class="text-sm font-medium">{{
                      t('endUsers.settings.emailConfirmation')
                    }}</span>
                    <span class="text-muted-foreground text-xs">{{
                      t('endUsers.settings.emailConfirmationHint')
                    }}</span>
                  </span>
                </label>
                <div class="grid gap-4 sm:grid-cols-2">
                  <div hlmField>
                    <label hlmFieldLabel for="users-default-role">{{
                      t('endUsers.settings.defaultRole')
                    }}</label>
                    <hlm-native-select
                      selectId="users-default-role"
                      [value]="form.defaultRole"
                      (valueChange)="patch({ defaultRole: $event || authenticated })"
                    >
                      @for (role of roleOptions(); track role.type) {
                        <option hlmNativeSelectOption [value]="role.type">{{ role.name }}</option>
                      }
                    </hlm-native-select>
                  </div>
                  <div hlmField>
                    <label hlmFieldLabel for="users-jwt-days">{{
                      t('endUsers.settings.jwtDays')
                    }}</label>
                    <input
                      hlmInput
                      id="users-jwt-days"
                      type="number"
                      min="1"
                      step="1"
                      [value]="form.jwtExpiresInDays"
                      (input)="patch({ jwtExpiresInDays: $any($event.target).valueAsNumber })"
                    />
                    <p hlmFieldDescription>{{ t('endUsers.settings.jwtDaysHint') }}</p>
                  </div>
                </div>
              </div>
            </section>

            <section hlmCard>
              <div hlmCardHeader>
                <h2 hlmCardTitle>{{ t('endUsers.settings.urls') }}</h2>
                <p hlmCardDescription>{{ t('endUsers.settings.urlsHint') }}</p>
              </div>
              <div hlmCardContent class="flex flex-col gap-4">
                <div hlmField>
                  <label hlmFieldLabel for="users-confirmation-url">{{
                    t('endUsers.settings.confirmationRedirect')
                  }}</label>
                  <input
                    hlmInput
                    id="users-confirmation-url"
                    type="url"
                    class="font-mono"
                    placeholder="https://app.example.com/welcome"
                    [value]="form.emailConfirmationRedirection"
                    (input)="patch({ emailConfirmationRedirection: $any($event.target).value })"
                  />
                  <p hlmFieldDescription>{{ t('endUsers.settings.confirmationRedirectHint') }}</p>
                </div>
                <div hlmField>
                  <label hlmFieldLabel for="users-reset-url">{{
                    t('endUsers.settings.resetPasswordUrl')
                  }}</label>
                  <input
                    hlmInput
                    id="users-reset-url"
                    type="url"
                    class="font-mono"
                    placeholder="https://app.example.com/reset-password"
                    [value]="form.resetPasswordUrl"
                    (input)="patch({ resetPasswordUrl: $any($event.target).value })"
                  />
                  <p hlmFieldDescription>{{ t('endUsers.settings.resetPasswordUrlHint') }}</p>
                </div>
              </div>
            </section>

            <section hlmCard class="lg:col-span-2">
              <div hlmCardHeader>
                <h2 hlmCardTitle>{{ t('endUsers.settings.providers') }}</h2>
                <p hlmCardDescription>{{ t('endUsers.settings.providersHint') }}</p>
              </div>
              <div hlmCardContent class="flex flex-col gap-4">
                @for (row of form.providers; track $index; let index = $index) {
                  <div class="flex flex-col gap-4 rounded-lg border p-4">
                    <div class="flex flex-wrap items-end gap-3">
                      <div hlmField class="min-w-48 flex-1">
                        <label hlmFieldLabel [for]="'provider-name-' + index">{{
                          t('endUsers.settings.provider.name')
                        }}</label>
                        <input
                          hlmInput
                          class="font-mono"
                          placeholder="github"
                          [id]="'provider-name-' + index"
                          [value]="row.name"
                          (input)="setProvider(index, { name: $any($event.target).value })"
                        />
                      </div>
                      <span hlmBadge variant="outline" class="mb-2 font-normal">
                        {{
                          isPreset(row.name)
                            ? t('endUsers.settings.provider.preset')
                            : t('endUsers.settings.provider.generic')
                        }}
                      </span>
                      <label class="mb-1.5 flex items-center gap-2 text-sm">
                        <hlm-switch
                          [checked]="row.enabled"
                          [aria-label]="t('endUsers.settings.provider.enabled')"
                          (checkedChange)="setProvider(index, { enabled: $event })"
                        />
                        {{ t('endUsers.settings.provider.enabled') }}
                      </label>
                      <button
                        hlmBtn
                        size="icon-sm"
                        variant="ghost"
                        class="text-muted-foreground hover:text-destructive mb-1"
                        [attr.aria-label]="
                          t('endUsers.settings.provider.remove', { name: row.name || '…' })
                        "
                        [attr.title]="t('common.delete')"
                        (click)="deleteProvider(index)"
                      >
                        <ng-icon name="lucideTrash2" />
                      </button>
                    </div>
                    <div class="grid gap-4 md:grid-cols-2">
                      <div hlmField>
                        <label hlmFieldLabel [for]="'provider-client-' + index">{{
                          t('endUsers.settings.provider.clientId')
                        }}</label>
                        <input
                          hlmInput
                          class="font-mono"
                          autocomplete="off"
                          [id]="'provider-client-' + index"
                          [value]="row.clientId"
                          (input)="setProvider(index, { clientId: $any($event.target).value })"
                        />
                      </div>
                      <div hlmField>
                        <label hlmFieldLabel [for]="'provider-scope-' + index">{{
                          t('endUsers.settings.provider.scope')
                        }}</label>
                        <input
                          hlmInput
                          class="font-mono"
                          [id]="'provider-scope-' + index"
                          [placeholder]="scopePlaceholder(row.name)"
                          [value]="row.scope"
                          (input)="setProvider(index, { scope: $any($event.target).value })"
                        />
                        <p hlmFieldDescription>{{ t('endUsers.settings.provider.scopeHint') }}</p>
                      </div>
                      <div hlmField class="md:col-span-2">
                        <label hlmFieldLabel [for]="'provider-redirect-' + index">{{
                          t('endUsers.settings.provider.redirectUri')
                        }}</label>
                        <input
                          hlmInput
                          type="url"
                          class="font-mono"
                          placeholder="https://app.example.com/connect/github/redirect"
                          [id]="'provider-redirect-' + index"
                          [value]="row.redirectUri"
                          (input)="setProvider(index, { redirectUri: $any($event.target).value })"
                        />
                        <p hlmFieldDescription>
                          {{ t('endUsers.settings.provider.redirectUriHint') }}
                        </p>
                      </div>
                      @if (!isPreset(row.name)) {
                        @for (field of urlFields; track field.key) {
                          <div hlmField>
                            <label hlmFieldLabel [for]="'provider-' + field.key + '-' + index">{{
                              t(field.label)
                            }}</label>
                            <input
                              hlmInput
                              type="url"
                              class="font-mono"
                              placeholder="https://"
                              [id]="'provider-' + field.key + '-' + index"
                              [value]="row[field.key]"
                              (input)="setUrl(index, field.key, $any($event.target).value)"
                            />
                          </div>
                        }
                      }
                    </div>
                    <div class="bg-muted/40 flex flex-col gap-2 rounded-lg p-3 text-xs">
                      <span class="text-muted-foreground">{{
                        t('endUsers.settings.provider.callback')
                      }}</span>
                      <div class="flex items-center gap-2">
                        <code class="bg-background min-w-0 flex-1 rounded px-2 py-1 break-all">{{
                          callback(row.name)
                        }}</code>
                        <button
                          hlmBtn
                          size="icon-sm"
                          variant="ghost"
                          [attr.aria-label]="t('common.copy')"
                          [attr.title]="t('common.copy')"
                          (click)="copy(callback(row.name))"
                        >
                          <ng-icon name="lucideCopy" />
                        </button>
                      </div>
                      <span class="text-muted-foreground flex flex-wrap items-center gap-1">
                        <ng-icon name="lucideKeyRound" size="12" />
                        {{ t('endUsers.settings.provider.secret') }}
                        <code class="bg-background rounded px-1.5 py-0.5">{{
                          envVar(row.name)
                        }}</code>
                      </span>
                    </div>
                  </div>
                } @empty {
                  <p class="text-muted-foreground text-sm">
                    {{ t('endUsers.settings.noProviders') }}
                  </p>
                }
                @if (providerError(); as problem) {
                  <p class="text-destructive text-sm">{{ problem }}</p>
                }
                <div class="flex flex-wrap gap-2">
                  @for (preset of presets; track preset) {
                    <button
                      hlmBtn
                      variant="outline"
                      size="sm"
                      [disabled]="hasProvider(preset)"
                      (click)="newProvider(preset)"
                    >
                      <ng-icon name="lucidePlus" />
                      {{ t('endUsers.settings.addPreset', { name: presetName(preset) }) }}
                    </button>
                  }
                  <button hlmBtn variant="outline" size="sm" (click)="newProvider('')">
                    <ng-icon name="lucidePlus" /> {{ t('endUsers.settings.addGeneric') }}
                  </button>
                </div>
              </div>
            </section>

            <section hlmCard class="lg:col-span-2">
              <div hlmCardHeader>
                <h2 hlmCardTitle>{{ t('endUsers.settings.templates') }}</h2>
                <p hlmCardDescription>
                  {{ t('endUsers.settings.templatesHint') }}
                </p>
                <div class="flex flex-wrap gap-1 pt-1">
                  @for (placeholder of placeholders; track placeholder) {
                    <code class="bg-muted rounded px-1.5 py-0.5 text-xs">{{ placeholder }}</code>
                  }
                </div>
              </div>
              <div hlmCardContent class="grid gap-6 md:grid-cols-2">
                @for (section of templates; track section.name) {
                  <div class="flex flex-col gap-3">
                    <div class="flex flex-col gap-0.5">
                      <h3 class="text-sm font-medium">{{ t(section.label) }}</h3>
                      <p class="text-muted-foreground text-xs">{{ t(section.hint) }}</p>
                    </div>
                    <div hlmField>
                      <label hlmFieldLabel [for]="'template-subject-' + section.name">{{
                        t('endUsers.settings.template.subject')
                      }}</label>
                      <input
                        hlmInput
                        [id]="'template-subject-' + section.name"
                        [value]="form.templates[section.name].subject"
                        (input)="setTemplate(section.name, { subject: $any($event.target).value })"
                      />
                    </div>
                    <div hlmField>
                      <label hlmFieldLabel [for]="'template-text-' + section.name">{{
                        t('endUsers.settings.template.text')
                      }}</label>
                      <textarea
                        hlmTextarea
                        rows="7"
                        class="font-mono text-xs"
                        [id]="'template-text-' + section.name"
                        [value]="form.templates[section.name].text"
                        (input)="setTemplate(section.name, { text: $any($event.target).value })"
                      ></textarea>
                    </div>
                  </div>
                }
              </div>
            </section>
          </div>
        }
      }
    </div>
  `,
})
export class EndUsersSettingsPage implements OnInit {
  private readonly features = inject(Features);
  private readonly service = inject(EndUsers);
  private readonly auth = inject(Auth);
  private readonly config = inject(RUNTIME_CONFIG);
  protected readonly t = inject(I18n).t;

  protected readonly authenticated = AUTHENTICATED_ROLE;
  protected readonly presets = PRESET_PROVIDERS;
  protected readonly placeholders = TEMPLATE_PLACEHOLDERS;
  protected readonly templates = TEMPLATES;
  protected readonly urlFields = URL_FIELDS;

  protected readonly form = signal<UsersSettingsForm | null>(null);
  protected readonly enabled = signal(false);
  protected readonly roles = signal<EndUserRole[]>([]);
  protected readonly loadError = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly canManage = computed(() => this.auth.can('features.manage'));

  /** The roles to pick the default from; the stored one stays listed even if it is unknown. */
  protected readonly roleOptions = computed(() => {
    const roles = this.roles().map((role) => ({ type: role.type, name: role.name }));
    const current = this.form()?.defaultRole;
    if (current && !roles.some((role) => role.type === current)) {
      roles.push({ type: current, name: current });
    }
    return roles;
  });

  protected readonly providerError = computed(() => {
    const problem = providerProblem(this.form()?.providers ?? []);
    if (!problem) return null;
    const row = this.form()!.providers[problem.index];
    const name = row.name.trim() || `#${problem.index + 1}`;
    switch (problem.kind) {
      case 'name':
        return this.t('endUsers.settings.problem.name', { name });
      case 'duplicate':
        return this.t('endUsers.settings.problem.duplicate', { name });
      case 'clientId':
        return this.t('endUsers.settings.problem.clientId', { name });
      case 'urls':
        return this.t('endUsers.settings.problem.urls', { name });
    }
  });

  protected readonly canSave = computed(
    () => !!this.form() && this.canManage() && !this.saving() && !this.providerError(),
  );

  async ngOnInit(): Promise<void> {
    try {
      const [catalog, roles] = await Promise.all([
        this.features.catalog() ? Promise.resolve(this.features.catalog()!) : this.features.load(),
        this.service.roles().catch(() => [] as EndUserRole[]),
      ]);
      this.roles.set(roles);
      const feature = catalog.find((item) => item.id === FEATURE);
      this.enabled.set(!!feature?.enabled);
      this.form.set(settingsForm(usersSettings(feature?.settings)));
    } catch (error) {
      this.loadError.set(ApiFailure.from(error).message);
    }
  }

  protected patch(changes: Partial<UsersSettingsForm>): void {
    this.form.update((form) => (form ? { ...form, ...changes } : form));
  }

  protected setProvider(index: number, changes: Partial<ProviderRow>): void {
    const form = this.form();
    if (form) this.patch({ providers: updateProvider(form.providers, index, changes) });
  }

  protected setUrl(index: number, key: UrlField, value: string): void {
    this.setProvider(index, { [key]: value });
  }

  protected newProvider(name: string): void {
    const form = this.form();
    if (form) this.patch({ providers: addProvider(form.providers, name) });
  }

  protected deleteProvider(index: number): void {
    const form = this.form();
    if (form) this.patch({ providers: removeProvider(form.providers, index) });
  }

  protected hasProvider(name: string): boolean {
    return (this.form()?.providers ?? []).some((row) => row.name.trim().toLowerCase() === name);
  }

  protected setTemplate(name: TemplateName, changes: Partial<{ subject: string; text: string }>) {
    const form = this.form();
    if (!form) return;
    this.patch({
      templates: { ...form.templates, [name]: { ...form.templates[name], ...changes } },
    });
  }

  protected isPreset(name: string): boolean {
    return isPresetProvider(name);
  }

  protected presetName(preset: string): string {
    return preset === 'github' ? 'GitHub' : preset === 'google' ? 'Google' : preset;
  }

  protected scopePlaceholder(name: string): string {
    const preset = name.trim().toLowerCase();
    if (preset === 'github') return 'user:email';
    if (preset === 'google') return 'openid email profile';
    return 'openid email';
  }

  protected callback(name: string): string {
    return callbackUrl(window.location.origin, this.config.contentApiBase, name);
  }

  protected envVar(name: string): string {
    return secretEnvVar(name);
  }

  protected async copy(value: string): Promise<void> {
    await navigator.clipboard.writeText(value);
    toast.success(this.t('common.copied'));
  }

  protected async save(): Promise<void> {
    const form = this.form();
    if (!form || !this.canSave()) return;
    this.error.set(null);
    this.saving.set(true);
    const previous = this.features.catalog()?.find((item) => item.id === FEATURE)?.settings ?? null;
    try {
      const catalog = await this.features.update(
        FEATURE,
        this.enabled(),
        settingsFromForm(form, previous),
      );
      const feature = catalog.find((item) => item.id === FEATURE);
      this.enabled.set(!!feature?.enabled);
      this.form.set(settingsForm(usersSettings(feature?.settings)));
      toast.success(this.t('endUsers.settings.saved'));
    } catch (error) {
      this.error.set(ApiFailure.from(error).message);
    } finally {
      this.saving.set(false);
    }
  }
}
