import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import { Subject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AiActions } from '../../../core/ai';
import { Api, ApiFailure } from '../../../core/api';
import { Auth } from '../../../core/auth';
import { ContentLocales, LocaleVersion } from '../../../core/content-locales';
import { ContentDocuments } from '../../../core/documents';
import { EntryDuplicates } from '../../../core/duplicate';
import { Engagement } from '../../../core/engagement';
import { Features } from '../../../core/features';
import { I18n } from '../../../core/i18n/i18n';
import { EntryPresence } from '../../../core/presence';
import { Realtime } from '../../../core/realtime';
import { Schema } from '../../../core/schema';
import { ContentType, Document } from '../../../core/types';
import { Unseen } from '../../../core/unseen';
import { ICONS } from '../../../icons';
import { Confirm } from '../../../shared/components/confirm';
import { CollabSheet } from '../collab/collab-sheet';
import { EntryCollab } from '../collab/entry-collab';
import { PresenceAvatars } from '../collab/presence-avatars';
import { EntryUsage } from '../entry-usage';
import { RelatedEntrySheet } from '../related-entry-sheet';
import { DocumentForm } from './document-form';
import { LocaleSwitcher } from './locale-switcher';

@Component({
  selector: 'vd-related-entry-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class SheetStub {}

@Component({
  selector: 'vd-presence-avatars',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
  inputs: ['viewers'],
})
class AvatarsStub {}

@Component({
  selector: 'vd-entry-usage',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
  inputs: ['uid', 'documentId', 'locale'],
})
class UsageStub {}

const ARTICLE: ContentType = {
  uid: 'api::article.article',
  kind: 'collectionType',
  singularName: 'article',
  pluralName: 'articles',
  displayName: 'Article',
  draftAndPublish: true,
  attributes: {
    title: { type: 'string', required: true },
    summary: { type: 'text' },
  },
};

const LOCALIZED: ContentType = {
  ...ARTICLE,
  uid: 'api::page.page',
  displayName: 'Page',
  pluginOptions: { i18n: { localized: true } },
};

const DRAFT: Document = {
  id: 1,
  documentId: 'doc1',
  title: 'Hello',
  summary: 'First words',
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-02T10:00:00.000Z',
};

interface Setup {
  type?: ContentType;
  document?: Document | null;
  publishedAt?: string | null;
  locale?: string | null;
  versions?: LocaleVersion[];
  existingId?: string | null;
  confirm?: boolean;
}

async function setup(options: Setup = {}) {
  const type = options.type ?? ARTICLE;
  const saved = (data: Record<string, unknown>): Document => ({
    ...DRAFT,
    ...data,
    updatedAt: '2026-09-03T10:00:00.000Z',
  });
  const documents = {
    get: vi.fn(async () => DRAFT),
    list: vi.fn(async () => ({ data: [], meta: {} })),
    create: vi.fn(async (_uid: string, data: Record<string, unknown>) => saved(data)),
    update: vi.fn(async (_uid: string, _id: string, data: Record<string, unknown>) => saved(data)),
    publish: vi.fn(async () => ({ ...DRAFT, updatedAt: '2026-09-04T10:00:00.000Z' })),
    unpublish: vi.fn(async () => undefined),
    discardDraft: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    locales: vi.fn(async () => options.versions ?? []),
    preview: vi.fn(async () => ({ url: 'https://example.com' })),
  };
  const confirm = {
    ask: vi.fn(async () => options.confirm ?? true),
    discardChanges: vi.fn(async () => options.confirm ?? true),
  };
  const api = {
    get: async () => null,
    list: async () => ({ data: [], meta: {} }),
    post: async () => null,
    put: async () => null,
    delete: async () => undefined,
  };
  const presence = {
    others: signal([]),
    viewers: signal([]),
    holder: signal(null),
    track: () => undefined,
    setEditing: vi.fn(),
  };
  const collab = {
    on: signal(false),
    openThreads: signal(0),
    labeler: signal(null),
    bind: () => undefined,
    setViewers: () => undefined,
    open: () => undefined,
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideIcons(ICONS),
      { provide: Api, useValue: api },
      { provide: ContentDocuments, useValue: documents },
      { provide: Confirm, useValue: confirm },
      {
        provide: Auth,
        useValue: {
          can: () => true,
          canContent: () => true,
          canInLocale: () => true,
          permissions: signal([]),
        },
      },
      { provide: Features, useValue: { enabled: () => false, settings: () => ({}) } },
      {
        provide: AiActions,
        useValue: { enabled: signal(false), status: signal(null), load: async () => undefined },
      },
      { provide: Realtime, useValue: { messages: new Subject(), isOwn: () => false } },
      { provide: Unseen, useValue: { refresh: () => undefined } },
      { provide: EntryDuplicates, useValue: { duplicate: async () => true } },
      { provide: Engagement, useValue: { votes: async () => ({}), vote: async () => null } },
      {
        provide: ContentLocales,
        useValue: {
          list: signal([
            { code: 'en', name: 'English' },
            { code: 'fr', name: 'French' },
          ]),
          loaded: signal(true),
          defaultCode: signal('en'),
          name: (code: string | null) => code ?? '',
          load: async () => [],
        },
      },
      {
        provide: I18n,
        useValue: {
          t: (key: string) => key,
          formatDate: (value: unknown) => String(value ?? ''),
          formatNumber: (value: number) => String(value),
          formatList: (items: string[]) => items.join(', '),
          direction: () => 'ltr',
          endSide: () => 'right',
          locale: () => 'en',
        },
      },
    ],
  });
  TestBed.overrideComponent(DocumentForm, {
    remove: {
      imports: [RelatedEntrySheet, CollabSheet, PresenceAvatars, EntryUsage],
      providers: [EntryCollab, EntryPresence],
    },
    add: {
      imports: [SheetStub, AvatarsStub, UsageStub],
      providers: [
        { provide: EntryCollab, useValue: collab },
        { provide: EntryPresence, useValue: presence },
      ],
    },
  });
  const schema = TestBed.inject(Schema);
  schema.contentTypes.set([ARTICLE, LOCALIZED]);
  const router = TestBed.inject(Router);
  const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
  const fixture = TestBed.createComponent(DocumentForm);
  fixture.componentRef.setInput('type', type);
  fixture.componentRef.setInput(
    'document',
    options.document === undefined ? DRAFT : options.document,
  );
  fixture.componentRef.setInput('publishedAt', options.publishedAt ?? null);
  fixture.componentRef.setInput('locale', options.locale ?? null);
  fixture.componentRef.setInput('versions', options.versions ?? []);
  fixture.componentRef.setInput('existingId', options.existingId ?? null);
  const element = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  };
  await settle();
  const input = (name: string) =>
    element.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[id$="${name}"]`)!;
  const type_ = async (name: string, value: string) => {
    const field = input(name);
    field.value = value;
    field.dispatchEvent(new Event('input'));
    await settle();
  };
  const button = (label: string) =>
    [...element.querySelectorAll('button')].find(
      (candidate) => candidate.textContent?.trim() === label,
    )!;
  const click = async (label: string) => {
    button(label).click();
    await settle();
  };
  return {
    fixture,
    element,
    form: fixture.componentInstance,
    documents,
    confirm,
    presence,
    navigate,
    settle,
    input,
    type: type_,
    button,
    click,
  };
}

describe('DocumentForm', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('renders the type’s fields with the document’s values', async () => {
    const page = await setup();
    const labels = [...page.element.querySelectorAll('label')].map((label) =>
      label.textContent?.replace(/[\s*]+/g, ' ').trim(),
    );
    expect(labels).toEqual(expect.arrayContaining(['Title', 'Summary']));
    expect(page.input('title').value).toBe('Hello');
    expect(page.input('summary').value).toBe('First words');
    expect(page.element.querySelector('h1')?.textContent).toContain('Hello');
  });

  it('starts empty for a new entry', async () => {
    const page = await setup({ document: null });
    expect(page.input('title').value).toBe('');
    expect(page.element.textContent).toContain('content.edit.newEntry');
  });

  it('tracks unsaved changes until the draft is saved', async () => {
    const page = await setup();
    expect(page.form.hasUnsavedChanges()).toBe(false);
    await page.type('title', 'Hello again');
    expect(page.form.hasUnsavedChanges()).toBe(true);
    expect(page.presence.setEditing).toHaveBeenLastCalledWith(true);

    await page.click('content.edit.saveDraft');
    expect(page.documents.update).toHaveBeenCalledWith(
      ARTICLE.uid,
      'doc1',
      expect.objectContaining({ title: 'Hello again', summary: 'First words' }),
      { populate: '*', locale: null },
    );
    expect(page.documents.publish).not.toHaveBeenCalled();
    expect(page.form.hasUnsavedChanges()).toBe(false);
    expect(page.presence.setEditing).toHaveBeenLastCalledWith(false);
  });

  it('creates a new entry on its first save and opens its editor', async () => {
    const page = await setup({ document: null });
    await page.type('title', 'Brand new');
    await page.click('content.edit.saveDraft');
    expect(page.documents.create).toHaveBeenCalledWith(
      ARTICLE.uid,
      expect.objectContaining({ title: 'Brand new' }),
      { populate: '*', locale: null },
    );
    expect(page.navigate).toHaveBeenCalledWith(
      ['/content', ARTICLE.uid, 'doc1'],
      expect.objectContaining({ replaceUrl: true }),
    );
  });

  it('keeps the changes and shows the server’s validation issues on the fields', async () => {
    const page = await setup();
    page.documents.update.mockRejectedValueOnce(
      new ApiFailure(400, 'ValidationError', 'Invalid', [
        { path: ['title'], message: 'Title is too short' },
        { path: [], message: 'Something else' },
      ]),
    );
    await page.type('title', 'H');
    await page.click('content.edit.saveDraft');
    expect(page.form.hasUnsavedChanges()).toBe(true);
    expect(page.element.textContent).toContain('content.edit.error.fixFields');
    expect(page.element.textContent).toContain('Title is too short');
    expect(page.element.textContent).toContain('Something else');
  });

  it('publishes after saving the draft', async () => {
    const page = await setup();
    await page.click('content.edit.publish');
    expect(page.documents.update).toHaveBeenCalled();
    expect(page.documents.publish).toHaveBeenCalledWith(ARTICLE.uid, 'doc1', null);
    // Published: the details panel offers to unpublish.
    expect(page.button('content.edit.unpublish')).toBeTruthy();
  });

  it('unpublishes once confirmed', async () => {
    const page = await setup({ publishedAt: '2026-09-02T10:00:00.000Z' });
    await page.click('content.edit.unpublish');
    expect(page.confirm.ask).toHaveBeenCalled();
    expect(page.documents.unpublish).toHaveBeenCalledWith(ARTICLE.uid, 'doc1', null);
    expect(page.button('content.edit.unpublish')).toBeUndefined();
  });

  it('does nothing when the unpublish confirmation is declined', async () => {
    const page = await setup({ publishedAt: '2026-09-02T10:00:00.000Z', confirm: false });
    await page.click('content.edit.unpublish');
    expect(page.documents.unpublish).not.toHaveBeenCalled();
  });

  it('discards the draft’s changes and shows the published version', async () => {
    const page = await setup({ publishedAt: '2026-09-01T12:00:00.000Z' });
    await page.type('title', 'Unsaved');
    page.documents.get.mockResolvedValueOnce({ ...DRAFT, title: 'Live title' });
    await page.click('content.edit.discard');
    expect(page.documents.discardDraft).toHaveBeenCalledWith(ARTICLE.uid, 'doc1', null);
    expect(page.documents.get).toHaveBeenCalledWith(ARTICLE.uid, 'doc1', {
      populate: '*',
      locale: null,
    });
    expect(page.input('title').value).toBe('Live title');
    expect(page.form.hasUnsavedChanges()).toBe(false);
    // Draft and published version are the same again: nothing left to discard.
    expect(page.button('content.edit.discard')).toBeUndefined();
  });

  it('saves and publishes in the edited locale', async () => {
    const page = await setup({
      type: LOCALIZED,
      locale: 'fr',
      versions: [
        { locale: 'en', draft: true, published: true },
        { locale: 'fr', draft: true, published: false },
      ],
    });
    await page.click('content.edit.publish');
    expect(page.documents.update).toHaveBeenCalledWith(LOCALIZED.uid, 'doc1', expect.anything(), {
      populate: '*',
      locale: 'fr',
    });
    expect(page.documents.publish).toHaveBeenCalledWith(LOCALIZED.uid, 'doc1', 'fr');
    // The switcher's states are read again.
    expect(page.documents.locales).toHaveBeenCalledWith(LOCALIZED.uid, 'doc1', 'fr');
  });

  it('switches locales, asking first when there are unsaved changes', async () => {
    const page = await setup({
      type: LOCALIZED,
      locale: 'en',
      versions: [{ locale: 'en', draft: true, published: false }],
    });
    const switcher = page.fixture.debugElement.query(By.directive(LocaleSwitcher))
      .componentInstance as LocaleSwitcher;

    switcher.switched.emit('fr');
    await page.settle();
    expect(page.confirm.discardChanges).not.toHaveBeenCalled();
    expect(page.navigate).toHaveBeenLastCalledWith(['/content', LOCALIZED.uid, 'doc1'], {
      queryParams: { locale: 'fr' },
    });

    await page.type('title', 'Changed');
    page.navigate.mockClear();
    page.confirm.discardChanges.mockResolvedValueOnce(false);
    switcher.switched.emit('fr');
    await page.settle();
    expect(page.confirm.discardChanges).toHaveBeenCalled();
    expect(page.navigate).not.toHaveBeenCalled();

    // The current locale is no switch at all.
    switcher.switched.emit('en');
    await page.settle();
    expect(page.navigate).not.toHaveBeenCalled();
  });

  it('shows a missing locale version as new, and creates it on save', async () => {
    const page = await setup({
      type: LOCALIZED,
      locale: 'fr',
      document: null,
      existingId: 'doc1',
      versions: [{ locale: 'en', draft: true, published: true }],
    });
    expect(page.element.textContent).toContain('content.locale.missingTitle');
    await page.click('content.edit.saveDraft');
    expect(page.documents.create).not.toHaveBeenCalled();
    expect(page.documents.update).toHaveBeenCalledWith(LOCALIZED.uid, 'doc1', expect.anything(), {
      populate: '*',
      locale: 'fr',
    });
    expect(page.element.textContent).not.toContain('content.locale.missingTitle');
  });
});
