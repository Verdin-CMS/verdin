import { PermissionSet } from './types';

/**
 * Whether `set` grants a content `action` on `uid` in `locale` (`null`: whatever the
 * locale). A permission without `locales` covers every locale, as on the server.
 */
export function grantsInLocale(
  set: PermissionSet,
  action: string,
  uid: string,
  locale: string | null | undefined,
): boolean {
  if (set.superAdmin) return true;
  return set.permissions.some(
    (permission) =>
      permission.action === action &&
      (permission.subject === '*' || permission.subject === uid) &&
      (!locale || !permission.locales || permission.locales.includes(locale)),
  );
}

/** The codes among `codes` in which `set` grants `action` on `uid`, in their order. */
export function grantedLocales(
  set: PermissionSet,
  action: string,
  uid: string,
  codes: readonly string[],
): string[] {
  return codes.filter((code) => grantsInLocale(set, action, uid, code));
}

/**
 * The locale to open `uid` in: `preferred` when `action` is granted there, else the
 * first granted one of `codes`, else `preferred` (the server answers 403).
 */
export function allowedLocale(
  set: PermissionSet,
  action: string,
  uid: string,
  codes: readonly string[],
  preferred: string | null,
): string | null {
  if (preferred && grantsInLocale(set, action, uid, preferred)) return preferred;
  return grantedLocales(set, action, uid, codes)[0] ?? preferred;
}
