import { matchLocale } from './locales';
import { firstDayOfWeek } from './week';

describe('matchLocale', () => {
  it('matches exact tags, languages and scripts', () => {
    expect(matchLocale(['es-MX', 'en'])).toBe('es');
    expect(matchLocale(['pt-PT'])).toBe('pt-BR');
    expect(matchLocale(['zh-CN'])).toBe('zh-Hans');
    expect(matchLocale(['zh-TW', 'fr'])).toBe('fr');
    expect(matchLocale(['ca-ES'])).toBe('ca');
    expect(matchLocale(['sw', 'xx-invalid-tag-'])).toBe('en');
  });
});

describe('firstDayOfWeek', () => {
  it('follows the region', () => {
    expect(firstDayOfWeek('en-US')).toBe(0);
    expect(firstDayOfWeek('en-GB')).toBe(1);
    expect(firstDayOfWeek('es')).toBe(1);
    expect(firstDayOfWeek('es-MX')).toBe(0);
    expect(firstDayOfWeek('ja')).toBe(0);
    expect(firstDayOfWeek('de-DE')).toBe(1);
  });
});
