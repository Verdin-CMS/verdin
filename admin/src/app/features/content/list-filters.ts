/**
 * The content list's filter builder: conditions (field, operator, value) combined with AND,
 * written in the API's bracket syntax (`filters[$and][0][title][$contains]=x`) both to the
 * admin list endpoint and to the page URL, so that reloading or going back keeps them.
 */
import { Attribute, ContentType } from '../../core/types';

export type FilterOperator =
  | '$eq'
  | '$ne'
  | '$contains'
  | '$notContains'
  | '$startsWith'
  | '$endsWith'
  | '$lt'
  | '$lte'
  | '$gt'
  | '$gte'
  | '$in'
  | '$null'
  | '$notNull';

/** How a field's values are compared and entered. */
export type FilterKind =
  | 'text'
  | 'number'
  | 'boolean'
  | 'enum'
  | 'date'
  | 'datetime'
  | 'time'
  /** A related entry's documentId. */
  | 'documentId';

/** Something a condition can be about: a field, or a field of the related entries. */
export interface FilterField {
  /** `title`, or `author.name` for a relation compared by the target's field. */
  key: string;
  /** The attribute (or built-in field) of the listed type. */
  field: string;
  /** Relations: the target's field compared. */
  path?: string;
  kind: FilterKind;
  /** `null` for built-in fields (`id`, `createdAt`…). */
  attribute: Attribute | null;
  /** The field is a relation (`$null` / `$notNull` test whether it has entries). */
  relation: boolean;
  /** Enumerations: the allowed values. */
  options?: string[];
}

export interface FilterCondition {
  field: string;
  /** Relations: the target's field compared. */
  path?: string;
  operator: FilterOperator;
  /** One value; a list for `$in`; ignored by `$null` / `$notNull`. */
  value: string | string[];
}

/** Operators that take no value. */
export const VALUELESS: ReadonlySet<FilterOperator> = new Set(['$null', '$notNull']);

const TEXT_OPERATORS: FilterOperator[] = [
  '$eq',
  '$ne',
  '$contains',
  '$notContains',
  '$startsWith',
  '$endsWith',
  '$null',
  '$notNull',
];
const ORDERED_OPERATORS: FilterOperator[] = [
  '$eq',
  '$ne',
  '$lt',
  '$lte',
  '$gt',
  '$gte',
  '$null',
  '$notNull',
];

const OPERATORS: Record<FilterKind, FilterOperator[]> = {
  text: TEXT_OPERATORS,
  number: ORDERED_OPERATORS,
  date: ORDERED_OPERATORS,
  time: ORDERED_OPERATORS,
  // A timestamp is never "equal" to a picked day: compare with before / after.
  datetime: ['$lt', '$lte', '$gt', '$gte', '$null', '$notNull'],
  boolean: ['$eq', '$null', '$notNull'],
  enum: ['$eq', '$ne', '$in', '$null', '$notNull'],
  documentId: ['$eq', '$ne', '$null', '$notNull'],
};

/** The operators offered for a field, in menu order. */
export function operatorsFor(field: FilterField): FilterOperator[] {
  return OPERATORS[field.kind];
}

const KINDS: Record<string, FilterKind> = {
  string: 'text',
  email: 'text',
  uid: 'text',
  text: 'text',
  richtext: 'text',
  integer: 'number',
  biginteger: 'number',
  float: 'number',
  decimal: 'number',
  boolean: 'boolean',
  enumeration: 'enum',
  date: 'date',
  datetime: 'datetime',
  time: 'time',
};

/**
 * The fields a list can filter on: public scalar attributes, relations (by the target's
 * main field or documentId), then `id`, `createdAt` and `updatedAt`.
 * `mainFieldOf` gives a target type's main (title) field.
 */
