import { Injectable, inject } from '@angular/core';

import { Api } from './api';

/** What a plugin may do beyond its own sandbox. */
export interface PluginCapabilities {
  /** Content type uids it may read (`*`: all). */
  read: string[];
  /** Content type uids it may create, update, publish and delete (implies read). */
  write: string[];
  /** Hosts it may call. */
  http: string[];
  /** Its own key-value storage. */
  kv: boolean;
}

export interface PluginHook {
  on: string;
  uid: string;
  function: string;
}

export interface PluginJob {
  schedule: string;
  function: string;
}

/** A dashboard widget a plugin's admin script defines. */
export interface PluginWidgetDef {
  id: string;
  title: string;
  element: string;
  description?: string;
}

/** A custom field a plugin's admin script defines; `type` is the storage type. */
export interface PluginFieldDef {
  id: string;
  title: string;
  element: string;
  type: string;
  description?: string;
}

export type PluginSettingType =
  'string' | 'text' | 'url' | 'number' | 'integer' | 'boolean' | 'select';

/** A field of a plugin's settings form (`[[settings]]` in its manifest). */
export interface PluginSettingField {
  key: string;
  label: string;
  type: PluginSettingType;
  description?: string | null;
  required: boolean;
  /** The choices of a `select`. */
  options: string[];
  default: unknown;
  /** Bounds of numbers, lengths of strings. */
  min: number | null;
  max: number | null;
}

export interface Plugin {
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  settings: Record<string, unknown>;
  /** Without fields, settings are free JSON. */
  settingsForm?: PluginSettingField[];
  capabilities: PluginCapabilities;
  limits: { timeout_ms: number; memory_mb: number };
  hooks: PluginHook[];
  /** Path under the content API prefix, e.g. `/plugins/sample`. */
  routes: string | null;
  jobs: PluginJob[];
  admin: { script: string | null; widgets: PluginWidgetDef[]; fields: PluginFieldDef[] };
}

/** A plugin directory that could not be loaded. */
export interface PluginLoadError {
  dir: string;
  error: string;
}

export interface PluginLog {
  at: string;
  level: string;
  message: string;
}

/** An enabled plugin's admin extensions (`GET /plugins/extensions`). */
export interface PluginExtension {
  plugin: string;
  script: string;
  widgets: PluginWidgetDef[];
  fields: PluginFieldDef[];
}

/** A line of a plugin's access summary; `risky` for writes and outbound HTTP. */
export interface CapabilityGroup {
  kind: 'read' | 'write' | 'http' | 'kv';
  items: string[];
  risky: boolean;
}

/**
 * The access a plugin asks for, riskiest first. Types it may write are left out of the
 * read list (writing implies reading); empty groups are dropped.
 */
export function capabilityGroups(capabilities: Partial<PluginCapabilities> | null | undefined) {
  const write = [...new Set(capabilities?.write ?? [])];
  const read = [...new Set(capabilities?.read ?? [])].filter(
    (uid) => !write.includes(uid) && !write.includes('*'),
  );
  const http = [...new Set(capabilities?.http ?? [])];
  const groups: CapabilityGroup[] = [];
  if (write.length) groups.push({ kind: 'write', items: write, risky: true });
  if (http.length) groups.push({ kind: 'http', items: http, risky: true });
  if (read.length) groups.push({ kind: 'read', items: read, risky: false });
  if (capabilities?.kv) groups.push({ kind: 'kv', items: [], risky: false });
  return groups;
}

/** `plugin::<plugin>.<field>` → its parts; `null` when malformed or absent. */
export function parseCustomField(
  value: string | null | undefined,
): { plugin: string; field: string } | null {
  const match = /^plugin::([^.\s]+)\.([^\s]+)$/.exec(value ?? '');
  return match ? { plugin: match[1], field: match[2] } : null;
}

export function customFieldId(plugin: string, field: string): string {
  return `plugin::${plugin}.${field}`;
}

/** The absolute URL of a plugin's routes. */
export function pluginRouteUrl(contentApiBase: string, route: string, baseUri: string): string {
  const base = contentApiBase.replace(/\/+$/, '');
  const path = route.startsWith('/') ? route : `/${route}`;
  try {
    return new URL(`${base}${path}`, baseUri).href;
  } catch {
    return `${base}${path}`;
  }
}

