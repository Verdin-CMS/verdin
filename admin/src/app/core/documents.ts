import { Injectable, inject } from '@angular/core';

import { Api, ListResponse, toQuery } from './api';
import { LocaleVersion } from './content-locales';
import { Document } from './types';

/** A publication action on one locale version of a document. */
export type DocumentAction = 'publish' | 'unpublish' | 'discard-draft';

/** Which version of a document a read returns, and how much of it. */
export interface DocumentRead {
  /** The locale version (localized types; the default locale otherwise). */
  locale?: string | null;
  /** `draft` (the latest edits) or `published` (the live version). */
  status?: 'draft' | 'published';
  /** `*`: relations, media and components one level deep. */
  populate?: '*';
  /** Only these fields (plus the ids). */
  fields?: string | readonly string[];
}

/** Options of a write: the locale version it changes, and how much of the answer to populate. */
export interface DocumentWrite {
  locale?: string | null;
  populate?: '*';
}

/** A locale-only query string (`undefined` without a locale). */
function localeQuery(locale: string | null | undefined): string | undefined {
  return toQuery({ locale }) || undefined;
}

/**
 * Content documents in the admin API (`/content/{uid}…`): lists, reads, writes, the
 * publication actions and the locale versions. Every screen that loads or changes entries
 * goes through here, so paths and query shapes live in one place.
 */
@Injectable({ providedIn: 'root' })
export class ContentDocuments {
  private readonly api = inject(Api);

  /** The admin API path of a type's documents, or of one of them. */
  path(uid: string, documentId?: string): string {
    return documentId ? `/content/${uid}/${documentId}` : `/content/${uid}`;
  }

  /** A page of documents; `query` is Strapi's list query (an object, or encoded already). */
  list(uid: string, query: Record<string, unknown> | string = {}): Promise<ListResponse<Document>> {
    const encoded = typeof query === 'string' ? query : toQuery(query);
    return this.api.list<Document>(this.path(uid), encoded || undefined);
  }

  /** One version of a document (the draft unless `status` says otherwise). */
  get(uid: string, documentId: string, read: DocumentRead = {}): Promise<Document> {
    const { populate, status, fields, locale } = read;
    return this.api.get<Document>(
      this.path(uid, documentId),
      toQuery({ populate, status, fields, locale }) || undefined,
    );
  }

  /** Creates a document (its draft, for draft & publish types). */
  create(uid: string, data: Record<string, unknown>, write: DocumentWrite = {}): Promise<Document> {
    return this.api.post<Document>(
      this.path(uid),
      { data },
      toQuery({ populate: write.populate, locale: write.locale }) || undefined,
    );
  }

  /** Updates a document's draft in `locale` (creating that locale version when missing). */
  update(
    uid: string,
    documentId: string,
    data: Record<string, unknown>,
    write: DocumentWrite = {},
  ): Promise<Document> {
    return this.api.put<Document>(
      this.path(uid, documentId),
      { data },
      toQuery({ populate: write.populate, locale: write.locale }) || undefined,
    );
  }

  /** Deletes a document: its version in `locale`, or the whole document. */
  delete(uid: string, documentId: string, locale?: string | null): Promise<void> {
    return this.api.delete(this.path(uid, documentId), localeQuery(locale));
  }

  /** Runs a publication action on the version in `locale`; the answer is the document. */
  action(
    uid: string,
    documentId: string,
    action: DocumentAction,
    locale?: string | null,
  ): Promise<Document> {
    return this.api.post<Document>(
      `${this.path(uid, documentId)}/actions/${action}`,
      {},
      localeQuery(locale),
    );
  }

  /** Publishes the draft; the answer is the published version. */
  publish(uid: string, documentId: string, locale?: string | null): Promise<Document> {
    return this.action(uid, documentId, 'publish', locale);
  }

  async unpublish(uid: string, documentId: string, locale?: string | null): Promise<void> {
    await this.action(uid, documentId, 'unpublish', locale);
  }

  /** Drops the draft's changes: the draft becomes the published version again. */
  async discardDraft(uid: string, documentId: string, locale?: string | null): Promise<void> {
    await this.action(uid, documentId, 'discard-draft', locale);
  }

  /** The document's versions per locale (`locale` scopes the permission check). */
  locales(uid: string, documentId: string, locale?: string | null): Promise<LocaleVersion[]> {
    return this.api.get<LocaleVersion[]>(
      `${this.path(uid, documentId)}/locales`,
      localeQuery(locale),
    );
  }

  /** A fresh preview URL of the draft (a new token each time). */
  preview(uid: string, documentId: string, locale?: string | null): Promise<{ url: string }> {
    return this.api.get<{ url: string }>(
      `${this.path(uid, documentId)}/preview`,
      localeQuery(locale),
    );
  }
}
