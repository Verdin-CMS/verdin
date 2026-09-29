import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
  isDevMode,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import {
  TitleStrategy,
  provideRouter,
  withComponentInputBinding,
  withViewTransitions,
} from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import { provideTransloco, provideTranslocoTranspiler } from '@jsverse/transloco';

import { routes } from './app.routes';
import { authInterceptor } from './core/auth';
import { BrandingService } from './core/branding';
import { I18n } from './core/i18n/i18n';
import { JsonLoader } from './core/i18n/loader';
import { IcuTranspiler } from './core/i18n/transpiler';
import { DEFAULT_LOCALE, LOCALES } from './core/i18n/locales';
import { ownWritesInterceptor } from './core/realtime';
import { RouteFocus } from './core/route-focus';
import { Theme } from './core/theme';
import { VerdinTitleStrategy } from './core/title';
import { onViewTransitionCreated } from './core/view-transition';
import { ICONS } from './icons';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withViewTransitions({ skipInitialTransition: true, onViewTransitionCreated }),
    ),
    { provide: TitleStrategy, useExisting: VerdinTitleStrategy },
    provideHttpClient(withInterceptors([authInterceptor, ownWritesInterceptor])),
    provideIcons(ICONS),
    provideTransloco({
      config: {
        availableLangs: LOCALES.map((locale) => locale.tag),
        defaultLang: DEFAULT_LOCALE,
        fallbackLang: DEFAULT_LOCALE,
        reRenderOnLangChange: true,
        prodMode: !isDevMode(),
        missingHandler: { useFallbackTranslation: true, logMissingKey: isDevMode() },
      },
      loader: JsonLoader,
    }),
    provideTranslocoTranspiler(IcuTranspiler),
    provideAppInitializer(() => {
      inject(Theme);
      inject(BrandingService).apply();
      inject(RouteFocus).start();
      return inject(I18n).init();
    }),
  ],
};