/** Parses the settings editor's text: a JSON object, or an error message. */
export function parseSettings(
  text: string,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (!text.trim()) return { ok: true, value: {} };
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, error: 'object' };
    }
    return { ok: true, value: value as Record<string, unknown> };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** A form value: text for inputs (numbers too), a boolean for switches. */
export type SettingValue = string | boolean;

/** The form's values: stored settings, else the declared defaults. */
export function settingsFormValues(
  fields: PluginSettingField[],
  settings: Record<string, unknown> | null | undefined,
): Record<string, SettingValue> {
  const values: Record<string, SettingValue> = {};
  for (const field of fields) {
    const stored = settings?.[field.key];
    const value = stored === undefined || stored === null ? field.default : stored;
    if (field.type === 'boolean') values[field.key] = value === true;
    else values[field.key] = value === undefined || value === null ? '' : String(value);
  }
  return values;
}

export type SettingProblem =
  | { kind: 'required' }
  | { kind: 'number' }
  | { kind: 'integer' }
  | { kind: 'url' }
  | { kind: 'option' }
  | { kind: 'min' | 'max'; bound: number; length: boolean };

function isEmpty(value: SettingValue | undefined): boolean {
  return value === undefined || (typeof value === 'string' && value.trim() === '');
}

/** The problem of one value, mirroring the server's checks; `null` when it fits. */
export function settingProblem(
  field: PluginSettingField,
  value: SettingValue | undefined,
): SettingProblem | null {
  if (field.type === 'boolean') return null;
  const text = typeof value === 'string' ? value : '';
  if (isEmpty(value)) {
    return field.required && (field.default === null || field.default === undefined)
      ? { kind: 'required' }
      : null;
  }
  const bounds = (number: number, length: boolean): SettingProblem | null => {
    if (field.min !== null && field.min !== undefined && number < field.min)
      return { kind: 'min', bound: field.min, length };
    if (field.max !== null && field.max !== undefined && number > field.max)
      return { kind: 'max', bound: field.max, length };
    return null;
  };
  switch (field.type) {
    case 'string':
    case 'text':
      return bounds([...text].length, true);
    case 'url': {
      try {
        const url = new URL(text.trim());
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return { kind: 'url' };
      } catch {
        return { kind: 'url' };
      }
      return null;
    }
    case 'number':
    case 'integer': {
      const number = Number(text.trim());
      if (!Number.isFinite(number)) return { kind: 'number' };
      if (field.type === 'integer' && !Number.isInteger(number)) return { kind: 'integer' };
      return bounds(number, false);
    }
    case 'select':
      return field.options.includes(text) ? null : { kind: 'option' };
  }
  return null;
}

/** The settings object to save: typed values, empty ones left out (defaults then apply). */
export function settingsFromForm(
  fields: PluginSettingField[],
  values: Record<string, SettingValue>,
): Record<string, unknown> {
  const settings: Record<string, unknown> = {};
  for (const field of fields) {
    const value = values[field.key];
    if (field.type === 'boolean') {
      settings[field.key] = value === true;
      continue;
    }
    if (isEmpty(value)) continue;
    const text = String(value);
    settings[field.key] =
      field.type === 'number' || field.type === 'integer'
        ? Number(text.trim())
        : field.type === 'url'
          ? text.trim()
          : text;
  }
  return settings;
}

/** Settings → Plugins API. */
@Injectable({ providedIn: 'root' })
export class Plugins {
  private readonly api = inject(Api);

  list(): Promise<{ plugins: Plugin[]; errors: PluginLoadError[] }> {
    return this.api.get('/plugins');
  }

  update(name: string, input: { enabled: boolean; settings?: Record<string, unknown> }) {
    return this.api.put<Plugin>(`/plugins/${encodeURIComponent(name)}`, input);
  }

  logs(name: string): Promise<PluginLog[]> {
    return this.api.get(`/plugins/${encodeURIComponent(name)}/logs`);
  }

  extensions(): Promise<PluginExtension[]> {
    return this.api.get('/plugins/extensions');
  }
}
