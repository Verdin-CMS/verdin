import { describe, expect, it } from 'vitest';

import {
  accentForeground,
  accentVariables,
  contrastRatio,
  mergeTranslations,
  readBranding,
} from './branding';

describe('branding', () => {
  it('picks black or white text, whichever contrasts more with the accent', () => {
    expect(accentForeground('#ffffff')).toBe('#000000');
    expect(accentForeground('#000000')).toBe('#ffffff');
    expect(accentForeground('#ffcc00')).toBe('#000000');
    expect(accentForeground('#1d4ed8')).toBe('#ffffff');
    expect(accentForeground('#ff6600')).toBe('#000000');
    expect(accentForeground('#7c3aed')).toBe('#ffffff');
  });

  it('computes WCAG contrast ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#777777')).toBe(1);
  });

  it('sets the primary and ring variables', () => {
    const variables = accentVariables('#1d4ed8');
    expect(variables['--primary']).toBe('#1d4ed8');
    expect(variables['--primary-foreground']).toBe('#ffffff');
    expect(variables['--sidebar-primary']).toBe('#1d4ed8');
    expect(variables['--ring']).toContain('#1d4ed8');
  });

  it('reads the config, dropping what is malformed', () => {
    expect(readBranding(undefined)).toEqual({
      title: null,
      accent: null,
      logoUrl: null,
      faviconUrl: null,
      translations: {},
    });
    const branding = readBranding({
      title: ' Acme CMS ',
      accent: '#FF6600',
      logoUrl: '/admin/_branding/logo',
      faviconUrl: null,
      translations: { es: { 'auth.login.title': 'Hola', bad: 3 }, fr: 'nope' },
    });
    expect(branding.title).toBe('Acme CMS');
    expect(branding.accent).toBe('#ff6600');
    expect(branding.logoUrl).toBe('/admin/_branding/logo');
    expect(branding.translations).toEqual({ es: { 'auth.login.title': 'Hola' } });
    expect(readBranding({ accent: 'red' }).accent).toBeNull();
  });

  it('merges text overrides into the catalog of their language only', () => {
    const catalog = { 'auth.login.title': 'Welcome back', 'common.save': 'Save' };
    const overrides = { en: { 'auth.login.title': 'Welcome to Acme' }, es: { 'x.y': 'z' } };
    expect(mergeTranslations(catalog, overrides, 'en')).toEqual({
      'auth.login.title': 'Welcome to Acme',
      'common.save': 'Save',
    });
    expect(mergeTranslations(catalog, overrides, 'fr')).toBe(catalog);
    expect(mergeTranslations(catalog, {}, 'en')).toBe(catalog);
  });
});
