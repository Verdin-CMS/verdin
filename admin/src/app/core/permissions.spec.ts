import { describe, expect, it } from 'vitest';

import { allowedLocale, grantedLocales, grantsInLocale } from './permissions';
import { PermissionSet } from './types';

const UID = 'api::article.article';
const french: PermissionSet = {
  superAdmin: false,
  permissions: [
    { action: 'content.read', subject: UID, locales: ['fr'] },
    { action: 'content.update', subject: UID, locales: ['fr'] },
    { action: 'content.read', subject: 'api::page.page' },
  ],
};

describe('locale permissions', () => {
  it('limits a permission to its locales', () => {
    expect(grantsInLocale(french, 'content.read', UID, 'fr')).toBe(true);
    expect(grantsInLocale(french, 'content.read', UID, 'en')).toBe(false);
    expect(grantsInLocale(french, 'content.create', UID, 'fr')).toBe(false);
  });

  it('treats a permission without locales as covering all of them', () => {
    expect(grantsInLocale(french, 'content.read', 'api::page.page', 'en')).toBe(true);
    expect(grantsInLocale(french, 'content.read', UID, null)).toBe(true);
  });

  it('grants everything to super admins and follows `*` subjects', () => {
    expect(grantsInLocale({ superAdmin: true, permissions: [] }, 'content.delete', UID, 'en')).toBe(
      true,
    );
    const wildcard: PermissionSet = {
      superAdmin: false,
      permissions: [{ action: 'content.read', subject: '*', locales: ['en'] }],
    };
    expect(grantsInLocale(wildcard, 'content.read', UID, 'en')).toBe(true);
    expect(grantsInLocale(wildcard, 'content.read', UID, 'fr')).toBe(false);
  });

  it('lists the granted locales and picks one', () => {
    expect(grantedLocales(french, 'content.read', UID, ['en', 'fr', 'de'])).toEqual(['fr']);
    expect(allowedLocale(french, 'content.read', UID, ['en', 'fr'], 'en')).toBe('fr');
    expect(allowedLocale(french, 'content.read', UID, ['en', 'fr'], 'fr')).toBe('fr');
    expect(allowedLocale(french, 'content.delete', UID, ['en', 'fr'], 'en')).toBe('en');
  });
});
