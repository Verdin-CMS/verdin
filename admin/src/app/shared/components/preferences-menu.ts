import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDropdownMenuImports } from '@spartan-ng/helm/dropdown-menu';

import { I18n, WeekStartPreference } from '../../core/i18n/i18n';
import { Weekday } from '../../core/i18n/week';
import { Theme, ThemeChoice } from '../../core/theme';

/** Theme, language and first day of the week. */
@Component({
  selector: 'vd-preferences-menu',
  imports: [NgIcon, HlmButtonImports, HlmDropdownMenuImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      hlmBtn
      variant="ghost"
      [size]="compact() ? 'icon' : 'sm'"
      [hlmDropdownMenuTrigger]="menu"
      align="end"
      [attr.aria-label]="i18n.t('prefs.title')"
    >
      <ng-icon [name]="theme.dark() ? 'lucideMoon' : 'lucideSun'" />
      @if (!compact()) {
        <span>{{ currentLanguage() }}</span>
      }
    </button>
    <ng-template #menu>
      <hlm-dropdown-menu class="w-60">
        <hlm-dropdown-menu-label>{{ i18n.t('prefs.theme') }}</hlm-dropdown-menu-label>
        <hlm-dropdown-menu-group>
          @for (option of themes; track option.value) {
            <button
              hlmDropdownMenuRadio
              [checked]="theme.choice() === option.value"
              (triggered)="theme.set(option.value)"
            >
              <ng-icon [name]="option.icon" />
              {{ i18n.t(option.label) }}
              <hlm-dropdown-menu-radio-indicator />
            </button>
          }
        </hlm-dropdown-menu-group>
        <hlm-dropdown-menu-separator />
        <button hlmDropdownMenuItem [hlmDropdownMenuSubTrigger]="languages">
          <ng-icon name="lucideLanguages" />
          {{ i18n.t('prefs.language') }}
          <span class="text-muted-foreground ms-auto text-xs">{{ currentLanguage() }}</span>
          <hlm-dropdown-menu-item-sub-indicator />
        </button>
        <button hlmDropdownMenuItem [hlmDropdownMenuSubTrigger]="weekStarts">
          <ng-icon name="lucideCalendar" />
          {{ i18n.t('prefs.weekStart') }}
          <hlm-dropdown-menu-item-sub-indicator />
        </button>
      </hlm-dropdown-menu>
    </ng-template>

    <ng-template #languages>
      <hlm-dropdown-menu-sub class="max-h-96 w-52 overflow-y-auto">
        @for (locale of i18n.locales; track locale.tag) {
          <button
            hlmDropdownMenuRadio
            [checked]="i18n.locale() === locale.tag"
            [attr.lang]="locale.tag"
            (triggered)="i18n.setLocale(locale.tag)"
          >
            {{ locale.name }}
            <hlm-dropdown-menu-radio-indicator />
          </button>
        }
      </hlm-dropdown-menu-sub>
    </ng-template>

    <ng-template #weekStarts>
      <hlm-dropdown-menu-sub class="w-56">
        @for (option of weekOptions; track option) {
          <button
            hlmDropdownMenuRadio
            [checked]="i18n.weekStartPreference() === option"
            (triggered)="i18n.setWeekStart(option)"
          >
            {{ weekLabel(option) }}
            <hlm-dropdown-menu-radio-indicator />
          </button>
        }
      </hlm-dropdown-menu-sub>
    </ng-template>
  `,
})
export class PreferencesMenu {
  protected readonly i18n = inject(I18n);
  protected readonly theme = inject(Theme);
  /** Icon-only trigger. */
  readonly compact = input(false);

  protected readonly themes: {
    value: ThemeChoice;
    label: 'prefs.light' | 'prefs.dark' | 'prefs.system';
    icon: string;
  }[] = [
    { value: 'light', label: 'prefs.light', icon: 'lucideSun' },
    { value: 'dark', label: 'prefs.dark', icon: 'lucideMoon' },
    { value: 'system', label: 'prefs.system', icon: 'lucideMonitor' },
  ];
  protected readonly weekOptions: WeekStartPreference[] = ['auto', 1, 0, 6];

  protected currentLanguage(): string {
    return this.i18n.locales.find((locale) => locale.tag === this.i18n.locale())?.name ?? '';
  }

  protected weekLabel(option: WeekStartPreference): string {
    const name = (day: Weekday) => {
      const text = new Intl.DateTimeFormat(this.i18n.formatLocale(), { weekday: 'long' }).format(
        new Date(2023, 0, 1 + day),
      );
      return text.charAt(0).toLocaleUpperCase(this.i18n.locale()) + text.slice(1);
    };
    return option === 'auto'
      ? this.i18n.t('prefs.weekAuto', { day: name(this.i18n.weekStart()) })
      : name(option);
  }
}
