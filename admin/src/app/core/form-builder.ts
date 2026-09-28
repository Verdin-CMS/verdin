import {
  FORM_FIELD_TYPES,
  FormField,
  FormFieldType,
  FormInput,
  FormSettings,
  validSlug,
} from './site';

/** The server's limit (`site.rs`). */
export const MAX_FORM_FIELDS = 50;

/** Types that hold free text (they take a placeholder and a maximum length). */
export const TEXT_TYPES: readonly FormFieldType[] = ['text', 'email', 'textarea', 'url', 'tel'];

/** A field in the builder: `key` identifies it while it moves (never saved). */
export interface FieldDraft {
  key: string;
  name: string;
  /** The name follows the label until it is edited. */
  nameTouched: boolean;
  label: string;
  type: FormFieldType;
  required: boolean;
  /** Select options, one per line. */
  options: string;
  maxLength: string;
  placeholder: string;
}

export type FieldProblem =
  'name' | 'nameReserved' | 'nameDuplicate' | 'label' | 'options' | 'maxLength';

let counter = 0;
export function fieldKey(): string {
  counter += 1;
  return `f${counter}`;
}

/** A field name from a label: `Your email` → `yourEmail` (letters, digits and `_`). */
export function fieldName(label: string): string {
  const words = label
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  const name = words
    .map((word, index) =>
      index === 0 ? word.toLowerCase() : word[0].toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join('')
    .replace(/^[0-9]+/, '')
    .slice(0, 64);
  return name;
}

/** Names the server accepts: a letter, then letters, digits or `_` (up to 64). */
export function validFieldName(name: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name);
}

export function newField(
  existing: readonly FieldDraft[],
  type: FormFieldType = 'text',
): FieldDraft {
  const used = new Set(existing.map((field) => field.name));
  let index = existing.length + 1;
  while (used.has(`field${index}`)) index++;
  return {
    key: fieldKey(),
    name: `field${index}`,
    nameTouched: false,
    label: '',
    type,
    required: false,
    options: '',
    maxLength: '',
    placeholder: '',
  };
}

export function toDraft(field: FormField): FieldDraft {
  return {
    key: fieldKey(),
    name: field.name,
    nameTouched: true,
    label: field.label,
    type: FORM_FIELD_TYPES.includes(field.type) ? field.type : 'text',
    required: field.required,
    options: (field.options ?? []).join('\n'),
    maxLength: field.maxLength !== undefined ? String(field.maxLength) : '',
    placeholder: field.placeholder ?? '',
  };
}

export function optionList(text: string): string[] {
  return text
    .split('\n')
    .map((option) => option.trim())
    .filter(Boolean);
}

/** A draft as the server stores it: only the options that apply to its type. */
export function fromDraft(draft: FieldDraft): FormField {
  const field: FormField = {
    name: draft.name.trim(),
    label: draft.label.trim(),
    type: draft.type,
    required: draft.required,
  };
  if (draft.type === 'select') field.options = optionList(draft.options);
  if (TEXT_TYPES.includes(draft.type)) {
    if (draft.maxLength.trim()) field.maxLength = Number(draft.maxLength);
    if (draft.placeholder.trim()) field.placeholder = draft.placeholder.trim();
  }
  return field;
}

/** The problems of each field, by key (fields without problems are left out). */
export function fieldProblems(drafts: readonly FieldDraft[]): Map<string, FieldProblem[]> {
  const problems = new Map<string, FieldProblem[]>();
  const counts = new Map<string, number>();
  for (const draft of drafts) {
    const name = draft.name.trim();
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  for (const draft of drafts) {
    const found: FieldProblem[] = [];
    const name = draft.name.trim();
    if (name === '_gotcha') found.push('nameReserved');
    else if (!validFieldName(name)) found.push('name');
    else if ((counts.get(name) ?? 0) > 1) found.push('nameDuplicate');
    if (!draft.label.trim()) found.push('label');
    if (draft.type === 'select' && !optionList(draft.options).length) found.push('options');
    if (TEXT_TYPES.includes(draft.type) && draft.maxLength.trim()) {
      const max = Number(draft.maxLength);
      if (!Number.isInteger(max) || max < 1 || max > 20000) found.push('maxLength');
    }
    if (found.length) problems.set(draft.key, found);
  }
  return problems;
}

/** Email addresses from a list separated by commas, spaces or new lines. */
export function emailList(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((email) => email.trim())
    .filter(Boolean);
}

/** The addresses the server refuses (it only wants an `@`; this is a little stricter). */
export function invalidEmails(emails: readonly string[]): string[] {
  return emails.filter((email) => !/^[^\s@]+@[^\s@]+$/.test(email));
}

export type FormProblem = 'name' | 'slug' | 'noFields' | 'tooManyFields' | 'emails';

export function formProblems(
  name: string,
  slug: string,
  drafts: readonly FieldDraft[],
  notifyEmails: string,
): FormProblem[] {
  const problems: FormProblem[] = [];
  if (!name.trim() || [...name.trim()].length > 255) problems.push('name');
  if (!validSlug(slug)) problems.push('slug');
  if (!drafts.length) problems.push('noFields');
  if (drafts.length > MAX_FORM_FIELDS) problems.push('tooManyFields');
  if (invalidEmails(emailList(notifyEmails)).length) problems.push('emails');
  return problems;
}

export function formInput(
  name: string,
  slug: string,
  drafts: readonly FieldDraft[],
  settings: { notifyEmails: string; successMessage: string; honeypot: boolean },
): FormInput {
  const formSettings: FormSettings = {
    notifyEmails: emailList(settings.notifyEmails),
    successMessage: settings.successMessage.trim() || null,
    honeypot: settings.honeypot,
  };
  return { name: name.trim(), slug, fields: drafts.map(fromDraft), settings: formSettings };
}

/** Moves the item at `from` to `to` (a copy). */
export function reorder<T>(list: readonly T[], from: number, to: number): T[] {
  const copy = [...list];
  if (from < 0 || from >= copy.length || to < 0 || to >= copy.length) return copy;
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

/** A submission value as text for the table. */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/** An example request for the public endpoint. */
export function submissionSnippet(endpoint: string, fields: readonly FormField[]): string {
  const example: Record<string, unknown> = {};
  for (const field of fields) {
    example[field.name] =
      field.type === 'number'
        ? 1
        : field.type === 'checkbox'
          ? true
          : field.type === 'email'
            ? 'ada@example.com'
            : field.type === 'select'
              ? (field.options?.[0] ?? '')
              : field.type === 'date'
                ? '2026-01-31'
                : field.type === 'url'
                  ? 'https://example.com'
                  : '…';
  }
  return `await fetch('${endpoint}', {\n  method: 'POST',\n  headers: { 'content-type': 'application/json' },\n  body: JSON.stringify(${JSON.stringify(example, null, 2).replace(/\n/g, '\n  ')}),\n});`;
}
