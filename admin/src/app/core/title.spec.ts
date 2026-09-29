import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, TitleStrategy, provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';

import { BrandingService } from './branding';
import { I18n } from './i18n/i18n';
import { Schema } from './schema';
import { PageTitle, VerdinTitleStrategy, composeTitle, titled } from './title';

@Component({ selector: 'vd-blank', changeDetection: ChangeDetectionStrategy.OnPush, template: '' })
class Blank {}

const MESSAGES: Record<string, Record<string, string>> = {
  en: {
    'shell.webhooks': 'Webhooks',
    'shell.settings': 'Settings',
    'shell.home': 'Home',
    'title.content': 'Content',
    'title.new': 'New',
    'title.edit': 'Edit',
    'title.entry': 'Entry',
  },
  es: {
    'shell.webhooks': 'Webhooks',
    'shell.settings': 'Ajustes',
    'title.content': 'Contenido',
    'title.entry': 'Entrada',
  },
};

function setup(brand = 'Verdin') {
  const locale = signal('en');
  const i18n = {
    locale,
    t: (key: string) => MESSAGES[locale()][key] ?? MESSAGES['en'][key] ?? key,
  };
  const types = signal([{ uid: 'api::article.article', displayName: 'Articles' }]);
  const schema = { type: (uid: string) => types().find((type) => type.uid === uid) };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: '', ...titled({ page: 'shell.home' }), component: Blank },
        { path: 'untitled', component: Blank },
        {
          path: 'content/:uid',
          ...titled({ type: true, sections: ['title.content'] }),
          component: Blank,
        },
        {
          path: 'content/:uid/:documentId',
          ...titled({ detail: 'title.entry', type: true, sections: ['title.content'] }),
          component: Blank,
        },
        {
          path: 'settings',
          children: [
            {
              path: 'webhooks',
              ...titled({ page: 'shell.webhooks', sections: ['shell.settings'] }),
              component: Blank,
            },
            {
              path: 'webhooks/:id',
              ...titled({ detail: 'title.edit', sections: ['shell.webhooks', 'shell.settings'] }),
              component: Blank,
            },
          ],
        },
      ]),
      { provide: TitleStrategy, useExisting: VerdinTitleStrategy },
      { provide: I18n, useValue: i18n },
      { provide: Schema, useValue: schema },
      { provide: BrandingService, useValue: { title: brand } },
    ],
  });
  const router = TestBed.inject(Router);
  const visit = async (url: string) => {
    await router.navigateByUrl(url);
    TestBed.tick();
    return document.title;
  };
  return { router, visit, locale, types, pageTitle: TestBed.inject(PageTitle) };
}

describe('composeTitle', () => {
  it('joins the parts with a middle dot, leaving the empty ones out', () => {
    expect(composeTitle(['Articles', null, ' ', undefined, 'Content', 'Verdin'])).toBe(
      'Articles · Content · Verdin',
    );
    expect(composeTitle([])).toBe('');
  });
});

describe('VerdinTitleStrategy', () => {
  beforeEach(() => {
    document.title = '';
  });

  it('titles a page with its sections and the brand', async () => {
    const { visit } = setup();
    expect(await visit('/')).toBe('Home · Verdin');
    expect(await visit('/settings/webhooks')).toBe('Webhooks · Settings · Verdin');
  });

  it('uses the branding title', async () => {
    const { visit } = setup('Acme CMS');
    expect(await visit('/settings/webhooks')).toBe('Webhooks · Settings · Acme CMS');
    expect(await visit('/untitled')).toBe('Acme CMS');
  });

  it('names the content type, and follows the schema once it loads', async () => {
    const { visit, types } = setup();
    expect(await visit('/content/api::article.article')).toBe('Articles · Content · Verdin');
    expect(await visit('/content/api::page.page')).toBe('page · Content · Verdin');
    types.update((list) => [...list, { uid: 'api::page.page', displayName: 'Pages' }]);
    TestBed.tick();
    expect(document.title).toBe('Pages · Content · Verdin');
  });

  it('puts the record the page shows first, and forgets it on the next navigation', async () => {
    const { visit, pageTitle } = setup();
    expect(await visit('/content/api::article.article/abc')).toBe(
      'Entry · Articles · Content · Verdin',
    );
    pageTitle.setDetail('Launch post');
    TestBed.tick();
    expect(document.title).toBe('Launch post · Articles · Content · Verdin');
    expect(await visit('/settings/webhooks/3')).toBe('Edit · Webhooks · Settings · Verdin');
    expect(await visit('/settings/webhooks/new')).toBe('New · Webhooks · Settings · Verdin');
  });

  it('translates again when the language changes', async () => {
    const { visit, locale } = setup();
    expect(await visit('/content/api::article.article/abc')).toBe(
      'Entry · Articles · Content · Verdin',
    );
    locale.set('es');
    TestBed.tick();
    expect(document.title).toBe('Entrada · Articles · Contenido · Verdin');
  });
});
