import { Injectable, inject, signal } from '@angular/core';

import { Api, toQuery } from './api';

/** One version of a document that references an entry or a file, and where (`…/usage`). */
export interface Usage {
  uid: string;
  documentId: string;
  locale?: string | null;
  status: 'draft' | 'published';
  /** Attribute path (`category`, `seo.image`, `blocks.2.gallery`). */
  field: string;
  /** The version's first text attribute. */
  title?: string | null;
}

/** The usages the admin may read, and how many others there are. */
export interface UsageResult {
  data: Usage[];
  hidden: number;
}

/** One referencing entry (one locale of a document): its versions merged. */
export interface UsageEntry {
  uid: string;
  documentId: string;
  locale: string | null;
  title: string | null;
  /** Attribute paths, in the order found. */
  fields: string[];
  /** `draft` first. */
  statuses: Usage['status'][];
}

/** The referencing entries of one content type. */
export interface UsageGroup {
  uid: string;
  entries: UsageEntry[];
}

const entryKey = (usage: Pick<Usage, 'uid' | 'documentId' | 'locale'>) =>
  `${usage.uid}\u0000${usage.documentId}\u0000${usage.locale ?? ''}`;

/**
 * Usages grouped by type, then by entry (a document in one locale): a document referencing
 * the target from several fields, or from its draft and its published version, is listed
 * once. Groups are sorted by `label` (the type's name), entries keep the server's order.
 */
export function groupUsages(
  usages: readonly Usage[],
  label: (uid: string) => string = (uid) => uid,
): UsageGroup[] {
  const groups = new Map<string, UsageGroup>();
  const entries = new Map<string, UsageEntry>();
  for (const usage of usages) {
    const key = entryKey(usage);
    let entry = entries.get(key);
    if (!entry) {
      entry = {
        uid: usage.uid,
        documentId: usage.documentId,
        locale: usage.locale ?? null,
        title: null,
        fields: [],
        statuses: [],
      };
      entries.set(key, entry);
      let group = groups.get(usage.uid);
      if (!group) {
        group = { uid: usage.uid, entries: [] };
        groups.set(usage.uid, group);
      }
      group.entries.push(entry);
    }
    const title = usage.title?.trim();
    // The draft names the entry; the published title when there is no other.
    if (title && (!entry.title || usage.status === 'draft')) entry.title = title;
    if (!entry.fields.includes(usage.field)) entry.fields.push(usage.field);
    if (!entry.statuses.includes(usage.status)) {
      entry.statuses.push(usage.status);
      entry.statuses.sort((a, b) => (a === b ? 0 : a === 'draft' ? -1 : 1));
    }
  }
  return [...groups.values()].sort((a, b) => label(a.uid).localeCompare(label(b.uid)));
}

/** How many entries `result` names (not counting the hidden versions). */
export function usageEntryCount(result: UsageResult): number {
  return new Set(result.data.map(entryKey)).size;
}

/** The first `max` referencing entries, type by type. */
export function firstPlaces(
  result: UsageResult,
  max = 3,
  label?: (uid: string) => string,
): UsageEntry[] {
  return groupUsages(result.data, label)
    .flatMap((group) => group.entries)
    .slice(0, max);
}

/**
 * Several lookups as one (bulk deletes): identical usages once, `exclude`d ones (entries
 * deleted in the same go) left out, hidden counts added up.
 */
export function mergeUsages(
  results: readonly UsageResult[],
  exclude: (usage: Usage) => boolean = () => false,
): UsageResult {
  const seen = new Set<string>();
  const data: Usage[] = [];
  let hidden = 0;
  for (const result of results) {
    hidden += result.hidden;
    for (const usage of result.data) {
      if (exclude(usage)) continue;
      const key = `${entryKey(usage)}\u0000${usage.status}\u0000${usage.field}`;
      if (seen.has(key)) continue;
      seen.add(key);
      data.push(usage);
    }
  }
  return { data, hidden };
}

/** A usage lookup in progress, done or failed, for a delete confirmation. */
export type UsageState =
  { status: 'loading' } | { status: 'done'; result: UsageResult } | { status: 'error' };

/** Lookups kept in flight at once when checking several targets. */
const CONCURRENCY = 4;

/** Where entries and files are used (`…/usage` endpoints). */
@Injectable({ providedIn: 'root' })
export class Usages {
  private readonly api = inject(Api);

  async forEntry(uid: string, documentId: string, locale: string | null): Promise<UsageResult> {
    const query = toQuery({ locale }) || undefined;
    return this.read(`/content/${uid}/${documentId}/usage`, query);
  }

  forFile(id: number): Promise<UsageResult> {
    return this.read(`/upload/files/${id}/usage`);
  }

  /** Looks `items` up a few at a time and merges the answers (see `mergeUsages`). */
  async many<T>(
    items: readonly T[],
    lookup: (item: T) => Promise<UsageResult>,
    exclude?: (usage: Usage) => boolean,
  ): Promise<UsageResult> {
    const results: UsageResult[] = [];
    let next = 0;
    const worker = async () => {
      while (next < items.length) results.push(await lookup(items[next++]));
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
    return mergeUsages(results, exclude);
  }

  private async read(path: string, query?: string): Promise<UsageResult> {
    const response = await this.api.getWithMeta<Usage[], { hidden?: number }>(path, query);
    return { data: response.data ?? [], hidden: response.meta?.hidden ?? 0 };
  }
}

/** The usage check of a delete dialog: newer checks replace older answers. */
export class UsageProbe {
  readonly state = signal<UsageState | null>(null);
  private run = 0;

  async start(lookup: () => Promise<UsageResult>): Promise<void> {
    const current = ++this.run;
    this.state.set({ status: 'loading' });
    try {
      const result = await lookup();
      if (current === this.run) this.state.set({ status: 'done', result });
    } catch {
      if (current === this.run) this.state.set({ status: 'error' });
    }
  }

  reset(): void {
    this.run++;
    this.state.set(null);
  }
}
