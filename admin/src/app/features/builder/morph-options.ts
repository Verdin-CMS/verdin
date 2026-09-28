/**
 * Polymorphic relations in the builder: the kinds offered, how switching kinds cleans an
 * attribute, and the checks the server makes on plan/apply (`verdin-schema`), mirrored so
 * the field dialog explains them before saving.
 */
import { MessageKey } from '../../core/i18n/keys';
import { MORPH_KINDS } from '../../core/morph';
import { Attribute, MorphKind, RelationKind } from '../../core/types';

/** Schema files by singularName, as `GET /schema` lists them. */
export type SchemaFiles = Record<
  string,
  { displayName?: unknown; attributes: Record<string, Attribute> } | null | undefined
>;

export const MORPH_RELATIONS: { kind: MorphKind; label: MessageKey }[] = [
  { kind: 'morphToOne', label: 'builder.morph.relation.morphToOne' },
  { kind: 'morphToMany', label: 'builder.morph.relation.morphToMany' },
  { kind: 'morphOne', label: 'builder.morph.relation.morphOne' },
  { kind: 'morphMany', label: 'builder.morph.relation.morphMany' },
];

export function isMorphKind(kind: string | undefined): kind is MorphKind {
  return (MORPH_KINDS as readonly string[]).includes(kind ?? '');
}

export function isOwnerKind(kind: string | undefined): kind is 'morphToOne' | 'morphToMany' {
  return kind === 'morphToOne' || kind === 'morphToMany';
}

export function isInverseKind(kind: string | undefined): kind is 'morphOne' | 'morphMany' {
  return kind === 'morphOne' || kind === 'morphMany';
}

/** The owner kind an inverse side reads: `morphOne` ↔ `morphToOne`, `morphMany` ↔ `morphToMany`. */
export function ownerKindOf(kind: 'morphOne' | 'morphMany'): 'morphToOne' | 'morphToMany' {
  return kind === 'morphOne' ? 'morphToOne' : 'morphToMany';
}

/** `api::article`, `api::article.article` → `article` (the schema file's key). */
export function typeKey(uid: string | undefined): string {
  return (uid ?? '').replace(/^api::/, '').split('.')[0];
}

/** A content type an inverse side can read from, with its compatible owner attributes. */
export interface MorphOwnerOption {
  /** The value written in `target`. */
  uid: string;
  label: string;
  /** Owner attributes of the kind the inverse side pairs with. */
  fields: string[];
}

/**
 * Owner attributes of `file` that an inverse side can name in `morphBy`. Any owner kind
 * pairs with any inverse kind, as on the server (a `morphMany` may read a `morphToOne`:
 * comments each about one entry, an article with many comments). Those of the matching
 * kind come first.
 */
export function compatibleOwnerFields(
  file: SchemaFiles[string],
  kind: 'morphOne' | 'morphMany',
): string[] {
  const matching = ownerKindOf(kind);
  const owners = Object.entries(file?.attributes ?? {}).filter(
    ([, attribute]) => attribute.type === 'relation' && isOwnerKind(attribute.relation),
  );
  return [
    ...owners.filter(([, attribute]) => attribute.relation === matching),
    ...owners.filter(([, attribute]) => attribute.relation !== matching),
  ].map(([name]) => name);
}

/** Content types holding at least one owner attribute an inverse side of `kind` pairs with. */
export function morphOwnerOptions(
  types: SchemaFiles,
  kind: 'morphOne' | 'morphMany',
): MorphOwnerOption[] {
  const options: MorphOwnerOption[] = [];
  for (const [key, file] of Object.entries(types)) {
    const fields = compatibleOwnerFields(file, kind);
    if (fields.length)
      options.push({ uid: `api::${key}`, label: String(file?.displayName || key), fields });
  }
  return options.sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * The attribute with relation `kind`, keeping only what that kind takes: owners link any
 * type (no `target`, no `morphBy`), inverse sides name their owner (`target`, `morphBy`,
 * reset when coming from another kind), and plain relations drop `morphBy`.
 */
export function withRelationKind(attribute: Attribute, kind: RelationKind): Attribute {
  const previous = attribute.relation;
  const next: Attribute = { ...attribute, relation: kind };
  if (isMorphKind(kind)) {
    delete next.inversedBy;
    delete next.mappedBy;
  } else {
    delete next.morphBy;
    if (isMorphKind(previous)) next.target = '';
  }
  if (isOwnerKind(kind)) {
    delete next.target;
    delete next.morphBy;
  }
  if (isInverseKind(kind) && previous !== kind) {
    // Switching between inverse kinds keeps the owner; coming from elsewhere, pick one.
    if (!isInverseKind(previous)) {
      delete next.target;
      delete next.morphBy;
    }
  }
  return next;
}

/** Why a polymorphic attribute would be rejected, as a message key (`null`: fine). */
export function morphIssue(
  attribute: Attribute,
  types: SchemaFiles,
  inComponent: boolean,
): MessageKey | null {
  const kind = attribute.relation;
  if (attribute.type !== 'relation' || !isMorphKind(kind)) return null;
  if (inComponent) return 'builder.morph.issue.component';
  if (isOwnerKind(kind)) return null;
  if (!attribute.target) return 'builder.morph.issue.target';
  const owner = types[typeKey(attribute.target)];
  if (!owner) return 'builder.morph.issue.unknownTarget';
  if (!attribute.morphBy) return 'builder.morph.issue.morphBy';
  const field = owner.attributes[attribute.morphBy];
  if (!field || field.type !== 'relation' || !isOwnerKind(field.relation))
    return 'builder.morph.issue.notOwner';
  return null;
}
