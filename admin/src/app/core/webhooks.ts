import { Injectable, inject } from '@angular/core';

import { Api, ListResponse } from './api';

export type DeliveryStatus = 'pending' | 'sending' | 'succeeded' | 'failed';

/** One entry of a webhook's delivery log. */
export interface Delivery {
  id: number;
  event: string;
  payload: unknown;
  status: DeliveryStatus;
  attempts: number;
  nextAttemptAt: string | null;
  responseStatus: number | null;
  responseBody: string | null;
  error: string | null;
  durationMs: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface Webhook {
  id: number;
  name: string;
  url: string;
  headers: Record<string, string>;
  events: string[];
  /** Content type uids; empty means every type. */
  contentTypes: string[];
  signed: boolean;
  enabled: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  lastDelivery?: Delivery | null;
}

/** A webhook just created: `secret` is returned this once. */
export type CreatedWebhook = Webhook & { secret: string | null };

/** The outcome of a test event or a retry. */
export interface Attempt {
  deliveryId: number;
  ok: boolean;
  statusCode: number | null;
  body: string | null;
  error: string | null;
  durationMs: number;
}

/** Body of `POST /webhooks` (`signed` is create only) and `PUT /webhooks/{id}`. */
export interface WebhookInput {
  name: string;
  url: string;
  headers: Record<string, string>;
  events: string[];
  contentTypes: string[];
  enabled: boolean;
  signed?: boolean;
}

/** A custom header in the editor. */
export interface HeaderRow {
  name: string;
  value: string;
}

export const ENTRY_EVENTS = [
  'entry.create',
  'entry.update',
  'entry.delete',
  'entry.publish',
  'entry.unpublish',
  'entry.discard-draft',
] as const;

export const MEDIA_EVENTS = ['media.create', 'media.update', 'media.delete'] as const;

export const EVENTS: readonly string[] = [...ENTRY_EVENTS, ...MEDIA_EVENTS];

/** Headers Verdin sets on every delivery; the server rejects them. */
const RESERVED_HEADERS = [
  'content-type',
  'content-length',
  'host',
  'transfer-encoding',
  'connection',
];

export function isReservedHeader(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return RESERVED_HEADERS.includes(lower) || lower.startsWith('x-verdin-');
}

/** Editor rows for stored headers, sorted by name. */
export function headerRows(headers: Record<string, string> | null | undefined): HeaderRow[] {
  return Object.entries(headers ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => ({ name, value }));
}

/** The first problem with the header rows, or null. Rows without a name are ignored. */
export function headerProblem(
  rows: HeaderRow[],
): { kind: 'reserved' | 'duplicate'; name: string } | null {
  const seen = new Set<string>();
  for (const row of rows) {
    const name = row.name.trim().toLowerCase();
    if (!name) continue;
    if (isReservedHeader(name)) return { kind: 'reserved', name };
    if (seen.has(name)) return { kind: 'duplicate', name };
    seen.add(name);
  }
  return null;
}

/** Header rows as the API takes them: names trimmed and lower-cased, empty rows dropped. */
export function headersFromRows(rows: HeaderRow[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const row of rows) {
    const name = row.name.trim().toLowerCase();
    if (name) headers[name] = row.value;
  }
  return headers;
}

/** The editor's state. */
export interface WebhookForm {
  name: string;
  url: string;
  events: string[];
  /** Empty means every content type. */
  contentTypes: string[];
  headers: HeaderRow[];
  enabled: boolean;
  signed: boolean;
}

/** The request body for the form; `signed` only when creating. */
export function webhookInput(form: WebhookForm, creating: boolean): WebhookInput {
  const input: WebhookInput = {
    name: form.name.trim(),
    url: form.url.trim(),
    headers: headersFromRows(form.headers),
    events: EVENTS.filter((event) => form.events.includes(event)),
    contentTypes: [...new Set(form.contentTypes)].sort(),
    enabled: form.enabled,
  };
  if (creating) input.signed = form.signed;
  return input;
}

/** The form for a stored webhook (or a new one). */
export function webhookForm(webhook?: Webhook | null): WebhookForm {
  return {
    name: webhook?.name ?? '',
    url: webhook?.url ?? '',
    events: webhook ? [...webhook.events] : [...ENTRY_EVENTS],
    contentTypes: webhook ? [...webhook.contentTypes] : [],
    headers: headerRows(webhook?.headers),
    enabled: webhook?.enabled ?? true,
    signed: webhook?.signed ?? true,
  };
}

/** Adds or removes `events` from `selection`, keeping the catalog order. */
export function toggleEvents(
  selection: string[],
  events: readonly string[],
  on: boolean,
): string[] {
  const set = new Set(selection);
  for (const event of events) {
    if (on) set.add(event);
    else set.delete(event);
  }
  return EVENTS.filter((event) => set.has(event));
}

/** Pretty JSON for the log; strings that hold JSON are parsed first. */
export function prettyJson(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
}

/** Settings → Webhooks API. */
@Injectable({ providedIn: 'root' })
export class Webhooks {
  private readonly api = inject(Api);

  async list(): Promise<{ webhooks: Webhook[]; events: string[] }> {
    const response = (await this.api.list<Webhook>('/webhooks')) as ListResponse<Webhook> & {
      meta: { events?: string[] };
    };
    return { webhooks: response.data, events: response.meta.events ?? [...EVENTS] };
  }

  get(id: number | string): Promise<Webhook> {
    return this.api.get<Webhook>(`/webhooks/${id}`);
  }

  create(input: WebhookInput): Promise<CreatedWebhook> {
    return this.api.post<CreatedWebhook>('/webhooks', input);
  }

  update(id: number, input: WebhookInput): Promise<Webhook> {
    return this.api.put<Webhook>(`/webhooks/${id}`, input);
  }

  /** Switches a webhook on or off, keeping everything else. */
  setEnabled(webhook: Webhook, enabled: boolean): Promise<Webhook> {
    return this.update(webhook.id, {
      name: webhook.name,
      url: webhook.url,
      headers: webhook.headers,
      events: webhook.events,
      contentTypes: webhook.contentTypes,
      enabled,
    });
  }

  remove(id: number): Promise<void> {
    return this.api.delete(`/webhooks/${id}`);
  }

  async rotateSecret(id: number): Promise<string> {
    return (await this.api.post<{ secret: string }>(`/webhooks/${id}/secret`)).secret;
  }

  removeSecret(id: number): Promise<Webhook> {
    return this.api.request<Webhook>('DELETE', `/webhooks/${id}/secret`);
  }

  trigger(id: number): Promise<Attempt> {
    return this.api.post<Attempt>(`/webhooks/${id}/trigger`);
  }

  deliveries(id: number, page: number, pageSize: number): Promise<ListResponse<Delivery>> {
    return this.api.list<Delivery>(
      `/webhooks/${id}/deliveries`,
      `page=${page}&pageSize=${pageSize}`,
    );
  }

  retry(deliveryId: number): Promise<Attempt> {
    return this.api.post<Attempt>(`/webhooks/deliveries/${deliveryId}/retry`);
  }
}
