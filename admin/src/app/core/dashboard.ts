import { Injectable, inject, signal } from '@angular/core';

import { Api } from './api';
import { ContentType } from './types';

/** Built-in widget kinds. Plugins will register more (see docs/roadmap.md). */
export type WidgetType = 'count' | 'recent' | 'list' | 'links' | 'system' | 'note' | 'poll';

/** Columns a widget spans on wide screens (the grid has 4). */
export type WidgetWidth = 1 | 2 | 3 | 4;

export type EntryStatus = 'all' | 'published';
export type ListSort = 'updatedAt:desc' | 'createdAt:desc' | 'title:asc' | 'votes:desc';

/** Operators offered for widget conditions (mapped to the API's `$eq`, `$ne`…). */
export type ConditionOp = 'eq' | 'ne' | 'containsi' | 'gt' | 'lt' | 'null' | 'notNull';

/** "Show entries whose `field` …": e.g. `status eq pending`. */
export interface WidgetCondition {
  field: string;
  op: ConditionOp;
  value?: string;
}

export interface WidgetConfig {
  /** Content type (count, list; optional for recent = every type). */
  uid?: string;
  status?: EntryStatus;
  sort?: ListSort;
  limit?: number;
  /** Case-insensitive match on the type's title field. */
  search?: string;
  /** Note text (plain text, rendered with line breaks). */
  text?: string;
  /** Every condition must hold. */
  conditions?: WidgetCondition[];
  /** Only entries the viewer has not opened since they last changed. */
  unseen?: boolean;
  /** Show and cast votes on each entry. */
  showVotes?: boolean;
  /** Poll widgets. */
  pollId?: number;
}

export interface Widget {
  id: string;
  type: WidgetType;
  /** Custom title; each type has a default. */
  title?: string;
  width: WidgetWidth;
  config: WidgetConfig;
}

export interface DashboardLayout {
  version: 1;
  widgets: Widget[];
}

export const WIDGET_WIDTHS: Record<WidgetType, WidgetWidth> = {
  count: 1,
  recent: 2,
  list: 2,
  links: 2,
  system: 1,
  note: 1,
  poll: 1,
};

const MAX_WIDGETS = 40;

export function newWidgetId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** The layout a user starts with: a counter per type (up to 4), recent changes, links, system. */
export function defaultLayout(types: ContentType[]): DashboardLayout {
  const counters: Widget[] = types
    .filter((type) => type.kind === 'collectionType')
    .slice(0, 4)
    .map((type) => ({ id: newWidgetId(), type: 'count', width: 1, config: { uid: type.uid } }));
  return {
    version: 1,
    widgets: [
      ...counters,
      { id: newWidgetId(), type: 'recent', width: 2, config: { limit: 8 } },
      { id: newWidgetId(), type: 'links', width: 1, config: {} },
      { id: newWidgetId(), type: 'system', width: 1, config: {} },
    ],
  };
}

/**
 * The signed-in user's dashboard, stored server side in their preferences so it follows
 * them across browsers. Every change is saved at once (writes are queued so they land in
 * order); other preference keys are preserved.
 */
@Injectable({ providedIn: 'root' })
export class Dashboard {
  private readonly api = inject(Api);

  /** `null` until loaded or when the user never customised it (use the default). */
  readonly layout = signal<DashboardLayout | null>(null);
  readonly loaded = signal(false);
  readonly saving = signal(false);

  private preferences: Record<string, unknown> = {};
  /** The last queued write; each waits for the previous one. */
  private writes: Promise<unknown> = Promise.resolve();

  async load(): Promise<void> {
    try {
      this.preferences =
        (await this.api.get<Record<string, unknown>>('/users/me/preferences')) ?? {};
      this.layout.set(sanitize(this.preferences['dashboard']));
    } catch {
      this.layout.set(null);
    }
    this.loaded.set(true);
  }

  /** Applies a change and saves it. */
  set(layout: DashboardLayout): Promise<void> {
    const next = { ...layout, widgets: layout.widgets.slice(0, MAX_WIDGETS) };
    this.layout.set(next);
    this.preferences = { ...this.preferences, dashboard: next };
    return this.write(this.preferences);
  }

  /** Back to the default layout (forgets the saved one). */
  reset(): Promise<void> {
    this.layout.set(null);
    const { dashboard: _removed, ...rest } = this.preferences;
    this.preferences = rest;
    return this.write(rest);
  }

  private write(preferences: Record<string, unknown>): Promise<void> {
    this.saving.set(true);
    const write = this.writes
      .catch(() => undefined)
      .then(() => this.api.put('/users/me/preferences', { data: preferences }))
      .then(() => undefined)
      .finally(() => {
        if (this.writes === write) this.saving.set(false);
      });
    this.writes = write;
    return write;
  }
}

const TYPES: WidgetType[] = ['count', 'recent', 'list', 'links', 'system', 'note', 'poll'];

/** Drops anything malformed from a stored layout (it is user-writable JSON). */
function sanitize(raw: unknown): DashboardLayout | null {
  if (!raw || typeof raw !== 'object') return null;
  const widgets = (raw as { widgets?: unknown }).widgets;
  if (!Array.isArray(widgets)) return null;
  const clean = widgets
    .filter(
      (widget): widget is Widget =>
        !!widget &&
        typeof widget === 'object' &&
        typeof widget.id === 'string' &&
        TYPES.includes(widget.type),
    )
    .map((widget) => ({
      id: widget.id,
      type: widget.type,
      title: typeof widget.title === 'string' ? widget.title : undefined,
      width: ([1, 2, 3, 4] as const).includes(widget.width)
        ? widget.width
        : WIDGET_WIDTHS[widget.type],
      config: widget.config && typeof widget.config === 'object' ? widget.config : {},
    }));
  return { version: 1, widgets: clean.slice(0, MAX_WIDGETS) };
}
