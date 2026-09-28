/** Pure helpers for AI suggestions in the entry editor: translations, SEO and summaries. */
import { SeoSuggestion } from '../../core/ai';
import { isShared } from '../../core/content-locales';
import { Attribute, Attributes, Component } from '../../core/types';
import { ComponentLookup, FormModel, isEditable, toModel } from './fields/model';
import { copyValue } from './locale-model';

/** Attribute types the server translates. */
const TRANSLATED_TYPES = new Set([
  'string',
  'text',
  'richtext',
  'blocks',
  'component',
  'dynamiczone',
]);

/** The attributes a translation may fill: localized, editable, human-readable text. */
export function translatableFields(attributes: Attributes): string[] {
  return Object.entries(attributes)
    .filter(
      ([, attribute]) =>
        TRANSLATED_TYPES.has(attribute.type) &&
        !attribute.private &&
        !isShared(attribute) &&
        isEditable(attribute),
    )
    .map(([name]) => name);
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Whether a translated value has the shape of its attribute (models may answer oddly). */
function fits(attribute: Attribute, value: unknown): boolean {
  switch (attribute.type) {
    case 'string':
    case 'text':
    case 'richtext':
      return typeof value === 'string';
    case 'blocks':
      return Array.isArray(value) && value.every(isObject);
    case 'component':
      return attribute.repeatable
        ? Array.isArray(value) && value.every(isObject)
        : value === null || isObject(value);
    case 'dynamiczone':
      return Array.isArray(value) && value.every(isObject);
    default:
      return false;
  }
}

/** A form value without rendering keys and row ids, for comparisons. */
function comparable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(comparable);
  if (isObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      if (key === '__key' || key === 'id') continue;
      out[key] = comparable(value[key]);
    }
    return out;
  }
  return value;
}

export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(comparable(a)) === JSON.stringify(comparable(b));
}

/**
 * `current` with the translated attributes (as `POST /ai/translate` returns them, in the
 * API's format) merged in, and the names of the attributes that changed. Attributes that
 * are not translatable, have the wrong shape or did not change are left alone (component
 * rows keep their ids then); dynamic zone items of components the zone does not allow are
 * dropped.
 */
export function mergeTranslation(
  attributes: Attributes,
  current: FormModel,
  translated: Record<string, unknown>,
  components: ComponentLookup,
): { model: FormModel; changed: string[] } {
  const allowed = new Set(translatableFields(attributes));
  const model: FormModel = { ...current };
  const changed: string[] = [];
  for (const [name, raw] of Object.entries(translated ?? {})) {
    const attribute = attributes[name];
    if (!attribute || !allowed.has(name) || !fits(attribute, raw)) continue;
    let value = raw;
    if (attribute.type === 'dynamiczone') {
      const zone = new Set(attribute.components ?? []);
      value = (raw as Record<string, unknown>[]).filter(
        (item) =>
          zone.has(String(item['__component'])) && !!components(String(item['__component'])),
      );
    }
    const next = copyValue(
      attribute,
      toModel({ [name]: attribute }, { [name]: value }, components)[name],
      components,
    );
    if (sameValue(current[name], next)) continue;
    model[name] = next;
    changed.push(name);
  }
  return { model, changed };
}

/** A component for SEO metadata: it has `metaTitle` and `metaDescription` text attributes. */
export function isSeoComponent(component: Component | undefined): boolean {
  const text = (attribute: Attribute | undefined) =>
    attribute?.type === 'string' || attribute?.type === 'text';
  return (
    !!component &&
    text(component.attributes['metaTitle']) &&
    text(component.attributes['metaDescription'])
  );
}

/**
 * The item of an SEO component with a suggestion filled in (`keywords` too when the
 * component has such a text or JSON attribute), and the names of the attributes changed.
 */
export function applySeo(
  component: Component,
  item: FormModel,
  suggestion: SeoSuggestion,
): { item: FormModel; changed: string[] } {
  const next: FormModel = { ...item };
  const values: Record<string, unknown> = {
    metaTitle: suggestion.metaTitle,
    metaDescription: suggestion.metaDescription,
  };
  const keywords = component.attributes['keywords'];
  if (keywords && suggestion.keywords?.length) {
    if (keywords.type === 'string' || keywords.type === 'text')
      values['keywords'] = suggestion.keywords.join(', ');
    else if (keywords.type === 'json') values['keywords'] = [...suggestion.keywords];
  }
  const changed: string[] = [];
  for (const [name, value] of Object.entries(values)) {
    if (typeof value === 'string' && !value.trim()) continue;
    if (sameValue(item[name], value)) continue;
    next[name] = value;
    changed.push(name);
  }
  return { item: next, changed };
}

/** Field names that hold a short summary of the entry. */
const SUMMARY_NAME = /^(description|summary|excerpt|abstract|intro|introduction|lead|teaser)$/i;
/** Field names of the entry's main text, when it is plain text. */
const BODY_NAME = /^(body|content|text|article)$/i;

/** Whether an attribute holds a summary the AI can write (a text field named like one). */
export function isSummaryField(name: string, attribute: Attribute): boolean {
  return (
    (attribute.type === 'string' || attribute.type === 'text') &&
    !attribute.customField &&
    SUMMARY_NAME.test(name)
  );
}

/** The attribute a summary is written from: the first rich text or blocks, else a body text. */
export function summarySource(attributes: Attributes, exclude: string): string | null {
  const entries = Object.entries(attributes).filter(([name]) => name !== exclude);
  const rich = entries.find(([, attribute]) => ['richtext', 'blocks'].includes(attribute.type));
  if (rich) return rich[0];
  const body = entries.find(
    ([name, attribute]) => attribute.type === 'text' && BODY_NAME.test(name),
  );
  return body?.[0] ?? null;
}

/** The readable text of a blocks value (one line per block). */
export function blocksText(value: unknown): string {
  const text = (node: unknown): string => {
    if (!isObject(node)) return '';
    if (node['type'] === 'text') return typeof node['text'] === 'string' ? node['text'] : '';
    const children = Array.isArray(node['children']) ? node['children'] : [];
    const separator = node['type'] === 'list' ? '\n' : '';
    return children.map(text).join(separator);
  };
  return Array.isArray(value)
    ? value
        .map(text)
        .filter((line) => line.trim())
        .join('\n')
    : '';
}

/** The text of a summary source's value. */
export function sourceText(attribute: Attribute, value: unknown): string {
  if (attribute.type === 'blocks') return blocksText(value);
  return typeof value === 'string' ? value.trim() : '';
}

/** How long a summary may be for a field: ~7 characters a word within its maximum length. */
export function summaryWords(attribute: Attribute): number {
  const limit = attribute.maxLength ?? (attribute.type === 'string' ? 255 : undefined);
  if (!limit) return 60;
  return Math.max(10, Math.min(60, Math.floor(limit / 7)));
}
