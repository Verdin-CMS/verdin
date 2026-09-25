import { Attribute, ContentType } from '../../core/types';

/** Attribute types a list can show in a cell (and sort by). */
export const LISTABLE_TYPES: ReadonlySet<string> = new Set([
  'string',
  'email',
  'uid',
  'integer',
  'biginteger',
  'float',
  'decimal',
  'boolean',
  'enumeration',
  'date',
  'time',
  'datetime',
]);

export const PAGE_SIZES = [10, 20, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

/** Built-in columns every document has (`status`/`publishedAt` only with draft & publish). */
export type SystemColumn = 'id' | 'createdAt' | 'updatedAt' | 'status' | 'publishedAt';

export interface ListColumn {
  name: string;
  /** The schema attribute, or `null` for a built-in column. */
  attribute: Attribute | null;
  sortable: boolean;
}

export interface ListSort {
  field: string;
  descending: boolean;
}

/** A list's view settings, as stored under `listViews[uid]` in the user's preferences. */
export interface ListView {
  columns: string[];
  sort: ListSort;
  pageSize: PageSize;
}

const DEFAULT_SORT: ListSort = { field: 'updatedAt', descending: true };
const DEFAULT_PAGE_SIZE: PageSize = 20;
/** Attribute columns a list shows until the user picks their own. */
const DEFAULT_ATTRIBUTES = 4;

/** Every column the type's list can show, attributes first in schema order. */
export function availableColumns(type: ContentType): ListColumn[] {
  const attributes = Object.entries(type.attributes)
    .filter(([, attribute]) => LISTABLE_TYPES.has(attribute.type) && !attribute.private)
    .map(([name, attribute]) => ({ name, attribute, sortable: true }));
  const system: SystemColumn[] = type.draftAndPublish
    ? ['id', 'status', 'createdAt', 'updatedAt', 'publishedAt']
    : ['id', 'createdAt', 'updatedAt'];
  return [
    ...attributes.filter((column) => !(system as string[]).includes(column.name)),
    ...system.map((name) => ({ name, attribute: null, sortable: name !== 'status' })),
  ];
}

/** The column that identifies an entry: the title field when listable, else the first one. */
export function mainColumn(type: ContentType, titleField: string | null): string {
  const columns = availableColumns(type);
  if (titleField && columns.some((column) => column.name === titleField)) return titleField;
  return columns.find((column) => column.attribute)?.name ?? 'id';
}

/** What a list shows before any customisation. */
export function defaultView(type: ContentType, titleField: string | null): ListView {
  const main = mainColumn(type, titleField);
  const attributes = availableColumns(type)
    .filter((column) => column.attribute && column.name !== main)
    .slice(0, DEFAULT_ATTRIBUTES - (main === 'id' ? 0 : 1))
    .map((column) => column.name);
  const system = type.draftAndPublish ? ['status', 'updatedAt'] : ['updatedAt'];
  return {
    columns: [main, ...attributes, ...system].filter(
      (name, index, all) => all.indexOf(name) === index,
    ),
    sort: { ...DEFAULT_SORT },
    pageSize: DEFAULT_PAGE_SIZE,
  };
}

/**
 * The view to apply: `saved` (user-writable JSON, possibly from an older schema) checked
 * against the type. Unknown or duplicate columns are dropped, the main column is always
 * shown, and an invalid sort or page size falls back to the default.
 */
export function resolveView(
  saved: unknown,
  type: ContentType,
  titleField: string | null,
): ListView {
  const fallback = defaultView(type, titleField);
  if (!saved || typeof saved !== 'object') return fallback;
  const raw = saved as { columns?: unknown; sort?: unknown; pageSize?: unknown };
  const columns = availableColumns(type);
  const known = new Map(columns.map((column) => [column.name, column]));

  let names = Array.isArray(raw.columns)
    ? raw.columns.filter(
        (name, index, all): name is string =>
          typeof name === 'string' && known.has(name) && all.indexOf(name) === index,
      )
    : fallback.columns;
  const main = mainColumn(type, titleField);
  if (!names.includes(main)) names = [main, ...names];

  const sort = raw.sort as { field?: unknown; descending?: unknown } | undefined;
  const validSort =
    sort &&
    typeof sort.field === 'string' &&
    known.get(sort.field)?.sortable === true &&
    typeof sort.descending === 'boolean';

  return {
    columns: names,
    sort: validSort
      ? { field: sort.field as string, descending: sort.descending as boolean }
      : fallback.sort,
    pageSize: PAGE_SIZES.includes(raw.pageSize as PageSize)
      ? (raw.pageSize as PageSize)
      : fallback.pageSize,
  };
}

/** Whether `view` is what the list shows by default (nothing worth storing). */
export function isDefaultView(
  view: ListView,
  type: ContentType,
  titleField: string | null,
): boolean {
  const fallback = defaultView(type, titleField);
  return (
    view.pageSize === fallback.pageSize &&
    view.sort.field === fallback.sort.field &&
    view.sort.descending === fallback.sort.descending &&
    view.columns.length === fallback.columns.length &&
    view.columns.every((name, index) => fallback.columns[index] === name)
  );
}

/** `columns` with the entry at `index` moved by `offset` (clamped to the ends). */
export function moveColumn(columns: readonly string[], index: number, offset: number): string[] {
  const target = Math.max(0, Math.min(columns.length - 1, index + offset));
  const next = [...columns];
  const [moved] = next.splice(index, 1);
  if (moved !== undefined) next.splice(target, 0, moved);
  return next;
}
