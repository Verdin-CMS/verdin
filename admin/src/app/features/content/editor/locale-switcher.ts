import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDropdownMenuImports } from '@spartan-ng/helm/dropdown-menu';

import { Auth } from '../../../core/auth';
import {
  ContentLocales,
  LocaleState,
  LocaleVersion,
  localeState,
} from '../../../core/content-locales';
import { I18n } from '../../../core/i18n/i18n';

const LOCALE_STATE_LABELS = {
  published: 'content.locale.state.published',
  draft: 'content.locale.state.draft',
  missing: 'content.locale.state.missing',
} as const satisfies Record<LocaleState, string>;

/** The status dot of a locale version. */
export function localeDot(state: LocaleState): string {
  return state === 'published'
    ? 'bg-emerald-500'
    : state === 'draft'
      ? 'bg-muted-foreground/60'
      : 'border-muted-foreground/60 border border-dashed';
}

/**
 * The editor's locale menu: the edited locale with its state, and every locale with the
 * state of the document's version in it (locales the admin may not read are disabled).
 */
@Component({
  selector: 'vd-locale-switcher',
  imports: [NgIcon, HlmButtonImports, HlmDropdownMenuImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    @let current = locale();
    @let currentState = stateOf(current);
    <button
      hlmBtn
      variant="outline"
      type="button"
      [hlmDropdownMenuTrigger]="localeMenu"
      align="end"
      [attr.aria-label]="t('content.locale.switch', { locale: locales.name(current) })"
    >
      <ng-icon name="lucideLanguages" />
      <span [attr.lang]="current">{{ locales.name(current) }}</span>
      <span
        class="size-2 rounded-full"
        aria-hidden="true"
        [class]="localeDot(currentState)"
        [attr.title]="t(localeStateLabels[currentState])"
      ></span>
      <ng-icon name="lucideChevronDown" class="text-muted-foreground" />
    </button>
    <ng-template #localeMenu>
      <hlm-dropdown-menu class="w-64">
        <hlm-dropdown-menu-label>{{ t('content.locale.label') }}</hlm-dropdown-menu-label>
        <hlm-dropdown-menu-group>
          @for (option of locales.list() ?? []; track option.code) {
            @let state = stateOf(option.code);
            @let readable = auth.canInLocale('content.read', uid(), option.code);
            <button
              hlmDropdownMenuRadio
              [checked]="option.code === current"
              [disabled]="!readable"
              (triggered)="switched.emit(option.code)"
            >
              <span
                class="size-2 shrink-0 rounded-full"
                aria-hidden="true"
                [class]="localeDot(state)"
              ></span>
              <span class="flex min-w-0 flex-col">
                <span class="truncate" [attr.lang]="option.code">{{ option.name }}</span>
                <span class="text-muted-foreground text-xs"
                  >{{ option.code }} · {{ t(localeStateLabels[state]) }}</span
                >
              </span>
              <hlm-dropdown-menu-radio-indicator />
            </button>
          }
        </hlm-dropdown-menu-group>
      </hlm-dropdown-menu>
    </ng-template>
  `,
})
export class LocaleSwitcher {
  protected readonly auth = inject(Auth);
  protected readonly locales = inject(ContentLocales);
  protected readonly t = inject(I18n).t;
  protected readonly localeStateLabels = LOCALE_STATE_LABELS;
  protected readonly localeDot = localeDot;

  /** The edited type's uid (read permissions are per locale). */
  readonly uid = input.required<string>();
  /** The edited locale. */
  readonly locale = input.required<string>();
  /** The document's versions per locale. */
  readonly versions = input<readonly LocaleVersion[]>([]);
  /** A locale was chosen (the current one included: the editor ignores it). */
  readonly switched = output<string>();

  protected stateOf(code: string): LocaleState {
    return localeState(this.versions(), code);
  }
}