export function filterableFields(
  type: ContentType,
  mainFieldOf: (target: string) => string | null,
): FilterField[] {
  const fields: FilterField[] = [];
  for (const [name, attribute] of Object.entries(type.attributes)) {
    if (attribute.private) continue;
    if (attribute.type === 'relation') {
      const main = mainFieldOf(attribute.target ?? '');
      if (main && main !== 'documentId')
        fields.push({
          key: `${name}.${main}`,
          field: name,
          path: main,
          kind: 'text',
          attribute,
          relation: true,
        });
      fields.push({
        key: `${name}.documentId`,
        field: name,
        path: 'documentId',
        kind: 'documentId',
        attribute,
        relation: true,
      });
      continue;
    }
    const kind = KINDS[attribute.type];
    if (!kind) continue;
    fields.push({
      key: name,
      field: name,
      kind,
      attribute,
      relation: false,
      ...(kind === 'enum' ? { options: attribute.enum ?? [] } : {}),
    });
  }
  const system: [string, FilterKind][] = [
    ['id', 'number'],
    ['createdAt', 'datetime'],
    ['updatedAt', 'datetime'],
  ];
  for (const [name, kind] of system) {
    if (type.attributes[name]) continue;
    fields.push({ key: name, field: name, kind, attribute: null, relation: false });
  }
  return fields;
}

export function conditionKey(condition: Pick<FilterCondition, 'field' | 'path'>): string {
  return condition.path ? `${condition.field}.${condition.path}` : condition.field;
}

/** A condition with a value the API accepts (a list for `$in`, `true` for `$null`…). */
export function isComplete(condition: FilterCondition): boolean {
  if (VALUELESS.has(condition.operator)) return true;
  if (condition.operator === '$in')
    return Array.isArray(condition.value) && condition.value.length > 0;
  return typeof condition.value === 'string' && condition.value.trim() !== '';
}

/** The `filters` object of the conditions, for `toQuery` (complete conditions only). */
export function filterTree(conditions: readonly FilterCondition[]): Record<string, unknown> {
  const items = conditions.filter(isComplete).map((condition) => {
    const { field, path, operator } = condition;
    let operand: unknown;
    if (VALUELESS.has(operator)) operand = { [operator]: 'true' };
    else if (operator === '$in')
      operand = { $in: Object.fromEntries((condition.value as string[]).map((v, i) => [i, v])) };
    else operand = { [operator]: String(condition.value).trim() };
    // `$null` on a relation tests whether it has entries at all.
    if (path && !VALUELESS.has(operator)) return { [field]: { [path]: operand } };
    return { [field]: operand };
  });
  return items.length ? { $and: Object.fromEntries(items.map((item, i) => [i, item])) } : {};
}

/** The conditions as flat URL query parameters (`filters[$and][0][title][$eq]` → value). */
export function filterParams(conditions: readonly FilterCondition[]): Record<string, string> {
  const params: Record<string, string> = {};
  const walk = (value: unknown, prefix: string) => {
    if (value !== null && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) walk(item, `${prefix}[${key}]`);
    } else {
      params[prefix] = String(value);
    }
  };
  const tree = filterTree(conditions);
  if (Object.keys(tree).length) walk(tree, 'filters');
  return params;
}

/** Whether a query parameter belongs to the filters. */
export function isFilterParam(key: string): boolean {
  return key === 'filters' || key.startsWith('filters[');
}

const ENTRY = /^filters\[\$and\]\[(\d+)\]((?:\[[^\][]*\])+)$/;

/**
 * Reads conditions back from URL query parameters, keeping only the ones that make sense
 * for `fields` (unknown fields, operators or values are dropped).
 */
export function parseFilterParams(
  params: Readonly<Record<string, string | readonly string[] | undefined>>,
  fields: readonly FilterField[],
): FilterCondition[] {
  const byIndex = new Map<number, { segments: string[]; value: string }[]>();
  for (const [key, raw] of Object.entries(params)) {
    const match = ENTRY.exec(key);
    if (!match || raw === undefined) continue;
    const value = typeof raw === 'string' ? raw : (raw[raw.length - 1] ?? '');
    const segments = [...match[2].matchAll(/\[([^\][]*)\]/g)].map((part) => part[1]);
    const index = Number(match[1]);
    byIndex.set(index, [...(byIndex.get(index) ?? []), { segments, value }]);
  }
  const conditions: FilterCondition[] = [];
  for (const index of [...byIndex.keys()].sort((a, b) => a - b)) {
    const condition = readCondition(byIndex.get(index)!, fields);
    if (condition) conditions.push(condition);
  }
  return conditions;
}

