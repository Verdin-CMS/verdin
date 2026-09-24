/** Shapes of the Verdin admin API (see docs/architecture.md §13). */

export type AttributeType =
  | 'string'
  | 'email'
  | 'text'
  | 'richtext'
  | 'uid'
  | 'integer'
  | 'biginteger'
  | 'float'
  | 'decimal'
  | 'boolean'
  | 'date'
  | 'time'
  | 'datetime'
  | 'enumeration'
  | 'json'
  | 'relation'
  | 'component'
  | 'dynamiczone';

export type RelationKind =
  'oneToOne' | 'oneToMany' | 'manyToOne' | 'manyToMany' | 'oneWay' | 'manyWay';

/** An attribute in the schema file format. */
export interface Attribute {
  type: AttributeType;
  required?: boolean;
  private?: boolean;
  configurable?: boolean;
  default?: unknown;
  unique?: boolean;
  minLength?: number;
  maxLength?: number;
  regex?: string;
  targetField?: string;
  min?: number;
  max?: number;
  precision?: number;
  scale?: number;
  enum?: string[];
  relation?: RelationKind;
  target?: string;
  inversedBy?: string;
  mappedBy?: string;
  component?: string;
  repeatable?: boolean;
  components?: string[];
}

export type Attributes = Record<string, Attribute>;

export interface ContentType {
  uid: string;
  kind: 'collectionType' | 'singleType';
  singularName: string;
  pluralName: string;
  displayName: string;
  description?: string | null;
  draftAndPublish: boolean;
  attributes: Attributes;
}

export interface Component {
  uid: string;
  category: string;
  displayName: string;
  description?: string | null;
  icon?: string | null;
  attributes: Attributes;
}

export interface RoleSummary {
  id: number;
  code: string;
  name: string;
}

export interface AdminUser {
  id: number;
  email: string;
  firstname: string | null;
  lastname: string | null;
  isActive: boolean;
  roles: RoleSummary[];
  createdAt: string;
  updatedAt: string;
}

export interface Permission {
  action: string;
  subject?: string;
  conditions?: string[];
}

export interface PermissionSet {
  superAdmin: boolean;
  permissions: Permission[];
}

export interface Role extends RoleSummary {
  description: string | null;
  builtin: boolean;
  permissions: Permission[];
}

export type TokenKind = 'read-only' | 'full-access' | 'custom';

export interface Grant {
  subject: string;
  action: string;
}

export interface ApiToken {
  id: number;
  name: string;
  description: string | null;
  kind: TokenKind;
  tokenPrefix: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  permissions: Grant[];
  /** Only in the creation response. */
  accessKey?: string;
}

export interface SystemInfo {
  version: string;
  database: string;
  mode: 'production' | 'development';
}

/** A content document: `id`, `documentId`, attributes, timestamps. */
export type Document = Record<string, unknown> & {
  id: number;
  documentId: string;
  createdAt?: string;
  updatedAt?: string;
  publishedAt?: string | null;
};

export interface PageMeta {
  page?: number;
  pageSize?: number;
  pageCount?: number;
  start?: number;
  limit?: number;
  total?: number;
}

export interface PlanStep {
  description: string;
  risk: 'safe' | 'risky' | 'destructive';
  statements: string[];
}

export interface SchemaPlan {
  valid: boolean;
  errors?: { file: string; path: string; message: string }[];
  steps?: PlanStep[];
  requires?: 'safe' | 'risky' | 'destructive';
  hints?: string[];
  interrupted?: boolean;
}

/** Content API actions for public grants and custom tokens. */
export const CONTENT_ACTIONS = [
  'find',
  'findOne',
  'create',
  'update',
  'delete',
  'publish',
  'readDrafts',
] as const;

/** Admin content actions (subject: a content type uid or `*`). */
export const ADMIN_CONTENT_ACTIONS = [
  'content.read',
  'content.create',
  'content.update',
  'content.delete',
  'content.publish',
] as const;

export const ADMIN_SETTINGS_ACTIONS = [
  'users.manage',
  'roles.manage',
  'tokens.manage',
  'schema.manage',
] as const;
