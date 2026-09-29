import { inject } from '@angular/core';
import { CanMatchFn, Router } from '@angular/router';

import { Auth } from './auth';
import { Features } from './features';

/** What a page needs: a permission, and optionally an enabled feature. */
export interface PageAccess {
  permission?: string;
  feature?: string;
}

/**
 * Whether an admin may open a page, by the same rules as the sidebar that links to it:
 * `can` answers permissions, `enabled` features.
 */
export function pageAllowed(
  access: PageAccess,
  can: (permission: string) => boolean,
  enabled: (feature: string) => boolean,
): boolean {
  if (access.permission && !can(access.permission)) return false;
  if (access.feature && !enabled(access.feature)) return false;
  return true;
}

/**
 * Route guard for pages behind a permission or an optional feature: without them the
 * admin lands on the home page instead of a page that cannot load. Signed-out admins and
 * those who must first set up a second factor pass: `authGuard` redirects them.
 */
export function requireAccess(access: PageAccess): CanMatchFn {
  return async () => {
    const auth = inject(Auth);
    const features = inject(Features);
    const router = inject(Router);
    await auth.restore();
    if (!auth.loggedIn() || auth.twoFactorPending()) return true;
    if (access.feature) await features.ensure();
    return pageAllowed(
      access,
      (permission) => auth.can(permission),
      (id) => features.enabled(id),
    )
      ? true
      : router.createUrlTree(['/']);
  };
}
