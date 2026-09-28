import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Translation, TranslocoLoader } from '@jsverse/transloco';
import { map } from 'rxjs';

import { BrandingService, mergeTranslations } from '../branding';

/**
 * Catalogs are static files next to the app (`i18n/<tag>.json`, under the base href);
 * the branding's text overrides for the language are merged in.
 */
@Injectable({ providedIn: 'root' })
export class JsonLoader implements TranslocoLoader {
  private readonly http = inject(HttpClient);
  private readonly branding = inject(BrandingService);

  getTranslation(lang: string) {
    return this.http
      .get<Translation>(`i18n/${lang}.json`)
      .pipe(map((catalog) => mergeTranslations(catalog, this.branding.value.translations, lang)));
  }
}
