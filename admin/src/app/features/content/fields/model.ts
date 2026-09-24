import { Attribute, Attributes, Component, MediaFile } from '../../../core/types';

/** Looks up component schemas by uid. */
export type ComponentLookup = (uid: string) => Component | undefined;

export type FormModel = Record<string, unknown>;

let nextKey = 0;

/** Gives a list item a stable rendering key (`__key`, never sent to the API). */
export function keyed(item: FormModel): FormModel {
  return item['__key'] ? item : { ...item, __key: `k${++nextKey}` };
}

const TEXT_TYPES = new Set(['string', 'email', 'text', 'richtext', 'uid', 'date', 'time']);

/** Whether the admin edits this attribute (the `mappedBy` side of relations is read-only). */
export function isEditable(attribute: Attribute): boolean {
  return !(attribute.type === 'relation' && attribute.mappedBy);
}

/** The form value of an empty attribute, honouring schema defaults. */
export function emptyValue(attribute: Attribute, _components?: ComponentLookup): unknown {
  const fallback = attribute.default;
  switch (attribute.type) {
    case 'boolean':
      return fallback ?? false;
    case 'integer':
    case 'float':
    case 'decimal':
      return fallback ?? null;
    case 'biginteger':
      return fallback === undefined ? null : String(fallback);
    case 'enumeration':
    case 'datetime':
    case 'json':
      return fallback ?? null;
    case 'relation':
      return attribute.relation && isToMany(attribute) ? [] : null;
    case 'component':
      return attribute.repeatable ? [] : null;
    case 'dynamiczone':
      return [];
    case 'media':
      return attribute.multiple ? [] : null;
    default:
      return fallback ?? '';
  }
}

export function isToMany(attribute: Attribute): boolean {
  return ['oneToMany', 'manyToMany', 'manyWay'].includes(attribute.relation ?? '');
}

/** A new component item with its defaults. */
export function newComponentItem(
  component: Component,
  components: ComponentLookup,
  dynamicZone: boolean,
): FormModel {
  const item: FormModel = {};
  if (dynamicZone) item['__component'] = component.uid;
  for (const [name, attribute] of Object.entries(component.attributes)) {
    item[name] = emptyValue(attribute, components);
  }
  return item;
}

/** A document (as returned with `populate=*`) → form model. */
export function toModel(
  attributes: Attributes,
  document: Record<string, unknown> | null,
  components: ComponentLookup,
): FormModel {
  const model: FormModel = {};
  for (const [name, attribute] of Object.entries(attributes)) {
    const value = document?.[name];
    if (value === undefined || value === null) {
      model[name] = emptyValue(attribute, components);
      continue;
    }
    switch (attribute.type) {
      case 'relation':
        model[name] = Array.isArray(value)
          ? value.map((item) => (item as { documentId: string }).documentId)
          : (value as { documentId: string }).documentId;
        break;
      case 'component': {
        const component = components(attribute.component ?? '');
        if (!component) break;
        model[name] = attribute.repeatable
          ? (value as Record<string, unknown>[]).map((item) =>
              keyed(withId(toModel(component.attributes, item, components), item)),
            )
          : withId(
              toModel(component.attributes, value as Record<string, unknown>, components),
              value as Record<string, unknown>,
            );
        break;
      }
      case 'dynamiczone':
        model[name] = (value as Record<string, unknown>[]).map((item) => {
          const component = components(String(item['__component']));
          const inner = component ? toModel(component.attributes, item, components) : {};
          return keyed(withId({ __component: item['__component'], ...inner }, item));
        });
        break;
      case 'media':
        model[name] = Array.isArray(value)
          ? value.map((file) => mediaId(file))
          : attribute.multiple
            ? [mediaId(value)]
            : mediaId(value);
        break;
      case 'time':
        model[name] = String(value).slice(0, 8);
        break;
      default:
        model[name] = value;
    }
  }
  return model;
}

/** A populated file object (or an id already) → its id. */
function mediaId(value: unknown): number {
  return typeof value === 'object' && value !== null
    ? Number((value as { id: unknown }).id)
    : Number(value);
}

/** Populated files of a document's media attributes, for previews. */
export function mediaFilesOf(
  attributes: Attributes,
  document: Record<string, unknown> | null,
): Record<string, MediaFile[]> {
  const files: Record<string, MediaFile[]> = {};
  for (const [name, attribute] of Object.entries(attributes)) {
    if (attribute.type !== 'media') continue;
    const value = document?.[name];
    const list = Array.isArray(value) ? value : value ? [value] : [];
    files[name] = list.filter(
      (file): file is MediaFile => typeof file === 'object' && file !== null && 'id' in file,
    );
  }
  return files;
}

function withId(model: FormModel, source: Record<string, unknown>): FormModel {
  return source['id'] === undefined ? model : { id: source['id'], ...model };
}

/** Form model → `data` payload for the API. */
export function toPayload(
  attributes: Attributes,
  model: FormModel,
  components: ComponentLookup,
): FormModel {
  const payload: FormModel = {};
  for (const [name, attribute] of Object.entries(attributes)) {
    if (!isEditable(attribute) || !(name in model)) continue;
    const value = model[name];
    switch (attribute.type) {
      case 'component': {
        const component = components(attribute.component ?? '');
        if (!component) break;
        if (attribute.repeatable) {
          payload[name] = (value as FormModel[]).map((item) =>
            itemPayload(component.attributes, item, components),
          );
        } else {
          payload[name] =
            value === null
              ? null
              : itemPayload(component.attributes, value as FormModel, components);
        }
        break;
      }
      case 'dynamiczone':
        payload[name] = (value as FormModel[]).map((item) => {
          const component = components(String(item['__component']));
          return {
            __component: item['__component'],
            ...itemPayload(component?.attributes ?? {}, item, components),
          };
        });
        break;
      case 'media':
        // File ids; the order of a multiple field is kept.
        payload[name] = Array.isArray(value) ? [...value] : (value ?? null);
        break;
      default:
        // Empty strings are "no value" (and must not collide on unique attributes).
        payload[name] = TEXT_TYPES.has(attribute.type) && value === '' ? null : value;
    }
  }
  return payload;
}

function itemPayload(
  attributes: Attributes,
  item: FormModel,
  components: ComponentLookup,
): FormModel {
  const payload = toPayload(attributes, item, components);
  return item['id'] === undefined ? payload : { id: item['id'], ...payload };
}

/** Human label for a document. */
export function documentLabel(
  document: Record<string, unknown>,
  titleField: string | null,
): string {
  const title = titleField ? document[titleField] : null;
  return title === null || title === undefined || title === ''
    ? String(document['documentId'])
    : String(title);
}
