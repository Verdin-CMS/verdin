import { Injectable, computed, inject, signal } from '@angular/core';

import { Api, ApiFailure } from './api';
import { MessageKey, Params } from './i18n/keys';

/** `GET /ai`: whether AI actions are available (the `ai` feature with `[ai]` configured). */
export interface AiStatus {
  enabled: boolean;
  provider?: string;
  model?: string;
}

export interface TranslateRequest {
  uid: string;
  documentId: string;
  from: string;
  to: string;
  /** Attributes to translate (default: every text attribute). */
  fields?: string[];
}

export interface SeoSuggestion {
  metaTitle: string;
  metaDescription: string;
  keywords: string[];
}

/** Images the server can describe. */
export const ALT_TEXT_MIMES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

/** How long a loaded status is trusted before it is asked again (the feature may change). */
const STATUS_TTL = 60_000;

/**
 * AI actions of the admin API. Each returns suggestions: nothing is saved until the editor
 * saves the form. The server allows 30 requests a minute per admin (429 beyond).
 */
@Injectable({ providedIn: 'root' })
export class AiActions {
  private readonly api = inject(Api);

  /** `null` until loaded. */
  readonly status = signal<AiStatus | null>(null);
  readonly enabled = computed(() => this.status()?.enabled === true);
  private loaded = 0;
  private pending: Promise<AiStatus> | null = null;

  /** Loads the status (cached for a minute); an unreachable endpoint means disabled. */
  load(): Promise<AiStatus> {
    const current = this.status();
    if (current && Date.now() - this.loaded < STATUS_TTL) return Promise.resolve(current);
    this.pending ??= this.api
      .get<AiStatus>('/ai')
      .catch((): AiStatus => ({ enabled: false }))
      .then((status) => {
        this.status.set(status ?? { enabled: false });
        this.loaded = Date.now();
        this.pending = null;
        return this.status()!;
      });
    return this.pending;
  }

  translate(request: TranslateRequest): Promise<{ fields: Record<string, unknown> }> {
    return this.api.post('/ai/translate', request);
  }

  altText(
    fileId: number,
    locale?: string | null,
  ): Promise<{
    alternativeText: string;
    caption: string;
  }> {
    return this.api.post('/ai/alt-text', { fileId, ...(locale ? { locale } : {}) });
  }

  summarize(text: string, locale?: string | null, maxWords?: number): Promise<{ summary: string }> {
    return this.api.post('/ai/summarize', {
      text,
      ...(locale ? { locale } : {}),
      ...(maxWords ? { maxWords } : {}),
    });
  }

  seo(uid: string, documentId: string, locale?: string | null): Promise<SeoSuggestion> {
    return this.api.post('/ai/seo', { uid, documentId, ...(locale ? { locale } : {}) });
  }
}

/** The description of a failed AI request, for its toast. */
export function aiErrorMessage(
  error: unknown,
  t: (key: MessageKey, params?: Params) => string,
): string {
  const failure = ApiFailure.from(error);
  if (failure.status === 429) return t('ai.error.rateLimited');
  if (failure.status === 404) return t('ai.error.unavailable');
  return failure.message;
}
