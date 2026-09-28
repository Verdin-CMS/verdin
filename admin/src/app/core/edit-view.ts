import { Injectable, inject } from '@angular/core';

import { Api } from './api';
import { isMorph } from './morph';
import { Attribute, Attributes, ContentType } from './types';

/** A row is 12 columns wide. */
export const ROW = 12;
/** The widths the configurator offers, out of 12. */
export const WIDTHS = [4, 6, 8, 12] as const;

/** A field placed in a row; `size` is its width out of 12. */
export interface LayoutItem {
  name: string;
  size: number;
}

/** Per-field settings of the entry editor. */
export interface FieldSettings {
  label?: string;
  description?: string;
  placeholder?: string;
  /** `false` shows the field read-only (absent: editable). */
  editable?: boolean;
  /** Relations: the target's field that names related entries. */
  mainField?: string;
}

/** The entry editor's configuration of a content type (Strapi's "configure the view"). */
export interface EditView {
  layout: LayoutItem[][];
  fields: Record<string, FieldSettings>;
}

/** Keeps a width between 1 and 12. */
export function clampSize(size: number): number {
  return Number.isFinite(size) ? Math.min(ROW, Math.max(1, Math.round(size))) : ROW;
}

/**
 * The fields in display order with their widths: the configured layout (unknown and
 * repeated names dropped), then fields it does not place, full width, in schema order.
 */
export function orderedFields(attributes: Attributes, view: EditView | null): LayoutItem[] {
  const items: LayoutItem[] = [];
  const seen = new Set<string>();
  for (const row of view?.layout ?? []) {
    for (const item of row) {
      if (!(item.name in attributes) || seen.has(item.name)) continue;
      seen.add(item.name);
      items.push({ name: item.name, size: clampSize(item.size) });
    }
  }
  for (const name of Object.keys(attributes)) {
    if (!seen.has(name)) items.push({ name, size: ROW });
  }
  return items;
}

/** Packs fields into rows of at most 12 columns, in order (a field that does not fit wraps). */
export function packRows(items: readonly LayoutItem[]): LayoutItem[][] {
  const rows: LayoutItem[][] = [];
  let row: LayoutItem[] = [];
  let width = 0;
  for (const item of items) {
    const size = clampSize(item.size);
    if (row.length && width + size > ROW) {
      rows.push(row);
      row = [];
      width = 0;
    }
    row.push({ name: item.name, size });
    width += size;
  }
  if (row.length) rows.push(row);
  return rows;
}

/**
 * The editor's rows: configured rows kept as they are (fields filtered out by `keep`, e.g.
 * hidden by a condition, leave their row), then unplaced fields one per row. Without a
 * configuration, every field has its own row.
 */
export function layoutRows(
  attributes: Attributes,
  view: EditView | null,
  keep: (name: string) => boolean = () => true,
): LayoutItem[][] {
  const rows: LayoutItem[][] = [];
  const seen = new Set<string>();
  for (const row of view?.layout ?? []) {
    const kept: LayoutItem[] = [];
    for (const item of row) {
      if (!(item.name in attributes) || seen.has(item.name)) continue;
      seen.add(item.name);
      if (keep(item.name)) kept.push({ name: item.name, size: clampSize(item.size) });
    }
    if (kept.length) rows.push(kept);
  }
  for (const name of Object.keys(attributes)) {
    if (!seen.has(name) && keep(name)) rows.push([{ name, size: ROW }]);
  }
  return rows;
}

/** Moves the item at `from` to `to` (both clamped), returning a new list. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const list = [...items];
  if (from < 0 || from >= list.length) return list;
  const target = Math.min(list.length - 1, Math.max(0, to));
  const [item] = list.splice(from, 1);
  list.splice(target, 0, item);
  return list;
}

const MAIN_FIELD_TYPES = new Set<Attribute['type']>([
  'string',
  'email',
  'uid',
  'text',
  'enumeration',
  'integer',
  'biginteger',
  'float',
  'decimal',
  'date',
  'datetime',
]);

/** Fields of `target` that can name its entries in relation pickers (as the server allows). */
export function mainFieldOptions(target: ContentType | undefined): string[] {
  const names = Object.entries(target?.attributes ?? {})
    .filter(([, attribute]) => !attribute.private && MAIN_FIELD_TYPES.has(attribute.type))
    .map(([name]) => name);
  return [...names, 'id', 'documentId'];
}

/** Types whose `$containsi` filter searches their text. */
export function searchable(attribute: Attribute | undefined): boolean {
  return !!attribute && ['string', 'email', 'uid', 'text', 'enumeration'].includes(attribute.type);
}

/** Settings cleaned for the API: texts trimmed, empty ones and defaults dropped. */
export function cleanSettings(
  attributes: Attributes,
  fields: Record<string, FieldSettings>,
): Record<string, FieldSettings> {
  const out: Record<string, FieldSettings> = {};
  for (const [name, settings] of Object.entries(fields)) {
    const attribute = attributes[name];
    if (!attribute) continue;
    const clean: FieldSettings = {};
    for (const key of ['label', 'description', 'placeholder'] as const) {
      const text = settings[key]?.trim();
      if (text) clean[key] = text;
    }
    if (settings.editable === false) clean.editable = false;
    if (attribute.type === 'relation' && !isMorph(attribute) && settings.mainField)
      clean.mainField = settings.mainField;
    if (Object.keys(clean).length) out[name] = clean;
  }
  return out;
}

/** The request body for the configurator's state. */
export function viewPayload(
  attributes: Attributes,
  items: readonly LayoutItem[],
  fields: Record<string, FieldSettings>,
): EditView {
  return { layout: packRows(items), fields: cleanSettings(attributes, fields) };
}

/** Entry editor configurations (`/content-types/{uid}/edit-view`). */
@Injectable({ providedIn: 'root' })
export class EditViews {
  private readonly api = inject(Api);

  /** The configuration of `uid`; `null` when never configured. */
  get(uid: string): Promise<EditView | null> {
    return this.api.get<EditView | null>(`/content-types/${uid}/edit-view`);
  }

  save(uid: string, view: EditView): Promise<EditView> {
    return this.api.put<EditView>(`/content-types/${uid}/edit-view`, view);
  }

  reset(uid: string): Promise<void> {
    return this.api.delete(`/content-types/${uid}/edit-view`);
  }
}
