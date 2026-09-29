import { Injectable, inject, signal } from '@angular/core';

import { RUNTIME_CONFIG } from './api';
import { Auth } from './auth';
import {
  PluginExtension,
  PluginFieldDef,
  PluginWidgetDef,
  Plugins,
  parseCustomField,
} from './plugins';

/** A widget of a loaded plugin script. */
export type PluginWidget = PluginWidgetDef & { plugin: string };
/** A custom field of a loaded plugin script. */
export type PluginField = PluginFieldDef & { plugin: string };

/** What a plugin widget element receives as its `context` property. */
export interface PluginContext {
  /** The content API base (e.g. `/api`). */
  apiBase: string;
  /** The admin API base (e.g. `/admin/api`). */
  adminApiBase: string;
  /**
   * `fetch` for the admin API with the admin's credentials; relative paths resolve against
   * `adminApiBase`. Content API paths (under `apiBase`, plugin routes included) are sent
   * without them: the content API does not accept admin sessions.
   */
  fetch: (path: string, init?: RequestInit) => Promise<Response>;
}

export type ModuleImporter = (url: string) => Promise<unknown>;

/**
 * Imports each module URL at most once: concurrent and later calls share the first import.
 * A failed import is logged and forgotten, so a later call tries again.
 */
export function createModuleLoader(
  importer: ModuleImporter,
  log: (message: string, error: unknown) => void = () => undefined,
): (url: string) => Promise<boolean> {
  const imports = new Map<string, Promise<boolean>>();
  return (url) => {
    let pending = imports.get(url);
    if (!pending) {
      pending = importer(url).then(
        () => true,
        (error: unknown) => {
          imports.delete(url);
          log(`Could not load plugin script ${url}`, error);
          return false;
        },
      );
      imports.set(url, pending);
    }
    return pending;
  };
}

/**
 * The widgets and fields of the extensions whose script loaded and whose elements exist,
 * without duplicates (first wins, by plugin and id).
 */
export function collectExtensions(
  extensions: PluginExtension[],
  loaded: (extension: PluginExtension) => boolean,
  defined: (element: string) => boolean,
): { widgets: PluginWidget[]; fields: PluginField[] } {
  const widgets = new Map<string, PluginWidget>();
  const fields = new Map<string, PluginField>();
  for (const extension of extensions) {
    if (!loaded(extension)) continue;
    for (const widget of extension.widgets ?? []) {
      const key = `${extension.plugin}.${widget.id}`;
      if (!widgets.has(key) && defined(widget.element)) {
        widgets.set(key, { ...widget, plugin: extension.plugin });
      }
    }
    for (const field of extension.fields ?? []) {
      const key = `${extension.plugin}.${field.id}`;
      if (!fields.has(key) && defined(field.element)) {
        fields.set(key, { ...field, plugin: extension.plugin });
      }
    }
  }
  return { widgets: [...widgets.values()], fields: [...fields.values()] };
}

/**
 * Where a plugin's `fetch(path)` goes: absolute URLs and paths already under one of the
 * API bases are kept; anything else is relative to the admin API.
 */
export function resolvePluginPath(path: string, adminApiBase: string, apiBase: string): string {
  if (/^[a-z][a-z\d+.-]*:/i.test(path)) return path;
  if (isUnder(path, adminApiBase) || isUnder(path, apiBase)) return path;
  return `${adminApiBase.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

/** Whether `path` is `base` or below it. */
function isUnder(path: string, base: string): boolean {
  const clean = base.replace(/\/+$/, '');
  if (!clean || !path.startsWith(clean)) return false;
  const rest = path.slice(clean.length);
  return rest === '' || /^[/?#]/.test(rest);
}

/** Waits (up to `timeout` ms) for a custom element to be defined. */
function whenDefined(element: string, timeout: number): Promise<boolean> {
  if (typeof customElements === 'undefined') return Promise.resolve(false);
  try {
    if (customElements.get(element)) return Promise.resolve(true);
    return Promise.race([
      customElements.whenDefined(element).then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeout)),
    ]);
  } catch {
    // Not a valid custom element name.
    return Promise.resolve(false);
  }
}

const importModule: ModuleImporter = (url) => import(/* @vite-ignore */ url);

/**
 * Admin extensions of the enabled plugins: their scripts are imported once (same-origin ES
 * modules that define custom elements), and their widgets and fields are exposed as signals.
 * Failures are logged and leave the plugin out.
 */
@Injectable({ providedIn: 'root' })
export class PluginExtensions {
  private readonly plugins = inject(Plugins);
  private readonly auth = inject(Auth);
  private readonly config = inject(RUNTIME_CONFIG);

  readonly widgets = signal<PluginWidget[]>([]);
  readonly fields = signal<PluginField[]>([]);
  /** Whether the list was fetched at least once (with or without extensions). */
  readonly loaded = signal(false);

  private readonly importScript = createModuleLoader(importModule, (message, error) =>
    console.warn(message, error),
  );
  private loading: Promise<void> | null = null;
  private again = false;

  /** Fetches the extensions and imports new scripts. Calls during a load queue one more. */
  load(): Promise<void> {
    if (this.loading) {
      this.again = true;
      return this.loading;
    }
    this.loading = (async () => {
      do {
        this.again = false;
        await this.fetch();
      } while (this.again);
    })().finally(() => (this.loading = null));
    return this.loading;
  }

  private async fetch(): Promise<void> {
    let extensions: PluginExtension[];
    try {
      extensions = (await this.plugins.extensions()) ?? [];
    } catch (error) {
      console.warn('Could not list plugin extensions', error);
      this.loaded.set(true);
      return;
    }
    const scripts = new Map<string, boolean>();
    await Promise.all(
      extensions.map(async (extension) => {
        scripts.set(
          extension.script,
          !!extension.script && (await this.importScript(extension.script)),
        );
      }),
    );
    const elements = new Map<string, boolean>();
    const names = extensions
      .filter((extension) => scripts.get(extension.script))
      .flatMap((extension) => [...(extension.widgets ?? []), ...(extension.fields ?? [])])
      .map((item) => item.element);
    await Promise.all(
      [...new Set(names)].map(async (name) => elements.set(name, await whenDefined(name, 3000))),
    );
    for (const [name, ok] of elements) {
      if (!ok) console.warn(`Plugin element <${name}> is not defined`);
    }
    const { widgets, fields } = collectExtensions(
      extensions,
      (extension) => !!scripts.get(extension.script),
      (element) => !!elements.get(element),
    );
    this.widgets.set(widgets);
    this.fields.set(fields);
    this.loaded.set(true);
  }

  /** The loaded field for `plugin::<plugin>.<id>`, if any. */
  field(customField: string | null | undefined): PluginField | undefined {
    const parsed = parseCustomField(customField);
    if (!parsed) return undefined;
    return this.fields().find(
      (field) => field.plugin === parsed.plugin && field.id === parsed.field,
    );
  }

  widget(plugin: string | undefined, id: string | undefined): PluginWidget | undefined {
    return this.widgets().find((widget) => widget.plugin === plugin && widget.id === id);
  }

  /** The `context` property of plugin widget elements. */
  context(): PluginContext {
    const adminApiBase = this.config.apiBase;
    const apiBase = this.config.contentApiBase;
    return {
      apiBase,
      adminApiBase,
      fetch: (path, init) => {
        const url = resolvePluginPath(path, adminApiBase, apiBase);
        return isUnder(url, apiBase) && !isUnder(url, adminApiBase)
          ? fetch(url, init)
          : this.auth.fetch(url, init);
      },
    };
  }
}
