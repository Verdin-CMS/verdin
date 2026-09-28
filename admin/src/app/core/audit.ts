import { Injectable, inject } from '@angular/core';

import { Api, ListResponse } from './api';

/** Who did it: an admin (`id`), an API token or public request (`api`), or the server. */
export interface AuditActor {
  kind: string | null;
  id: number | null;
  email: string | null;
  name: string | null;
}

/** An audit log entry (`GET /audit-logs`). */
export interface AuditEntry {
  id: number;
  at: string | null;
  /** `entry.publish`, `media.create`, `admin.login`, `PUT /roles/{id}`… */
  action: string;
  subject: string | null;
  subjectId: string | null;
  details: Record<string, unknown>;
  ip: string | null;
  actor: AuditActor;
}

/** The filters of the audit logs page; empty strings mean "any". */
export interface AuditFilters {
  /** An exact action, or a prefix ending with `*`. */
  action: string;
  /** An admin user id. */
  actor: string;
  subject: string;
  /** `YYYY-MM-DD` (local day). */
  from: string;
  to: string;
}

export const EMPTY_AUDIT_FILTERS: AuditFilters = {
  action: '',
  actor: '',
  subject: '',
  from: '',
  to: '',
};

/** Common action filters offered next to the free text. */
export const AUDIT_ACTION_PRESETS = ['entry.*', 'media.*', 'admin.login'] as const;

/** The start (`end: false`) or end of a local day as an ISO instant; `null` when invalid. */
export function dayBoundary(day: string, end: boolean): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim());
  if (!match) return null;
  const [year, month, date] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  const value = end
    ? new Date(year, month, date, 23, 59, 59, 999)
    : new Date(year, month, date, 0, 0, 0, 0);
  return Number.isNaN(value.getTime()) ? null : value.toISOString();
}

/** The query string of a page of audit logs. */
export function auditQuery(filters: AuditFilters, page: number, pageSize: number): string {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('pageSize', String(pageSize));
  const action = filters.action.trim();
  if (action) params.set('action', action);
  const actor = filters.actor.trim();
  if (/^\d+$/.test(actor)) params.set('actor', actor);
  const subject = filters.subject.trim();
  if (subject) params.set('subject', subject);
  const from = filters.from ? dayBoundary(filters.from, false) : null;
  if (from) params.set('from', from);
  const to = filters.to ? dayBoundary(filters.to, true) : null;
  if (to) params.set('to', to);
  return params.toString();
}

/** Whether any filter is set. */
export function hasAuditFilters(filters: AuditFilters): boolean {
  return Object.values(filters).some((value) => value.trim() !== '');
}

/** The part of an action shown as its category: `entry`, `media`, `admin`, or the HTTP method. */
export function actionCategory(action: string): string {
  const method = /^(GET|POST|PUT|PATCH|DELETE)\s/.exec(action);
  if (method) return method[1];
  return action.split('.')[0] ?? action;
}

/** Settings → Audit logs API (`audit.read`). */
@Injectable({ providedIn: 'root' })
export class AuditLogs {
  private readonly api = inject(Api);

  list(filters: AuditFilters, page: number, pageSize: number): Promise<ListResponse<AuditEntry>> {
    return this.api.list<AuditEntry>('/audit-logs', auditQuery(filters, page, pageSize));
  }
}
