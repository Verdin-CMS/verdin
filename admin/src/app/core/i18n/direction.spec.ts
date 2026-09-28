import { Directionality } from '@angular/cdk/bidi';
import { DOCUMENT } from '@angular/common';
import { Injectable } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Translation, TranslocoLoader, provideTransloco } from '@jsverse/transloco';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { I18n } from './i18n';
import { LOCALES, textDirection } from './locales';

@Injectable()
class EmptyLoader implements TranslocoLoader {
  getTranslation() {
    return of({} as Translation);
  }
}

describe('textDirection', () => {
  it('knows the right-to-left languages', () => {
    for (const tag of ['ar', 'he', 'fa', 'ar-EG', 'fa-IR', 'iw'])
      expect(textDirection(tag)).toBe('rtl');
    for (const tag of ['en', 'es', 'zh-Hans', 'ja', 'x-invalid-'])
      expect(textDirection(tag)).toBe('ltr');
  });

  it('offers Arabic, Hebrew and Persian', () => {
    const tags = LOCALES.map((locale) => locale.tag as string);
    expect(tags).toEqual(expect.arrayContaining(['ar', 'he', 'fa']));
  });
});

describe('I18n direction', () => {
  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {
      // No storage: nothing to clear.
    }
    TestBed.configureTestingModule({
      providers: [
        provideTransloco({
          config: { availableLangs: LOCALES.map((locale) => locale.tag), defaultLang: 'en' },
          loader: EmptyLoader,
        }),
      ],
    });
  });

  afterEach(() => {
    const root = TestBed.inject(DOCUMENT).documentElement;
    root.removeAttribute('dir');
    root.lang = '';
  });

  it('sets <html dir="rtl"> for Arabic, and back to ltr', async () => {
    const i18n = TestBed.inject(I18n);
    const root = TestBed.inject(DOCUMENT).documentElement;
    const direction = TestBed.inject(Directionality);

    await i18n.setLocale('ar');
    TestBed.tick();
    expect(root.getAttribute('dir')).toBe('rtl');
    expect(root.lang).toBe('ar');
    expect(i18n.direction()).toBe('rtl');
    expect(i18n.endSide()).toBe('left');
    expect(direction.value).toBe('rtl');

    await i18n.setLocale('en');
    TestBed.tick();
    expect(root.getAttribute('dir')).toBe('ltr');
    expect(root.lang).toBe('en');
    expect(direction.value).toBe('ltr');
  });
});
