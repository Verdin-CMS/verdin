import { describe, expect, it } from 'vitest';

import {
  FieldDraft,
  cellText,
  emailList,
  fieldName,
  fieldProblems,
  formInput,
  formProblems,
  fromDraft,
  invalidEmails,
  newField,
  reorder,
  submissionSnippet,
  toDraft,
  validFieldName,
} from './form-builder';

function draft(change: Partial<FieldDraft>): FieldDraft {
  return { ...newField([]), label: 'Label', ...change };
}

describe('field names', () => {
  it('derives camelCase names from labels', () => {
    expect(fieldName('Your email')).toBe('yourEmail');
    expect(fieldName('Teléfono móvil')).toBe('telefonoMovil');
    expect(fieldName('2nd choice')).toBe('ndChoice');
    expect(fieldName('!!!')).toBe('');
  });

  it('accepts what the server accepts', () => {
    expect(validFieldName('email')).toBe(true);
    expect(validFieldName('first_name2')).toBe(true);
    expect(validFieldName('2name')).toBe(false);
    expect(validFieldName('with-dash')).toBe(false);
    expect(validFieldName('a'.repeat(65))).toBe(false);
  });

  it('numbers new fields after the existing ones', () => {
    const first = newField([]);
    expect(first.name).toBe('field1');
    expect(newField([first, { ...first, name: 'field2' }]).name).toBe('field3');
  });
});

describe('fieldProblems', () => {
  it('reports invalid, reserved and duplicate names, and missing labels', () => {
    const fields = [
      draft({ key: 'a', name: 'email' }),
      draft({ key: 'b', name: 'email' }),
      draft({ key: 'c', name: '_gotcha' }),
      draft({ key: 'd', name: '1x', label: ' ' }),
      draft({ key: 'e', name: 'ok' }),
    ];
    const problems = fieldProblems(fields);
    expect(problems.get('a')).toEqual(['nameDuplicate']);
    expect(problems.get('b')).toEqual(['nameDuplicate']);
    expect(problems.get('c')).toEqual(['nameReserved']);
    expect(problems.get('d')).toEqual(['name', 'label']);
    expect(problems.has('e')).toBe(false);
  });

  it('wants options for selects and sensible maximum lengths', () => {
    const problems = fieldProblems([
      draft({ key: 's', name: 's', type: 'select', options: ' \n ' }),
      draft({ key: 't', name: 't', type: 'text', maxLength: '0' }),
      draft({ key: 'u', name: 'u', type: 'text', maxLength: '1.5' }),
      draft({ key: 'n', name: 'n', type: 'number', maxLength: 'x' }),
    ]);
    expect(problems.get('s')).toEqual(['options']);
    expect(problems.get('t')).toEqual(['maxLength']);
    expect(problems.get('u')).toEqual(['maxLength']);
    // Numbers take no maximum length: the stale value is ignored.
    expect(problems.has('n')).toBe(false);
  });
});

describe('drafts', () => {
  it('keep only the options of their type', () => {
    expect(
      fromDraft(
        draft({
          name: 'topic',
          type: 'select',
          options: 'Sales\n Support \n\n',
          maxLength: '10',
          placeholder: 'x',
        }),
      ),
    ).toEqual({
      name: 'topic',
      label: 'Label',
      type: 'select',
      required: false,
      options: ['Sales', 'Support'],
    });
    expect(
      fromDraft(draft({ name: 'msg', type: 'textarea', maxLength: '500', placeholder: ' Hi ' })),
    ).toEqual({
      name: 'msg',
      label: 'Label',
      type: 'textarea',
      required: false,
      maxLength: 500,
      placeholder: 'Hi',
    });
  });

  it('round-trip stored fields', () => {
    const field = {
      name: 'email',
      label: 'Email',
      type: 'email' as const,
      required: true,
      maxLength: 120,
      placeholder: 'you@example.com',
    };
    expect(fromDraft(toDraft(field))).toEqual(field);
  });
});

describe('forms', () => {
  it('reports form-level problems', () => {
    expect(formProblems('Contact', 'contact', [draft({})], 'a@b.co')).toEqual([]);
    expect(formProblems(' ', 'Contact Us', [], 'nope')).toEqual([
      'name',
      'slug',
      'noFields',
      'emails',
    ]);
  });

  it('splits and checks notification emails', () => {
    expect(emailList('a@b.co, c@d.io\ne@f.es;')).toEqual(['a@b.co', 'c@d.io', 'e@f.es']);
    expect(invalidEmails(['a@b.co', 'nope', '@x'])).toEqual(['nope', '@x']);
  });

  it('builds the request body', () => {
    const input = formInput(' Contact ', 'contact', [draft({ name: 'email', type: 'email' })], {
      notifyEmails: 'a@b.co',
      successMessage: '  ',
      honeypot: true,
    });
    expect(input).toEqual({
      name: 'Contact',
      slug: 'contact',
      fields: [{ name: 'email', label: 'Label', type: 'email', required: false }],
      settings: { notifyEmails: ['a@b.co'], successMessage: null, honeypot: true },
    });
  });

  it('reorders, formats cells and writes a snippet', () => {
    expect(reorder(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(reorder(['a', 'b'], 0, 5)).toEqual(['a', 'b']);
    expect(cellText(true)).toBe('true');
    expect(cellText(null)).toBe('');
    expect(cellText({ a: 1 })).toBe('{"a":1}');
    const snippet = submissionSnippet('https://cms.example.com/api/_forms/contact', [
      { name: 'email', label: 'Email', type: 'email', required: true },
    ]);
    expect(snippet).toContain("fetch('https://cms.example.com/api/_forms/contact'");
    expect(snippet).toContain('"email": "ada@example.com"');
  });
});
