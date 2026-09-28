import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';

import { RUNTIME_CONFIG } from './api';

/** Message overrides per interface language: `{ es: { 'auth.login.title': '…' } }`. */
export type TranslationOverrides = Record<string, Record<string, string>>;

/** The admin panel's branding (`[admin.branding]`, in the `verdin-config` meta). */
export interface Branding {
  title: string | null;
  /** `#rrggbb`. */
  accent: string | null;
  logoUrl: string | null;
  faviconUrl: string | null;
  translations: TranslationOverrides;
}

export const DEFAULT_TITLE = 'Verdin';

const HEX = /^#([0-9a-f]{6})$/i;

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** The branding from the runtime config, with every part checked (anything else is dropped). */
export function readBranding(raw: unknown): Branding {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const accent = text(source['accent']);
  const translations: TranslationOverrides = {};
  const rawTranslations = source['translations'];
  if (rawTranslations && typeof rawTranslations === 'object' && !Array.isArray(rawTranslations)) {
    for (const [lang, messages] of Object.entries(rawTranslations)) {
      if (!messages || typeof messages !== 'object' || Array.isArray(messages)) continue;
      const entries = Object.entries(messages).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      );
      if (entries.length) translations[lang] = Object.fromEntries(entries);
    }
  }
  return {
    title: text(source['title']),
    accent: accent && HEX.test(accent) ? accent.toLowerCase() : null,
    logoUrl: text(source['logoUrl']),
    faviconUrl: text(source['faviconUrl']),
    translations,
  };
}

/** WCAG relative luminance of a `#rrggbb` color. */
export function luminance(hex: string): number {
  const match = HEX.exec(hex);
  if (!match) return 0;
  const value = parseInt(match[1], 16);
  const channel = (shift: number) => {
    const c = ((value >> shift) & 0xff) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
}

/** WCAG contrast ratio between two `#rrggbb` colors (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** The readable text color on `accent`: black or white, whichever contrasts more. */
export function accentForeground(accent: string): '#000000' | '#ffffff' {
  return contrastRatio(accent, '#000000') >= contrastRatio(accent, '#ffffff')
    ? '#000000'
    : '#ffffff';
}

/**
 * The CSS variables the accent sets (the same for the light and dark themes: an inline
 * style on the root wins over both).
 */
export function accentVariables(accent: string): Record<string, string> {
  const foreground = accentForeground(accent);
  const ring = `color-mix(in oklab, ${accent} 60%, transparent)`;
  return {
    '--primary': accent,
    '--primary-foreground': foreground,
    '--ring': ring,
    '--sidebar-primary': accent,
    '--sidebar-primary-foreground': foreground,
    '--sidebar-ring': ring,
  };
}

/**
 * A catalog with the branding's overrides for `lang` applied: an override wins, every
 * other key keeps the catalog's message (itself backed by the English fallback).
 */
export function mergeTranslations<T extends Record<string, unknown>>(
  catalog: T,
  overrides: TranslationOverrides,
  lang: string,
): T {
  const own = overrides[lang];
  if (!own || !Object.keys(own).length) return catalog;
  return { ...catalog, ...own };
}

/** Applies the branding: the accent color and the document title. */
@Injectable({ providedIn: 'root' })
export class BrandingService {
  private readonly document = inject(DOCUMENT);
  readonly value: Branding = readBranding(inject(RUNTIME_CONFIG).branding);
  readonly title = this.value.title ?? DEFAULT_TITLE;

  apply(): void {
    this.document.title = this.title;
    const accent = this.value.accent;
    if (!accent) return;
    const style = this.document.documentElement.style;
    for (const [name, value] of Object.entries(accentVariables(accent))) {
      style.setProperty(name, value);
    }
  }
}
