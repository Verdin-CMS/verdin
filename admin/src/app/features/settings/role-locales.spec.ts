import { describe, expect, it } from 'vitest';

import { Permission } from '../../core/types';
import { inheritedLocales, setSubjectLocales, subjectLocales } from './role-locales';

const UID = 'api::article.article';

describe('role locale restrictions', () => {
  it('reads the restriction of a subject', () => {
    expect(subjectLocales([], UID)).toEqual({ kind: 'all' });
    const all: Permission[] = [{ action: 'content.read', subject: UID }];
    expect(subjectLocales(all, UID)).toEqual({ kind: 'all' });
    const french: Permission[] = [
      { action: 'content.read', subject: UID, locales: ['fr'] },
      { action: 'content.update', subject: UID, locales: ['fr'] },
      { action: 'content.read', subject: 'api::page.page', locales: ['en'] },
    ];
    expect(subjectLocales(french, UID)).toEqual({ kind: 'some', locales: ['fr'] });
    expect(subjectLocales([...french, { action: 'content.delete', subject: UID }], UID).kind).toBe(
      'mixed',
    );
    expect(
      subjectLocales(
        [
          { action: 'content.read', subject: UID, locales: ['fr', 'en'] },
          { action: 'content.update', subject: UID, locales: ['en', 'fr'] },
        ],
        UID,
      ).kind,
    ).toBe('some');
  });

  it('sets and clears the locales of every content permission of a subject', () => {
    const permissions: Permission[] = [
      { action: 'content.read', subject: UID, fields: ['title'] },
      { action: 'content.update', subject: UID, conditions: ['is-creator'] },
      { action: 'content.read', subject: 'api::page.page' },
      { action: 'users.manage' },
    ];
    const french = setSubjectLocales(permissions, UID, ['fr']);
    expect(french[0]).toEqual({
      action: 'content.read',
      subject: UID,
      fields: ['title'],
      locales: ['fr'],
    });
    expect(french[1].locales).toEqual(['fr']);
    expect(french[2]).toEqual(permissions[2]);
    expect(french[3]).toEqual(permissions[3]);
    expect(setSubjectLocales(french, UID, null)).toEqual(permissions);
  });

  it('gives new permissions the locales of their siblings', () => {
    const permissions: Permission[] = [{ action: 'content.read', subject: UID, locales: ['fr'] }];
    expect(inheritedLocales(permissions, UID)).toEqual(['fr']);
    expect(inheritedLocales(permissions, 'api::page.page')).toBeUndefined();
  });
});
