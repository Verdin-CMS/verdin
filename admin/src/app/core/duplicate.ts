import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { toast } from '@spartan-ng/brain/sonner';

import { Api, ApiFailure, toQuery } from './api';
import { I18n } from './i18n/i18n';
import { Document } from './types';

/** The answer of `POST /content/{uid}/{documentId}/clone`. */
export interface Duplicate {
  /** The new draft. */
  document: Document;
  /** Fields not copied: unique and uid fields, one-to-one and one-to-many relations. */
  leftOut: string[];
}

/** The admin API path of an entry's clone action. */
export function clonePath(uid: string, documentId: string): string {
  return `/content/${uid}/${encodeURIComponent(documentId)}/clone`;
}

/** Duplicates entries (needs content.read and content.create on the type). */
@Injectable({ providedIn: 'root' })
export class EntryDuplicates {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18n);

  async clone(uid: string, documentId: string, locale: string | null): Promise<Duplicate> {
    const response = await this.api.postWithMeta<Document, { leftOut?: string[] }>(
      clonePath(uid, documentId),
      {},
      toQuery({ locale }) || undefined,
    );
    return { document: response.data, leftOut: response.meta?.leftOut ?? [] };
  }

  /**
   * Duplicates an entry, opens the copy's editor and says which fields were not copied.
   * `label` names fields in the toast. Returns whether it worked.
   */
  async duplicate(
    uid: string,
    documentId: string,
    locale: string | null,
    label: (field: string) => string,
  ): Promise<boolean> {
    const t = this.i18n.t;
    try {
      const { document, leftOut } = await this.clone(uid, documentId, locale);
      await this.router.navigate(['/content', uid, document.documentId], {
        queryParams: locale ? { locale } : {},
      });
      toast.success(t('content.duplicate.done'), {
        description: leftOut.length
          ? t('content.duplicate.leftOut', { fields: this.i18n.formatList(leftOut.map(label)) })
          : undefined,
        duration: leftOut.length ? 8_000 : undefined,
      });
      return true;
    } catch (error) {
      toast.error(t('content.duplicate.error'), { description: ApiFailure.from(error).message });
      return false;
    }
  }
}
