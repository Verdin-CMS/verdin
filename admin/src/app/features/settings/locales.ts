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
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCheckboxImports } from '@spartan-ng/helm/checkbox';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { HlmTableImports } from '@spartan-ng/helm/table';

import { ApiFailure } from '../../core/api';
import { Auth } from '../../core/auth';
import {
  COMMON_LOCALE_CODES,
  ContentLocale,
  ContentLocales,
  isLocaleCode,
  localeDisplayName,
} from '../../core/content-locales';
import { I18n } from '../../core/i18n/i18n';
import { PageHeader } from '../../shared/components/page-header';

/** The add/edit dialog: `original` is the edited locale's code, `null` when adding. */
interface LocaleDraft {
  original: string | null;
  code: string;
  name: string;
  /** The admin typed the name (a code change no longer replaces it). */
  nameEdited: boolean;
  isDefault: boolean;
}

/** Settings → Internationalization: the locales content is written in. */
@Component({
  selector: 'vd-locales',
  imports: [
    NgIcon,
    HlmAlertImports,
    HlmAlertDialogImports,
    HlmBadgeImports,
    HlmButtonImports,
    HlmCheckboxImports,
    HlmDialogImports,
    HlmEmptyImports,
    HlmFieldImports,
    HlmInputImports,
    HlmSkeletonImports,
    HlmSpinnerImports,
    HlmTableImports,
    PageHeader,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-6">
      <vd-page-header
        [title]="t('settings.locales.title')"
        [description]="t('settings.locales.description')"
      >
        <span eyebrow class="text-primary flex items-center gap-1.5 text-xs font-medium">
          <ng-icon name="lucideLanguages" size="14" /> {{ t('shell.settings') }}
        </span>
        @if (canManage()) {
          <div actions>
            <button hlmBtn (click)="openAdd()">
              <ng-icon name="lucidePlus" /> {{ t('settings.locales.add') }}
            </button>
          </div>
        }
      </vd-page-header>

      @if (!canManage()) {
        <div hlmAlert>
          <ng-icon hlmAlertIcon name="lucideLock" />
          <p hlmAlertDescription>{{ t('settings.locales.readOnly') }}</p>
        </div>
      }

      @if (error()) {
        <div hlmAlert variant="destructive">
          <ng-icon hlmAlertIcon name="lucideCircleAlert" />
          <p hlmAlertTitle>{{ t('settings.locales.loadError') }}</p>
          <p hlmAlertDescription>{{ error() }}</p>
        </div>
      } @else if (locales.list() === null) {
        <hlm-skeleton class="h-48 rounded-xl" />
      } @else if (locales.list()!.length === 0) {
        <div hlmEmpty class="rounded-xl border border-dashed py-16">
          <div hlmEmptyHeader>
            <div hlmEmptyMedia variant="icon"><ng-icon name="lucideLanguages" /></div>
            <h2 hlmEmptyTitle>{{ t('settings.locales.emptyTitle') }}</h2>
          </div>
        </div>
      } @else {
        <div class="bg-card overflow-hidden rounded-xl border">
          <div hlmTableContainer>
            <table hlmTable>
              <thead hlmTHead class="bg-muted/50">
                <tr hlmTr class="hover:bg-transparent">
                  <th hlmTh class="ps-4">{{ t('common.name') }}</th>
                  <th hlmTh>{{ t('settings.locales.code') }}</th>
                  <th hlmTh class="pe-4">
                    <span class="sr-only">{{ t('common.actions') }}</span>
                  </th>
                </tr>
              </thead>
              <tbody hlmTBody>
                @for (locale of locales.list(); track locale.code) {
                  <tr hlmTr>
                    <td hlmTd class="ps-4">
                      <div class="flex items-center gap-3">
                        <span
                          class="flex size-8 shrink-0 items-center justify-center rounded-lg"
                          [class]="
                            locale.isDefault
                              ? 'bg-primary/10 text-primary'
                              : 'bg-muted text-muted-foreground'
                          "
                        >
                          <ng-icon name="lucideLanguages" size="16" />
                        </span>
                        <span class="font-medium" [attr.lang]="locale.code">{{ locale.name }}</span>
                        @if (locale.isDefault) {
                          <span
                            hlmBadge
                            variant="secondary"
                            [attr.title]="t('settings.locales.defaultHint')"
                          >
                            <ng-icon name="lucideStar" />
                            {{ t('settings.locales.default') }}
                          </span>
                        }
                      </div>
                    </td>
                    <td hlmTd>
                      <code class="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">{{
                        locale.code
                      }}</code>
                    </td>
                    <td hlmTd class="pe-4">
                      @if (canManage()) {
                        <div class="flex justify-end gap-1">
                          @if (!locale.isDefault) {
                            <button
                              hlmBtn
                              size="sm"
                              variant="ghost"
                              class="text-muted-foreground"
                              [disabled]="busy() === locale.code"
                              [attr.aria-label]="
                                t('settings.locales.setDefaultLabel', { name: locale.name })
                              "
                              (click)="makeDefault(locale)"
                            >
                              @if (busy() === locale.code) {
                                <hlm-spinner class="size-4" />
                              } @else {
                                <ng-icon name="lucideStar" />
                              }
                              <span class="hidden sm:inline">{{
                                t('settings.locales.setDefault')
                              }}</span>
                            </button>
                          }
                          <button
                            hlmBtn
                            size="icon-sm"
                            variant="ghost"
                            class="text-muted-foreground"
                            [attr.aria-label]="
                              t('settings.locales.editLabel', { name: locale.name })
                            "
                            [attr.title]="t('common.edit')"
                            (click)="openEdit(locale)"
                          >
                            <ng-icon name="lucidePencil" />
                          </button>
                          <button
                            hlmBtn
                            size="icon-sm"
                            variant="ghost"
                            class="text-muted-foreground hover:text-destructive"
                            [disabled]="locale.isDefault"
                            [attr.aria-label]="
                              t('settings.locales.deleteLabel', { name: locale.name })
                            "
                            [attr.title]="
                              locale.isDefault
                                ? t('settings.locales.defaultLocked')
                                : t('common.delete')
                            "
                            (click)="askDelete(locale)"
                          >
                            <ng-icon name="lucideTrash2" />
                          </button>
                        </div>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }
    </div>

    <!-- Add / edit -->
    <hlm-dialog [state]="draft() ? 'open' : 'closed'" (closed)="draft.set(null)">
      <hlm-dialog-content
        *hlmDialogPortal="let ctx"
        class="sm:max-w-lg"
        [closeLabel]="t('common.close')"
      >
        @if (draft(); as form) {
          <hlm-dialog-header>
            <h2 hlmDialogTitle>
              {{
                form.original
                  ? t('settings.locales.editTitle', { name: locales.name(form.original) })
                  : t('settings.locales.addTitle')
              }}
            </h2>
            @if (!form.original) {
              <p hlmDialogDescription>{{ t('settings.locales.addDescription') }}</p>
            }
          </hlm-dialog-header>
          <form
            id="locale-form"
            class="flex flex-col gap-4"
            (submit)="$event.preventDefault(); save()"
          >
            <div hlmField [attr.data-invalid]="codeProblem() ? true : null">
              <label hlmFieldLabel for="locale-code">{{ t('settings.locales.code') }}</label>
              <input
                hlmInput
                id="locale-code"
                class="font-mono"
                list="locale-codes"
                autocomplete="off"
                spellcheck="false"
                [value]="form.code"
                [disabled]="!!form.original"
                [attr.aria-invalid]="codeProblem() ? true : null"
                (input)="setCode($any($event.target).value)"
              />
              <datalist id="locale-codes">
                @for (option of suggestions(); track option.code) {
                  <option [value]="option.code">{{ option.name }}</option>
                }
              </datalist>
              @if (codeProblem(); as problem) {
                <hlm-field-error>{{ problem }}</hlm-field-error>
              } @else if (!form.original) {
                <p hlmFieldDescription>{{ t('settings.locales.codeHint') }}</p>
              }
            </div>
            <div hlmField>
              <label hlmFieldLabel for="locale-name">{{ t('common.name') }}</label>
              <input
                hlmInput
                id="locale-name"
                maxlength="255"
                [value]="form.name"
                (input)="setName($any($event.target).value)"
              />
            </div>
            @if (!form.original) {
              <div hlmField orientation="horizontal">
                <hlm-checkbox
                  inputId="locale-default"
                  [checked]="form.isDefault"
                  (checkedChange)="patch({ isDefault: $event === true })"
                />
                <div hlmFieldContent>
                  <label hlmFieldLabel for="locale-default">{{
                    t('settings.locales.makeDefault')
                  }}</label>
                  <p hlmFieldDescription>{{ t('settings.locales.defaultHint') }}</p>
                </div>
              </div>
            }
            @if (dialogError()) {
              <div hlmAlert variant="destructive">
                <ng-icon hlmAlertIcon name="lucideCircleAlert" />
                <p hlmAlertDescription>{{ dialogError() }}</p>
              </div>
            }
          </form>
          <hlm-dialog-footer>
            <button hlmBtn variant="outline" type="button" (click)="draft.set(null)">
              {{ t('common.cancel') }}
            </button>
            <button hlmBtn type="submit" form="locale-form" [disabled]="!canSave() || saving()">
              @if (saving()) {
                <hlm-spinner />
              }
              {{ form.original ? t('common.save') : t('settings.locales.add') }}
            </button>
          </hlm-dialog-footer>
        }
      </hlm-dialog-content>
    </hlm-dialog>

    <!-- Delete -->
    <hlm-alert-dialog [state]="deleting() ? 'open' : 'closed'" (closed)="deleting.set(null)">
      <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx">
        @if (deleting(); as locale) {
          <hlm-alert-dialog-header>
            <div hlmAlertDialogMedia class="bg-destructive/10 text-destructive">
              <ng-icon name="lucideTriangleAlert" />
            </div>
            <h2 hlmAlertDialogTitle>
              {{ t('settings.locales.deleteTitle', { name: locale.name }) }}
            </h2>
            <p hlmAlertDialogDescription>
              {{ t('settings.locales.deleteWarning', { name: locale.name, code: locale.code }) }}
            </p>
          </hlm-alert-dialog-header>
          <div hlmField>
            <label hlmFieldLabel for="locale-confirm">{{
              t('settings.locales.deleteConfirm', { code: locale.code })
            }}</label>
            <input
              hlmInput
              id="locale-confirm"
              class="font-mono"
              autocomplete="off"
              spellcheck="false"
              [value]="confirmation()"
              (input)="confirmation.set($any($event.target).value)"
            />
          </div>
          <hlm-alert-dialog-footer>
            <button hlmAlertDialogCancel (click)="ctx.close()">{{ t('common.cancel') }}</button>
            <button
              hlmAlertDialogAction
              variant="destructive"
              [disabled]="confirmation().trim() !== locale.code"
              (click)="ctx.close(); remove(locale)"
            >
              {{ t('settings.locales.deleteAction') }}
            </button>
          </hlm-alert-dialog-footer>
        }
      </hlm-alert-dialog-content>
    </hlm-alert-dialog>
  `,
})
export class LocalesPage implements OnInit {
  private readonly auth = inject(Auth);
  protected readonly locales = inject(ContentLocales);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;

  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal<string | null>(null);
  protected readonly draft = signal<LocaleDraft | null>(null);
  protected readonly dialogError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly deleting = signal<ContentLocale | null>(null);
  protected readonly confirmation = signal('');
  protected readonly canManage = computed(() => this.auth.can('locales.manage'));

  /** Common codes not added yet, named in the admin's language. */
  protected readonly suggestions = computed(() => {
    const taken = new Set((this.locales.list() ?? []).map((locale) => locale.code));
    const language = this.i18n.locale();
    return COMMON_LOCALE_CODES.filter((code) => !taken.has(code)).map((code) => ({
      code,
      name: localeDisplayName(code, language) ?? code,
    }));
  });

  protected readonly codeProblem = computed(() => {
    const form = this.draft();
    if (!form || form.original) return null;
    const code = form.code.trim();
    if (!code) return null;
    if (!isLocaleCode(code)) return this.t('settings.locales.invalidCode');
    if ((this.locales.list() ?? []).some((locale) => locale.code === code))
      return this.t('settings.locales.duplicate');
    return null;
  });

  protected readonly canSave = computed(() => {
    const form = this.draft();
    if (!form || !form.name.trim()) return false;
    return !!form.original || (!!form.code.trim() && !this.codeProblem());
  });

  async ngOnInit(): Promise<void> {
    try {
      await this.locales.refresh();
    } catch (error) {
      this.error.set(ApiFailure.from(error).message);
    }
  }

  protected openAdd(): void {
    this.dialogError.set(null);
    this.draft.set({ original: null, code: '', name: '', nameEdited: false, isDefault: false });
  }

  protected openEdit(locale: ContentLocale): void {
    this.dialogError.set(null);
    this.draft.set({
      original: locale.code,
      code: locale.code,
      name: locale.name,
      nameEdited: true,
      isDefault: locale.isDefault,
    });
  }

  protected patch(changes: Partial<LocaleDraft>): void {
    this.draft.update((form) => (form ? { ...form, ...changes } : form));
  }

  /** A new code suggests its name, until the admin types one. */
  protected setCode(value: string): void {
    const form = this.draft();
    if (!form) return;
    const code = value.trim();
    const suggested = localeDisplayName(code, this.i18n.locale());
    this.patch({
      code: value,
      name: form.nameEdited ? form.name : (suggested ?? form.name),
    });
  }

  protected setName(value: string): void {
    this.patch({ name: value, nameEdited: value.trim() !== '' });
  }

  protected async save(): Promise<void> {
    const form = this.draft();
    if (!form || !this.canSave()) return;
    this.saving.set(true);
    this.dialogError.set(null);
    const name = form.name.trim();
    try {
      if (form.original) {
        await this.locales.update(form.original, { name });
        toast.success(this.t('settings.locales.updated', { name }));
      } else {
        await this.locales.create({ code: form.code.trim(), name, isDefault: form.isDefault });
        toast.success(this.t('settings.locales.created', { name }));
      }
      this.draft.set(null);
    } catch (error) {
      this.dialogError.set(ApiFailure.from(error).message);
    } finally {
      this.saving.set(false);
    }
  }

  protected async makeDefault(locale: ContentLocale): Promise<void> {
    this.busy.set(locale.code);
    try {
      await this.locales.update(locale.code, { isDefault: true });
      toast.success(this.t('settings.locales.defaultSet', { name: locale.name }));
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    } finally {
      this.busy.set(null);
    }
  }

  protected askDelete(locale: ContentLocale): void {
    if (locale.isDefault) return;
    this.confirmation.set('');
    this.deleting.set(locale);
  }

  protected async remove(locale: ContentLocale): Promise<void> {
    this.busy.set(locale.code);
    try {
      await this.locales.remove(locale.code);
      toast.success(this.t('settings.locales.deleted', { name: locale.name }));
    } catch (error) {
      const failure = ApiFailure.from(error);
      toast.error(
        failure.status === 400 && locale.isDefault
          ? this.t('settings.locales.defaultLocked')
          : failure.message,
      );
    } finally {
      this.busy.set(null);
    }
  }
}
