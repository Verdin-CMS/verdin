import { describe, expect, it } from 'vitest';

import { Attribute } from '../../core/types';
import {
  SchemaFiles,
  compatibleOwnerFields,
  morphIssue,
  morphOwnerOptions,
  suggestedOwnerField,
  typeKey,
  withRelationKind,
} from './morph-options';

const types: SchemaFiles = {
  note: {
    displayName: 'Note',
    attributes: {
      text: { type: 'string' },
      about: { type: 'relation', relation: 'morphToOne' },
      refs: { type: 'relation', relation: 'morphToMany' },
      tags: { type: 'relation', relation: 'manyToMany', target: 'api::tag' },
    },
  },
  comment: {
    displayName: 'Comment',
    attributes: { on: { type: 'relation', relation: 'morphToMany' } },
  },
  tag: { displayName: 'Tag', attributes: { name: { type: 'string' } } },
};

describe('builder: polymorphic relations', () => {
  it('lists owner types and the fields each inverse kind pairs with', () => {
    // Any owner pairs with any inverse side; the matching kind comes first.
    expect(morphOwnerOptions(types, 'morphMany')).toEqual([
      { uid: 'api::comment', label: 'Comment', fields: ['on'] },
      { uid: 'api::note', label: 'Note', fields: ['refs', 'about'] },
    ]);
    expect(morphOwnerOptions(types, 'morphOne')).toEqual([
      { uid: 'api::comment', label: 'Comment', fields: ['on'] },
      { uid: 'api::note', label: 'Note', fields: ['about', 'refs'] },
    ]);
    expect(compatibleOwnerFields(types['tag'], 'morphMany')).toEqual([]);
    expect(suggestedOwnerField(types['note'], 'morphMany')).toBe('refs');
    expect(suggestedOwnerField(types['note'], 'morphOne')).toBe('about');
    expect(suggestedOwnerField(types['comment'], 'morphOne')).toBe('on');
    expect(compatibleOwnerFields(undefined, 'morphOne')).toEqual([]);
    expect(typeKey('api::note.note')).toBe('note');
    expect(typeKey('api::note')).toBe('note');
  });

  it('keeps only what each relation kind takes', () => {
    const plain: Attribute = {
      type: 'relation',
      relation: 'manyToOne',
      target: 'api::tag',
      inversedBy: 'notes',
      required: true,
    };
    // Owners link any type.
    expect(withRelationKind(plain, 'morphToMany')).toEqual({
      type: 'relation',
      relation: 'morphToMany',
      required: true,
    });
    // Inverse sides choose their owner afresh.
    expect(withRelationKind(plain, 'morphMany')).toEqual({
      type: 'relation',
      relation: 'morphMany',
      required: true,
    });
    const inverse: Attribute = {
      type: 'relation',
      relation: 'morphOne',
      target: 'api::note',
      morphBy: 'about',
    };
    // Between inverse kinds the owner and its field stay (any owner kind pairs).
    expect(withRelationKind(inverse, 'morphMany')).toEqual({ ...inverse, relation: 'morphMany' });
    expect(withRelationKind(inverse, 'morphOne')).toEqual(inverse);
    // Back to a plain relation: a target is to be chosen.
    expect(withRelationKind(inverse, 'oneWay')).toEqual({
      type: 'relation',
      relation: 'oneWay',
      target: '',
    });
    expect(withRelationKind(plain, 'oneToMany')).toEqual({ ...plain, relation: 'oneToMany' });
  });

  it('checks inverse sides against their owner as the server does', () => {
    const inverse = (relation: 'morphOne' | 'morphMany', target?: string, morphBy?: string) =>
      ({ type: 'relation', relation, target, morphBy }) as Attribute;
    expect(morphIssue(inverse('morphMany', 'api::note', 'refs'), types, false)).toBeNull();
    expect(morphIssue(inverse('morphOne', 'api::note.note', 'about'), types, false)).toBeNull();
    expect(morphIssue(inverse('morphMany'), types, false)).toBe('builder.morph.issue.target');
    expect(morphIssue(inverse('morphMany', 'api::nope', 'refs'), types, false)).toBe(
      'builder.morph.issue.unknownTarget',
    );
    expect(morphIssue(inverse('morphMany', 'api::note'), types, false)).toBe(
      'builder.morph.issue.morphBy',
    );
    expect(morphIssue(inverse('morphMany', 'api::note', 'text'), types, false)).toBe(
      'builder.morph.issue.notOwner',
    );
    expect(morphIssue(inverse('morphMany', 'api::note', 'tags'), types, false)).toBe(
      'builder.morph.issue.notOwner',
    );
    // Kinds need not match (a morphMany over morphToOne owners is Strapi's comments).
    expect(morphIssue(inverse('morphOne', 'api::note', 'refs'), types, false)).toBeNull();
    expect(morphIssue(inverse('morphMany', 'api::note', 'about'), types, false)).toBeNull();
  });

  it('accepts owners anywhere but in components, and ignores other attributes', () => {
    const owner: Attribute = { type: 'relation', relation: 'morphToOne' };
    expect(morphIssue(owner, types, false)).toBeNull();
    expect(morphIssue(owner, types, true)).toBe('builder.morph.issue.component');
    expect(
      morphIssue({ type: 'relation', relation: 'oneWay', target: '' }, types, true),
    ).toBeNull();
    expect(morphIssue({ type: 'string' }, types, false)).toBeNull();
  });
});
