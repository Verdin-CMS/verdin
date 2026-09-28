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

export interface Plugin {
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  settings: Record<string, unknown>;
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
