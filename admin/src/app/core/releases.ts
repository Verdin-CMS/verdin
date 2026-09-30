import { Injectable, inject } from '@angular/core';

import { Api, ListResponse } from './api';
import { PAGE_SIZE } from './paging';

export type ReleaseStatus = 'pending' | 'running' | 'done' | 'failed';
export type ReleaseActionKind = 'publish' | 'unpublish';
export type ReleaseActionStatus = 'pending' | 'done' | 'failed';

/** An entry to publish or unpublish with a release. */
export interface ReleaseAction {
  id: number;
  uid: string;
  documentId: string;
  /** Empty for types that are not localized. */
  locale: string;
  action: ReleaseActionKind;
  status: ReleaseActionStatus;
  error: string | null;
}

export interface Release {
  id: number;
  name: string;
  scheduledAt: string | null;
  status: ReleaseStatus;
  releasedAt: string | null;
  error: string | null;
  createdBy: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  actions: ReleaseAction[];
}

export interface ReleaseInput {
  name: string;
  /** ISO 8601; `null` for no schedule. */
  scheduledAt: string | null;
}

export interface ReleaseActionInput {
  uid: string;
  documentId: string;
  locale?: string | null;
  action: ReleaseActionKind;
}

/** Only pending releases can change; the others ran. */
export function isEditable(release: Pick<Release, 'status'>): boolean {
  return release.status === 'pending';
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** An ISO instant as the value of a `datetime-local` input (local time, minutes). */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** A `datetime-local` value as an ISO instant; `null` when empty or invalid. */
export function fromLocalInput(value: string | null | undefined): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec((value ?? '').trim());
  if (!match) return null;
  const [year, month, day, hours, minutes, seconds] = match
    .slice(1)
    .map((part) => Number(part ?? 0));
  const date = new Date(year, month - 1, day, hours, minutes, seconds || 0);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Releases by status: pending first (soonest scheduled first), then the most recent. */
export function sortReleases(releases: Release[]): Release[] {
  const rank = (release: Release) =>
    release.status === 'pending' ? 0 : release.status === 'running' ? 1 : 2;
  return [...releases].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank) return byRank;
    if (a.status === 'pending') {
      if (a.scheduledAt && b.scheduledAt) return a.scheduledAt.localeCompare(b.scheduledAt);
      if (a.scheduledAt || b.scheduledAt) return a.scheduledAt ? -1 : 1;
    }
    return b.id - a.id;
  });
}

/** Whether a release already has this entry (same locale). */
export function hasEntry(
  release: Release,
  uid: string,
  documentId: string,
  locale: string | null,
): ReleaseAction | undefined {
  return release.actions.find(
    (action) =>
      action.uid === uid &&
      action.documentId === documentId &&
      (action.locale || null) === (locale || null),
  );
}

/** Releases API (`releases.manage`); 404 while the `releases` feature is off. */
@Injectable({ providedIn: 'root' })
export class Releases {
  private readonly api = inject(Api);

  /** A page of releases, newest first, optionally with one status. */
  list(page: number, status?: ReleaseStatus, pageSize = PAGE_SIZE): Promise<ListResponse<Release>> {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (status) params.set('status', status);
    return this.api.list<Release>('/releases', params.toString());
  }

  /** Every release with `status`. */
  all(status: ReleaseStatus): Promise<Release[]> {
    return this.api.listAll<Release>('/releases', `status=${status}`);
  }

  get(id: number | string): Promise<Release> {
    return this.api.get<Release>(`/releases/${id}`);
  }

  create(input: ReleaseInput): Promise<Release> {
    return this.api.post<Release>('/releases', input);
  }

  update(id: number, input: ReleaseInput): Promise<Release> {
    return this.api.put<Release>(`/releases/${id}`, input);
  }

  remove(id: number): Promise<void> {
    return this.api.delete(`/releases/${id}`);
  }

  addAction(id: number, input: ReleaseActionInput): Promise<Release> {
    const body: ReleaseActionInput = { ...input };
    if (!body.locale) delete body.locale;
    return this.api.post<Release>(`/releases/${id}/actions`, body);
  }

  removeAction(id: number, actionId: number): Promise<Release> {
    return this.api.request<Release>('DELETE', `/releases/${id}/actions/${actionId}`);
  }

  publish(id: number): Promise<Release> {
    return this.api.post<Release>(`/releases/${id}/publish`);
  }

  /** Releases containing an entry (empty without `releases.manage`). */
  forEntry(uid: string, documentId: string): Promise<Release[]> {
    return this.api.get<Release[]>(`/content/${uid}/${documentId}/releases`);
  }
}
