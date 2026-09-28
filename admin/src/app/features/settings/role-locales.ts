import { ADMIN_CONTENT_ACTIONS, Permission } from '../../core/types';

const CONTENT = new Set<string>(ADMIN_CONTENT_ACTIONS);

/** How a role limits the content permissions of one subject to locales. */
export type LocaleRestriction =
  { kind: 'all' } | { kind: 'some'; locales: string[] } | { kind: 'mixed' };

function isContent(permission: Permission, subject: string): boolean {
  return CONTENT.has(permission.action) && permission.subject === subject;
}

/**
 * The locales the content permissions of `subject` cover: all of them (no `locales`), the
 * same list on every permission, or a mix (set per permission, e.g. through the API).
 */
export function subjectLocales(
  permissions: readonly Permission[],
  subject: string,
): LocaleRestriction {
  const lists = permissions
    .filter((permission) => isContent(permission, subject))
    .map((permission) => permission.locales ?? null);
  if (!lists.length || lists.every((list) => list === null)) return { kind: 'all' };
  const key = (list: string[] | null) => (list ? [...list].sort().join(',') : '*');
  const first = lists[0];
  if (first === null || lists.some((list) => key(list) !== key(first))) return { kind: 'mixed' };
  return { kind: 'some', locales: [...first] };
}

/** `permissions` with every content permission of `subject` limited to `locales` (`null`: all). */
export function setSubjectLocales(
  permissions: readonly Permission[],
  subject: string,
  locales: readonly string[] | null,
): Permission[] {
  return permissions.map((permission) => {
    if (!isContent(permission, subject)) return permission;
    const { locales: _previous, ...rest } = permission;
    return locales ? { ...rest, locales: [...locales] } : rest;
  });
}

/** The locales a new content permission of `subject` inherits from its siblings. */
export function inheritedLocales(
  permissions: readonly Permission[],
  subject: string,
): string[] | undefined {
  const restriction = subjectLocales(permissions, subject);
  return restriction.kind === 'some' ? restriction.locales : undefined;
}
