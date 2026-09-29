/** The content-type builder's shapes, attribute catalog and naming helpers. */
import { MessageKey } from '../../core/i18n/keys';
import { Attribute, AttributeType, MediaKind, PlanStep, RelationKind } from '../../core/types';

export type SchemaFile = Record<string, unknown> & { attributes: Record<string, Attribute> };

export interface Sources {
  contentTypes: Record<string, SchemaFile>;
  components: Record<string, SchemaFile>;
}

export interface Change {
  contentTypes: Record<string, SchemaFile | null>;
  components: Record<string, SchemaFile | null>;
  renameTables: string[];
  renameColumns: string[];
  allow?: string;
}

export interface TypeInfo {
  type: AttributeType;
  icon: string;
  label: MessageKey;
  description: MessageKey;
}

/** The attribute types, in picker order, with their icon and message keys. */
export const TYPE_INFO: TypeInfo[] = [
  {
    type: 'string',
    icon: 'lucideType',
    label: 'builder.types.string',
    description: 'builder.types.string.description',
  },
  {
    type: 'text',
    icon: 'lucideText',
    label: 'builder.types.text',
    description: 'builder.types.text.description',
  },
  {
    type: 'richtext',
    icon: 'lucideFileText',
    label: 'builder.types.richtext',
    description: 'builder.types.richtext.description',
  },
  {
    type: 'blocks',
    icon: 'lucideTextQuote',
    label: 'builder.types.blocks',
    description: 'builder.types.blocks.description',
  },
  {
    type: 'email',
    icon: 'lucideMail',
    label: 'builder.types.email',
    description: 'builder.types.email.description',
  },
  {
    type: 'password',
    icon: 'lucideKeyRound',
    label: 'builder.types.password',
    description: 'builder.types.password.description',
  },
  {
    type: 'uid',
    icon: 'lucideFingerprint',
    label: 'builder.types.uid',
    description: 'builder.types.uid.description',
  },
  {
    type: 'integer',
    icon: 'lucideHash',
    label: 'builder.types.integer',
    description: 'builder.types.integer.description',
  },
  {
    type: 'biginteger',
    icon: 'lucideHash',
    label: 'builder.types.biginteger',
    description: 'builder.types.biginteger.description',
  },
  {
    type: 'float',
    icon: 'lucideHash',
    label: 'builder.types.float',
    description: 'builder.types.float.description',
  },
  {
    type: 'decimal',
    icon: 'lucideHash',
    label: 'builder.types.decimal',
    description: 'builder.types.decimal.description',
  },
  {
    type: 'boolean',
    icon: 'lucideToggleLeft',
    label: 'builder.types.boolean',
    description: 'builder.types.boolean.description',
  },
  {
    type: 'date',
    icon: 'lucideCalendar',
    label: 'builder.types.date',
    description: 'builder.types.date.description',
  },
  {
    type: 'time',
    icon: 'lucideClock',
    label: 'builder.types.time',
    description: 'builder.types.time.description',
  },
  {
    type: 'datetime',
    icon: 'lucideCalendarClock',
    label: 'builder.types.datetime',
    description: 'builder.types.datetime.description',
  },
  {
    type: 'enumeration',
    icon: 'lucideList',
    label: 'builder.types.enumeration',
    description: 'builder.types.enumeration.description',
  },
  {
    type: 'json',
    icon: 'lucideBraces',
    label: 'builder.types.json',
    description: 'builder.types.json.description',
  },
  {
    type: 'media',
    icon: 'lucideImage',
    label: 'builder.types.media',
    description: 'builder.types.media.description',
  },
  {
    type: 'relation',
    icon: 'lucideLink',
    label: 'builder.types.relation',
    description: 'builder.types.relation.description',
  },
  {
    type: 'component',
    icon: 'lucideBlocks',
    label: 'builder.types.component',
    description: 'builder.types.component.description',
  },
  {
    type: 'dynamiczone',
    icon: 'lucideLayers',
    label: 'builder.types.dynamiczone',
    description: 'builder.types.dynamiczone.description',
  },
];
export const TYPE_BY_NAME = new Map(TYPE_INFO.map((info) => [info.type, info]));

