/**
 * Polymorphic relations (Strapi's `morphToOne`, `morphToMany` and their inverse sides
 * `morphOne`, `morphMany`): links to documents of several content types. The admin shows
 * them read-only; they are managed through the API.
 */
import { Attribute, MorphKind } from './types';

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
