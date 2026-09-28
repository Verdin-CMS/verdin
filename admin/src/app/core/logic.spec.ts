import { describe, expect, it } from 'vitest';

import { conditionsOf, simpleCondition, visible } from './logic';

describe('conditional fields (JSON Logic)', () => {
  const data = { kind: 'video', views: 12, tags: ['a'], meta: { live: true } };
  const when = (rule: unknown) => visible({ visible: rule }, data);

  it('evaluates Strapi conditions like the server', () => {
    expect(when({ '==': [{ var: 'kind' }, 'video'] })).toBe(true);
    expect(when({ '==': [{ var: 'kind' }, 'text'] })).toBe(false);
    expect(when({ '!=': [{ var: 'kind' }, 'text'] })).toBe(true);
    expect(when({ '==': [{ var: 'views' }, '12'] })).toBe(true); // loose equality
    expect(when({ '===': [{ var: 'views' }, '12'] })).toBe(false);
    expect(when({ '>': [{ var: 'views' }, 10] })).toBe(true);
    expect(when({ '<=': [1, { var: 'views' }, 20] })).toBe(true); // between
    expect(when({ and: [{ var: 'meta.live' }, { in: ['a', { var: 'tags' }] }] })).toBe(true);
    expect(when({ or: [{ '!': { var: 'meta.live' } }, { var: 'missing' }] })).toBe(false);
    expect(when({ in: ['vid', { var: 'kind' }] })).toBe(true);
    expect(when({ '!!': { var: 'tags' } })).toBe(true);
    expect(when({ 'unknown-op': [1] })).toBe(true); // unknown operators never hide
    expect(visible(null, data)).toBe(true);
    expect(visible({}, data)).toBe(true);
  });

  it('covers the rest of the subset', () => {
    expect(when({ '==': [{ var: 'missing' }, null] })).toBe(true);
    expect(when({ '==': [{ var: ['missing', 'video'] }, { var: 'kind' }] })).toBe(true);
    expect(when({ '!==': [{ var: 'views' }, 12] })).toBe(false);
    expect(when({ '<': [1, { var: 'views' }, 5] })).toBe(false);
    expect(when({ '>=': [{ var: 'views' }] })).toBe(false);
    expect(when({ if: [{ var: 'meta.live' }, true, false] })).toBe(true);
    expect(when({ if: [false, true, { var: 'missing' }] })).toBe(false);
    expect(when({ var: 'tags.0' })).toBe(true);
    expect(when({ '==': [{ var: 'meta.live' }, 'true'] })).toBe(false);
    expect(when({ '==': [{ var: 'meta.live' }, 1] })).toBe(true);
    expect(visible({ visible: { var: '' } }, {})).toBe(true); // an object is truthy
    expect(visible({ visible: { var: 'flag' } }, { flag: '' })).toBe(false);
  });

  it('reads and writes the builder’s simple rules', () => {
    expect(simpleCondition({ visible: { '==': [{ var: 'kind' }, 'video'] } })).toEqual({
      field: 'kind',
      operator: '==',
      value: 'video',
    });
    expect(simpleCondition({ visible: { '!=': [{ var: 'on' }, true] } })?.value).toBe(true);
    expect(simpleCondition({ visible: { and: [] } })).toBeNull();
    expect(simpleCondition({ visible: { '==': [{ var: 'a' }, { var: 'b' }] } })).toBeNull();
    expect(simpleCondition(undefined)).toBeNull();
    expect(conditionsOf({ field: 'kind', operator: '!=', value: 'text' })).toEqual({
      visible: { '!=': [{ var: 'kind' }, 'text'] },
    });
  });
});
