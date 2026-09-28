import { describe, expect, it } from 'vitest';

import { AttributeType } from '../../core/types';
import { offeredTypes } from './type-options';

const TYPES: { type: AttributeType }[] = [
  { type: 'string' },
  { type: 'password' },
  { type: 'email' },
];

describe('builder type options', () => {
  it('offers every type on content types', () => {
    expect(offeredTypes(TYPES, false).map((info) => info.type)).toEqual([
      'string',
      'password',
      'email',
    ]);
  });

  it('leaves password out of components', () => {
    expect(offeredTypes(TYPES, true).map((info) => info.type)).toEqual(['string', 'email']);
  });

  it('keeps the current type of an existing field listed', () => {
    expect(offeredTypes(TYPES, true, 'password').map((info) => info.type)).toContain('password');
  });
});
