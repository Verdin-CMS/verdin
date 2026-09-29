import { Injectable, inject } from '@angular/core';

import { ApiFailure } from '../../../core/api';
import { Auth } from '../../../core/auth';
import {
  ContentLocales,
  LocaleVersion,
  isLocalized,
  localeState,
} from '../../../core/content-locales';
import { ContentDocuments } from '../../../core/documents';
import { EditView, EditViews } from '../../../core/edit-view';
import { Engagement } from '../../../core/engagement';
import { allowedLocale } from '../../../core/permissions';
import { ContentType, Document } from '../../../core/types';
import { Unseen } from '../../../core/unseen';

/** What the entry editor opens: a document (or a new one) in a locale, with its layout. */
export interface LoadedEntry {
  /** The edited locale (localized types only). */
  locale: string | null;
  /** The draft (or only version); `null` for a new document or a missing locale version. */
  document: Document | null;
  /** When the published version was last updated (`null`: not published). */
  publishedAt: string | null;
  /** The document's versions per locale (empty when not localized or not listable). */
  versions: LocaleVersion[];
  /** A document that exists in other locales but not in `locale`. */
  existingId: string | null;
  /** Another locale's version, whose shared fields prefill a missing locale. */
  sharedSource: Document | null;
  /** The type's edit view (`null`: the default layout). */
  view: EditView | null;
}

/**
 * Loads what the entry editor shows for a route: the locale to edit (the admin's allowed
 * ones first), the document's versions, the draft and the published version's date, or,
 * for a locale the document lacks, another version to prefill it from. Throws `ApiFailure`s
 * (a 404 when there is no such document); `null` once `stale` says a newer load started.
 */
@Injectable({ providedIn: 'root' })
export class EntryLoader {
  private readonly documents = inject(ContentDocuments);
  private readonly locales = inject(ContentLocales);
  private readonly auth = inject(Auth);
  private readonly views = inject(EditViews);
  private readonly engagement = inject(Engagement);
  private readonly unseen = inject(Unseen);

  async load(
    type: ContentType,
    requested: { documentId?: string | null; locale?: string | null },
    stale: () => boolean = () => false,
  ): Promise<LoadedEntry | null> {
    const uid = type.uid;
    // The edit view loads alongside; the default layout shows when there is none.
    const view = this.views.get(uid).catch(() => null);
    const entry: LoadedEntry = {
      locale: null,
      document: null,
      publishedAt: null,
      versions: [],
      existingId: null,
      sharedSource: null,
      view: null,
    };
    if (isLocalized(type)) {
      await this.locales.load();
      entry.locale = this.locales.resolve(requested.locale);
      // Without `?locale=`, an admin limited to some locales opens one of them.
      if (!requested.locale) {
        const codes = (this.locales.list() ?? []).map((item) => item.code);
        entry.locale = allowedLocale(
          this.auth.permissions(),
          'content.read',
          uid,
          codes,
          entry.locale,
        );
      }
    }
    // A newer load started meanwhile: this one stops.
    if (stale()) return null;
    const locale = entry.locale;
    let documentId = requested.documentId ?? null;
    if (type.kind === 'singleType') documentId = await this.singleDocument(uid, locale);
    if (documentId && locale) {
      // An admin limited to some locales may not list the versions: the document is then
      // loaded in `locale` directly (a 404 there means it has no such version).
      const versions = await this.documents
        .locales(uid, documentId, locale)
        .catch((error: unknown) => {
          if (ApiFailure.from(error).status === 403) return null;
          throw error;
        });
      entry.versions = versions ?? [];
      if (versions && localeState(versions, locale) === 'missing') {
        // A new locale of an existing document: its shared fields come from another one.
        if (!versions.length) throw new ApiFailure(404, 'NotFoundError', 'Not Found');
        // Only versions the admin may read (permissions may be limited to some locales).
        const readable = versions.filter((version) =>
          this.auth.canInLocale('content.read', uid, version.locale),
        );
        const source =
          readable.find((version) => version.locale === this.locales.defaultCode()) ?? readable[0];
        if (source) {
          entry.sharedSource = await this.documents.get(uid, documentId, {
            populate: '*',
            status: source.draft ? 'draft' : undefined,
            locale: source.locale,
          });
        }
        entry.existingId = documentId;
        documentId = null;
      }
    }
    if (documentId) {
      entry.document = await this.documents.get(uid, documentId, {
        populate: '*',
        status: 'draft',
        locale,
      });
      // Opening a document marks it seen (it leaves "unseen" dashboard widgets).
      this.engagement
        .view(uid, documentId)
        .then(() => this.unseen.refresh())
        .catch(() => undefined);
      if (type.draftAndPublish) {
        try {
          const live = await this.documents.get(uid, documentId, {
            status: 'published',
            fields: 'updatedAt',
            locale,
          });
          entry.publishedAt = live.updatedAt ?? live.publishedAt ?? null;
        } catch (error) {
          if (ApiFailure.from(error).status !== 404) throw error;
        }
      }
    }
    entry.view = await view;
    return entry;
  }

  /**
   * The single type's document: its version in `locale`, else (localized types) a version
   * in another locale, so that saving adds `locale` to it.
   */
  private async singleDocument(uid: string, locale: string | null): Promise<string | null> {
    const first = async (code: string | null) => {
      const list = await this.documents.list(uid, { pagination: { pageSize: 1 }, locale: code });
      return list.data[0]?.documentId ?? null;
    };
    const found = await first(locale);
    if (found || !locale) return found;
    for (const other of this.locales.list() ?? []) {
      if (other.code === locale || !this.auth.canInLocale('content.read', uid, other.code))
        continue;
      const id = await first(other.code);
      if (id) return id;
    }
    return null;
  }
}
