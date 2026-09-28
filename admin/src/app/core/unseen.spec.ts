import { describe, expect, it } from 'vitest';

import { formatBadge } from './unseen';

describe('formatBadge', () => {
  it('hides empty counts', () => {
    for (const count of [0, -1, null, undefined, Number.NaN]) expect(formatBadge(count)).toBeNull();
  });

  it('caps large counts', () => {
    expect(formatBadge(1)).toBe('1');
    expect(formatBadge(99)).toBe('99');
    expect(formatBadge(100)).toBe('99+');
    expect(formatBadge(12, 9)).toBe('9+');
  });
});
