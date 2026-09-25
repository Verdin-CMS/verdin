import { describe, expect, it } from 'vitest';

import { Attribute } from '../../core/types';
import {
  attributeLocalized,
  setAttributeLocalized,
  setTypeLocalized,
  typeLocalized,
} from './i18n-options';

describe('builder i18n options', () => {
  it('turns a type localized on and off, keeping other plugin options', () => {
    const file = { displayName: 'Article', attributes: {}, pluginOptions: { seo: { on: true } } };
    const on = setTypeLocalized(file, true);
    expect(on.pluginOptions).toEqual({ seo: { on: true }, i18n: { localized: true } });
    expect(typeLocalized(on)).toBe(true);
    const off = setTypeLocalized(on, false);
    expect(off).toEqual(file);
    expect(typeLocalized(off)).toBe(false);
  });

  it('omits pluginOptions when nothing is left', () => {
    const file = { displayName: 'Article', attributes: {} };
    const round = setTypeLocalized(setTypeLocalized(file, true), false);
    expect(round).toEqual(file);
    expect('pluginOptions' in round).toBe(false);
  });

  it('marks shared attributes with localized: false only', () => {
    const attribute: Attribute = { type: 'string', required: true };
    expect(attributeLocalized(attribute)).toBe(true);
    const shared = setAttributeLocalized(attribute, false);
    expect(shared).toEqual({
      type: 'string',
      required: true,
      pluginOptions: { i18n: { localized: false } },
    });
    expect(attributeLocalized(shared)).toBe(false);
    const localized = setAttributeLocalized(shared, true);
    expect(localized).toEqual(attribute);
    expect('pluginOptions' in localized).toBe(false);
  });

  it('round-trips through JSON', () => {
    const relation: Attribute = { type: 'relation', relation: 'oneWay', target: 'api::tag' };
    const shared = JSON.parse(JSON.stringify(setAttributeLocalized(relation, false))) as Attribute;
    expect(attributeLocalized(shared)).toBe(false);
    expect(JSON.parse(JSON.stringify(setAttributeLocalized(shared, true)))).toEqual(relation);
  });
});
