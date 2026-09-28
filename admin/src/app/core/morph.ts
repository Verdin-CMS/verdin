/**
 * Polymorphic relations (Strapi's `morphToOne`, `morphToMany` and their inverse sides
 * `morphOne`, `morphMany`): links to documents of several content types. The editor edits
 * owners (`{ __type, documentId }` items); inverse sides are read-only, as in the API.
 */
import { isLocalized } from './content-locales';
import { Attribute, ContentType, MorphKind } from './types';

export const MORPH_KINDS: readonly MorphKind[] = [
  'morphToOne',
  'morphToMany',
  'morphOne',
  'morphMany',
];

/** Whether the attribute is a polymorphic relation. */
export function isMorph(attribute: Attribute | null | undefined): boolean {
  return (
    !!attribute &&
    attribute.type === 'relation' &&
    (MORPH_KINDS as readonly string[]).includes(attribute.relation ?? '')
  );
}

/** Owners (`morphToOne`, `morphToMany`) store the links; inverse sides only read them. */
export function isMorphOwner(attribute: Attribute | null | undefined): boolean {
  return isMorph(attribute) && ['morphToOne', 'morphToMany'].includes(attribute?.relation ?? '');
}

/** A populated polymorphic link: `{ __type, documentId, ...fields of the target }`. */
export interface MorphLink {
  /** The linked entry's content type uid. */
  uid: string;
  documentId: string;
  /** The linked entry, as populated (target fields). */
  entry: Record<string, unknown>;
}

/**
 * The links of a populated polymorphic value (a list, an object or null). Items name their
 * type in `__type`; inverse sides may leave it out, their items being of the owner type
 * `fallbackUid` (the attribute's `target`). Items without a type or documentId (not
 * populated, or malformed) are skipped.
 */
export function morphLinks(value: unknown, fallbackUid?: string): MorphLink[] {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  const links: MorphLink[] = [];
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue;
    const entry = item as Record<string, unknown>;
    const uid = entry['__type'] ?? fallbackUid;
    const documentId = entry['documentId'];
    if (typeof uid !== 'string' || !uid) continue;
    if (documentId === undefined || documentId === null || documentId === '') continue;
    links.push({ uid, documentId: String(documentId), entry });
  }
  return links;
}

/** A polymorphic link in the write format (and the editor's form value). */
export interface MorphRef {
  __type: string;
  documentId: string;
}

/** Identifies a link: the same documentId may exist in two types. */
export function morphKey(ref: { uid?: string; __type?: string; documentId: string }): string {
  return `${ref.__type ?? ref.uid ?? ''}:${ref.documentId}`;
}

/** A populated or form value (a list, an item or null) → its links in the write format. */
export function morphRefs(value: unknown): MorphRef[] {
  return morphLinks(value).map((link) => ({ __type: link.uid, documentId: link.documentId }));
}

/** Links → the form value of an owner: a list (to-many), else one link or `null`. */
export function morphValue(refs: readonly MorphRef[], many: boolean): MorphRef[] | MorphRef | null {
  const clean = refs.map((ref) => ({ __type: ref.__type, documentId: ref.documentId }));
  return many ? clean : (clean[0] ?? null);
}

/**
 * Adds picked links to the current ones: a to-one owner takes the first picked link, a
 * to-many one appends the picked links it does not hold yet, in pick order.
 */
export function addMorphRefs(
  current: readonly MorphRef[],
  picked: readonly MorphRef[],
  many: boolean,
): MorphRef[] {
  if (!many) return picked.length ? [picked[0]] : [...current];
  const seen = new Set(current.map(morphKey));
  const out = [...current];
  for (const ref of picked) {
    const key = morphKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

/**
 * The picker's selection after the user toggles `ref`. Linked entries cannot be picked
 * again; a to-many owner toggles the entry in or out, a to-one owner keeps one choice.
 */
export function toggleMorphPick(
  chosen: readonly MorphRef[],
  ref: MorphRef,
  many: boolean,
  linked: readonly MorphRef[],
): MorphRef[] {
  const key = morphKey(ref);
  if (linked.some((item) => morphKey(item) === key)) return [...chosen];
  const has = chosen.some((item) => morphKey(item) === key);
  if (!many) return has ? [] : [ref];
  return has ? chosen.filter((item) => morphKey(item) !== key) : [...chosen, ref];
}

/** Content types a polymorphic owner can link: those the admin may read, by name. */
export function morphTargetTypes(
  types: readonly ContentType[],
  canRead: (uid: string) => boolean,
): ContentType[] {
  return types
    .filter((type) => canRead(type.uid))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/**
 * The locale to search a target type in: the editor's locale when it has one, else the
 * default locale; `null` for types that are not localized.
 */
export function morphSearchLocale(
  type: ContentType | undefined,
  editorLocale: string | null,
  defaultLocale: string | null,
): string | null {
  if (!isLocalized(type)) return null;
  return editorLocale || defaultLocale || null;
}

/** The admin list query of the picker's search (`_q`, 10 results, latest first). */
export function morphSearchQuery(term: string, locale: string | null): Record<string, unknown> {
  const query: Record<string, unknown> = { pagination: { pageSize: 10 }, sort: 'updatedAt:desc' };
  const text = term.trim();
  if (text) query['_q'] = text;
  if (locale) query['locale'] = locale;
  return query;
}