function readCondition(
  entries: { segments: string[]; value: string }[],
  fields: readonly FilterField[],
): FilterCondition | null {
  const [first] = entries;
  const [field, second, third] = first.segments;
  if (!field || !second) return null;
  const candidates = fields.filter((candidate) => candidate.field === field);
  if (!candidates.length) return null;
  let path: string | undefined;
  let operator: string;
  let rest: number;
  if (second.startsWith('$')) {
    operator = second;
    rest = 2;
  } else {
    path = second;
    operator = third ?? '';
    rest = 3;
  }
  const target = candidates[0].relation
    ? path
      ? candidates.find((candidate) => candidate.path === path)
      : // `filters[author][$null]`: the relation itself; shown on its first field.
        candidates[0]
    : !path
      ? candidates[0]
      : undefined;
  if (!target) return null;
  if (!operatorsFor(target).includes(operator as FilterOperator)) return null;
  const op = operator as FilterOperator;
  // Relations: `$null` / `$notNull` on the relation itself, anything else on a field of it.
  if (target.relation && VALUELESS.has(op) === !!path) return null;
  if (VALUELESS.has(op)) {
    if (entries.length !== 1 || first.segments.length !== rest || !isTrue(first.value)) return null;
    return { field, ...(target.path ? { path: target.path } : {}), operator: op, value: '' };
  }
  if (op === '$in') {
    const values = entries
      .filter(
        (entry) =>
          entry.segments.length === rest + 1 &&
          entry.segments.slice(0, rest).join('\u0000') ===
            first.segments.slice(0, rest).join('\u0000') &&
          /^\d+$/.test(entry.segments[rest]),
      )
      .sort((a, b) => Number(a.segments[rest]) - Number(b.segments[rest]))
      .map((entry) => entry.value)
      .filter((value) => !target.options || target.options.includes(value));
    if (values.length !== entries.length || !values.length) return null;
    return { field, ...(path ? { path } : {}), operator: op, value: values };
  }
  if (entries.length !== 1 || first.segments.length !== rest) return null;
  if (!validValue(target, first.value)) return null;
  return { field, ...(path ? { path } : {}), operator: op, value: first.value };
}

function isTrue(value: string): boolean {
  return value === 'true' || value === '1';
}

/** Whether `value` fits the field (so a hand-edited URL cannot break the list). */
export function validValue(field: FilterField, value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  switch (field.kind) {
    case 'number':
      return /^-?(\d+\.?\d*|\.\d+)$/.test(text);
    case 'boolean':
      return text === 'true' || text === 'false';
    case 'enum':
      return !field.options || field.options.includes(text);
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(text);
    case 'datetime':
      return /^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:\d{2})?)?$/.test(text);
    case 'time':
      return /^\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(text);
    default:
      return true;
  }
}

/** A new condition on `field` with its first operator and an empty value. */
export function blankCondition(field: FilterField): FilterCondition {
  const operator = operatorsFor(field)[0];
  return {
    field: field.field,
    ...(field.path ? { path: field.path } : {}),
    operator,
    value: field.kind === 'boolean' ? 'true' : '',
  };
}

/** The condition moved to another operator: the value is kept when it still fits. */
export function withOperator(
  condition: FilterCondition,
  operator: FilterOperator,
): FilterCondition {
  const wasList = condition.operator === '$in';
  const isList = operator === '$in';
  let value = condition.value;
  if (wasList !== isList) {
    value = isList
      ? typeof value === 'string' && value
        ? [value]
        : []
      : Array.isArray(value)
        ? (value[0] ?? '')
        : value;
  }
  return { ...condition, operator, value };
}
