import { describe, expect, it } from 'vitest';

import { pageAllowed } from './access';

describe('page access', () => {
  const can = (held: string[]) => (permission: string) => held.includes(permission);
  const enabled = (on: string[]) => (feature: string) => on.includes(feature);

  it('needs the permission', () => {
    expect(pageAllowed({ permission: 'users.manage' }, can(['users.manage']), enabled([]))).toBe(
      true,
    );
    expect(pageAllowed({ permission: 'users.manage' }, can([]), enabled([]))).toBe(false);
  });

  it('needs the feature as well, when there is one', () => {
    const access = { permission: 'site.manage', feature: 'menus' };
    expect(pageAllowed(access, can(['site.manage']), enabled(['menus']))).toBe(true);
    expect(pageAllowed(access, can(['site.manage']), enabled([]))).toBe(false);
    expect(pageAllowed(access, can([]), enabled(['menus']))).toBe(false);
  });

  it('lets pages without requirements through', () => {
    expect(pageAllowed({}, can([]), enabled([]))).toBe(true);
  });
});