export const MEDIA_KINDS: { kind: MediaKind; label: MessageKey }[] = [
  { kind: 'images', label: 'builder.field.mediaKind.images' },
  { kind: 'videos', label: 'builder.field.mediaKind.videos' },
  { kind: 'audios', label: 'builder.field.mediaKind.audios' },
  { kind: 'files', label: 'builder.field.mediaKind.files' },
];

export const RELATIONS: { kind: RelationKind; label: MessageKey; bidirectional: boolean }[] = [
  { kind: 'manyToOne', label: 'builder.relations.manyToOne', bidirectional: true },
  { kind: 'oneToMany', label: 'builder.relations.oneToMany', bidirectional: true },
  { kind: 'manyToMany', label: 'builder.relations.manyToMany', bidirectional: true },
  { kind: 'oneToOne', label: 'builder.relations.oneToOne', bidirectional: true },
  { kind: 'oneWay', label: 'builder.relations.oneWay', bidirectional: false },
  { kind: 'manyWay', label: 'builder.relations.manyWay', bidirectional: false },
];
/** Components can only hold one-way relations. */
export const COMPONENT_RELATIONS = RELATIONS.filter((relation) => !relation.bidirectional);
export const RISK_LABELS: Record<PlanStep['risk'], MessageKey> = {
  safe: 'builder.risk.safe',
  risky: 'builder.risk.risky',
  destructive: 'builder.risk.destructive',
};
export const INVERSE: Partial<Record<RelationKind, RelationKind>> = {
  manyToOne: 'oneToMany',
  oneToMany: 'manyToOne',
  manyToMany: 'manyToMany',
  oneToOne: 'oneToOne',
};
/** Attributes a simple condition can compare. */
export const CONDITION_TYPES = new Set([
  'string',
  'text',
  'email',
  'uid',
  'enumeration',
  'boolean',
  'integer',
  'biginteger',
  'float',
  'decimal',
  'date',
  'time',
  'datetime',
]);
export const LENGTH_TYPES = new Set(['string', 'text', 'richtext', 'email', 'password', 'uid']);
export const NUMBER_TYPES = new Set(['integer', 'biginteger', 'float', 'decimal']);
export const UNIQUE_TYPES = new Set([
  'string',
  'email',
  'integer',
  'biginteger',
  'float',
  'decimal',
  'date',
  'time',
  'datetime',
]);

export function kebab(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function camel(text: string): string {
  const words = kebab(text).split('-').filter(Boolean);
  return words
    .map((word, index) => (index ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join('');
}

/** Naive English plural, editable by the user. */
export function plural(name: string): string {
  if (/(s|x|z|ch|sh)$/.test(name)) return `${name}es`;
  if (/[^aeiou]y$/.test(name)) return `${name.slice(0, -1)}ies`;
  return `${name}s`;
}

/** Splits a message on backticks: odd segments are code. */
export function segments(text: string): string[] {
  return text.split('`');
}

export interface AttributeDraft {
  originalName: string | null;
  name: string;
  attribute: Attribute;
  /** For bidirectional relations: the attribute to create on the target. */
  inverseName: string;
}

export function isBidirectional(attribute: Attribute): boolean {
  return RELATIONS.find((relation) => relation.kind === attribute.relation)?.bidirectional ?? false;
}

/** Without `allowedTypes`, every kind of file is allowed. */
export function allowsMedia(attribute: Attribute, kind: MediaKind): boolean {
  return !attribute.allowedTypes || attribute.allowedTypes.includes(kind);
}

export function allowedMediaCount(attribute: Attribute): number {
  return attribute.allowedTypes?.length ?? MEDIA_KINDS.length;
}
