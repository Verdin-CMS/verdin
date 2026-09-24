import { DOCUMENT } from '@angular/common';
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { MonthLabels, injectBrnCalendarI18n } from '@spartan-ng/brain/calendar';
import { firstValueFrom } from 'rxjs';

import { Preferences } from '../preferences';
import { DEFAULT_LOCALE, LOCALES, LocaleTag, matchLocale } from './locales';
import { MessageKey, Params } from './keys';
import { Weekday, firstDayOfWeek } from './week';

export type WeekStartPreference = 'auto' | Weekday;

/**
 * Runtime translations (Transloco + ICU MessageFormat, catalogs in `public/i18n`) and
 * locale-aware formatting. `t()` and the formatters read the `locale` signal, so templates
 * update when the language changes; new code may also use Transloco's `translateSignal`.
 */
@Injectable({ providedIn: 'root' })
export class I18n {
  private readonly document = inject(DOCUMENT);
  private readonly preferences = inject(Preferences);
  private readonly calendar = injectBrnCalendarI18n();
  private readonly transloco = inject(TranslocoService);

  readonly locales = LOCALES;
  private readonly browserLocales: readonly string[] =
    typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language]);

  /** The interface language. */
  readonly locale = signal<LocaleTag>(DEFAULT_LOCALE);

  /**
   * The tag used for dates and numbers: the browser's own when it is a regional variant
   * of the interface language (en-GB, es-MX…), so formats and week start follow the region.
   */
  readonly formatLocale = computed(() => {
    const language = new Intl.Locale(this.locale()).language;
    const regional = this.browserLocales.find((tag) => {
      try {
        return new Intl.Locale(tag).language === language;
      } catch {
        return false;
      }
    });
    return regional ?? this.locale();
  });

  readonly weekStartPreference = computed<WeekStartPreference>(
    () => this.preferences.value().weekStart ?? 'auto',
  );
  readonly weekStart = computed<Weekday>(() => {
    const preference = this.weekStartPreference();
    return preference === 'auto' ? firstDayOfWeek(this.formatLocale()) : preference;
  });

  private readonly numberFormat = computed(() => new Intl.NumberFormat(this.formatLocale()));

  constructor() {
    effect(() => {
      const tag = this.locale();
      this.document.documentElement.lang = tag;
    });
    effect(() => {
      const tag = this.formatLocale();
      const weekStart = this.weekStart();
      // `use()` reads the calendar config it writes: keep it out of the effect's dependencies.
      untracked(() => this.configureCalendar(tag, weekStart));
    });
  }

  /** Picks the saved language, or the best match for the browser. Called at bootstrap. */
  async init(): Promise<void> {
    const saved = this.preferences.value().locale;
    const tag = LOCALES.some((locale) => locale.tag === saved)
      ? (saved as LocaleTag)
      : matchLocale(this.browserLocales);
    await this.use(tag);
  }

  async setLocale(tag: LocaleTag): Promise<void> {
    await this.use(tag);
    this.preferences.update({ locale: tag });
  }

  setWeekStart(preference: WeekStartPreference): void {
    this.preferences.update({ weekStart: preference === 'auto' ? undefined : preference });
  }

  private async use(tag: LocaleTag): Promise<void> {
    try {
      // English is the fallback of every other catalog.
      await Promise.all([
        firstValueFrom(this.transloco.load(DEFAULT_LOCALE)),
        firstValueFrom(this.transloco.load(tag)),
      ]);
    } catch {
      // A catalog that fails to load keeps the current language.
      return;
    }
    this.transloco.setActiveLang(tag);
    this.locale.set(tag);
  }

  /**
   * Translates `key`. Numbers are formatted for the locale, except `count`, which plural
   * rules need raw (messages show it with `#` or `{count, number}`).
   */
  readonly t = (key: MessageKey, params?: Params): string => {
    const lang = this.locale();
    if (!params) return this.transloco.translate(key, {}, lang);
    const values: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;
      values[name] =
        typeof value === 'number' && name !== 'count' ? this.numberFormat().format(value) : value;
    }
    return this.transloco.translate(key, values, lang);
  };

  /** Date, time or both, in the user's locale; `—` for empty or invalid values. */
  readonly formatDate = (
    value: string | Date | null | undefined,
    style: 'date' | 'datetime' | 'time' | 'long' = 'datetime',
  ): string => {
    if (value === null || value === undefined || value === '') return '—';
    const date = typeof value === 'string' ? parseDate(value) : value;
    if (!date || Number.isNaN(date.getTime())) return String(value);
    const options: Intl.DateTimeFormatOptions =
      style === 'date'
        ? { dateStyle: 'medium' }
        : style === 'time'
          ? { timeStyle: 'short' }
          : style === 'long'
            ? { dateStyle: 'long', timeStyle: 'short' }
            : { dateStyle: 'medium', timeStyle: 'short' };
    return new Intl.DateTimeFormat(this.formatLocale(), options).format(date);
  };

  /** "3 minutes ago", "yesterday"… */
  readonly formatRelative = (value: string | Date | null | undefined): string => {
    if (!value) return '—';
    const date = typeof value === 'string' ? new Date(value) : value;
    const seconds = (date.getTime() - Date.now()) / 1000;
    if (Number.isNaN(seconds)) return String(value);
    const format = new Intl.RelativeTimeFormat(this.locale(), { numeric: 'auto' });
    const units: [Intl.RelativeTimeFormatUnit, number][] = [
      ['year', 31_536_000],
      ['month', 2_592_000],
      ['week', 604_800],
      ['day', 86_400],
      ['hour', 3_600],
      ['minute', 60],
    ];
    for (const [unit, size] of units) {
      if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
    }
    return format.format(0, 'minute');
  };

  readonly formatNumber = (value: number | string): string => {
    const number = typeof value === 'number' ? value : Number(value);
    // Bigintegers and exact decimals exceed doubles: show them as sent.
    if (typeof value === 'string' && !Number.isSafeInteger(number) && /^-?\d+$/.test(value)) {
      return value;
    }
    return Number.isFinite(number) ? this.numberFormat().format(number) : String(value);
  };

  private configureCalendar(tag: string, weekStart: Weekday): void {
    // 2023-01-01 was a Sunday: index 0 of the calendar's weekdays.
    const weekday = (index: number, width: 'short' | 'long') =>
      new Intl.DateTimeFormat(tag, { weekday: width }).format(new Date(2023, 0, 1 + index));
    const month = (index: number, width: 'short' | 'long') =>
      new Intl.DateTimeFormat(tag, { month: width }).format(new Date(2000, index, 1));
    const months = Array.from({ length: 12 }, (_, index) =>
      capitalize(month(index, 'long'), tag),
    ) as MonthLabels;
    this.calendar.use({
      firstDayOfWeek: () => weekStart,
      formatWeekdayName: (index) => weekday(index, 'short'),
      labelWeekday: (index) => weekday(index, 'long'),
      months: () => months,
      formatMonth: (index) => month(index, 'short'),
      formatYear: (year) => String(year),
      formatHeader: (index, year) =>
        capitalize(
          new Intl.DateTimeFormat(tag, { month: 'long', year: 'numeric' }).format(
            new Date(year, index, 1),
          ),
          tag,
        ),
      labelPrevious: () => this.t('calendar.previous'),
      labelNext: () => this.t('calendar.next'),
    });
  }
}

/** `YYYY-MM-DD` is a calendar date (local midnight), anything else an instant. */
export function parseDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function capitalize(text: string, tag: string): string {
  return text.charAt(0).toLocaleUpperCase(tag) + text.slice(1);
}
