import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import { afterEach, describe, expect, it } from 'vitest';

import { Api } from '../../core/api';
import { I18n } from '../../core/i18n/i18n';
import { PluginExtensions } from '../../core/plugin-extensions';
import { Schema } from '../../core/schema';
import { SchemaPlan } from '../../core/types';
import { Confirm } from '../../shared/components/confirm';
import { ICONS } from '../../icons';
import { Builder } from './builder';
import { Sources } from './builder-model';

const SOURCES: Sources = {
  contentTypes: {
    article: {
      kind: 'collectionType',
      displayName: 'Article',
      singularName: 'article',
      pluralName: 'articles',
      options: { draftAndPublish: true },
      attributes: { title: { type: 'string' }, featured: { type: 'boolean' } },
    },
    author: {
      kind: 'collectionType',
      displayName: 'Author',
      singularName: 'author',
      pluralName: 'authors',
      attributes: { name: { type: 'string' } },
    },
  },
  components: {
    'shared.seo': { displayName: 'SEO', attributes: { metaTitle: { type: 'string' } } },
  },
};

const PLAN: SchemaPlan = {
  valid: true,
  requires: 'destructive',
  hints: ['--rename-column article.title:headline'],
  steps: [
    { description: 'Add column headline', risk: 'safe', statements: ['ALTER TABLE a ADD b'] },
    { description: 'Change column type', risk: 'risky', statements: [] },
    { description: 'Drop column title', risk: 'destructive', statements: ['ALTER TABLE a DROP c'] },
  ],
};

interface Call {
  path: string;
  body: Record<string, unknown>;
}

async function setup(name: string, plan: SchemaPlan = PLAN) {
  const calls: Call[] = [];
  let schemaLoads = 0;
  let sourceLoads = 0;
  const api = {
    get: async (path: string) => {
      if (path === '/schema') sourceLoads++;
      return structuredClone(SOURCES);
    },
    post: async (path: string, body: Record<string, unknown>) => {
      calls.push({ path, body: structuredClone(body) });
      return path === '/schema/plan' ? plan : {};
    },
  };
  TestBed.configureTestingModule({
    providers: [
      provideIcons(ICONS),
      provideRouter([{ path: '**', children: [] }]),
      { provide: Api, useValue: api },
      {
        provide: Schema,
        useValue: {
          devMode: () => true,
          load: async () => {
            schemaLoads++;
          },
        },
      },
      { provide: PluginExtensions, useValue: { fields: signal([]), field: () => undefined } },
      {
        provide: I18n,
        useValue: {
          t: (key: string, params?: object) => (params ? `${key} ${JSON.stringify(params)}` : key),
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(Builder);
  fixture.componentRef.setInput('name', name);
  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  };
  await settle();
  const element = fixture.nativeElement as HTMLElement;
  /** Dialogs render in an overlay outside the component. */
  const find = <T extends Element = HTMLElement>(selector: string) =>
    document.querySelector<T>(selector);
  const findAll = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)];
  const text = (node: Element | null) => node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const button = (label: string) =>
    findAll('button').find((node) => text(node).includes(label)) as HTMLButtonElement | undefined;
  const click = async (target: string | HTMLElement | undefined) => {
    const node = typeof target === 'string' ? button(target) : target;
    if (!node) throw new Error(`nothing to click: ${String(target)}`);
    node.click();
    await settle();
  };
  const type = async (selector: string, value: string, event = 'input') => {
    const input = find<HTMLInputElement>(selector)!;
    input.value = value;
    input.dispatchEvent(new Event(event));
    await settle();
  };
  const select = async (id: string, value: string) => {
    const node = find<HTMLSelectElement>(`select#${id}`)!;
    node.value = value;
    node.dispatchEvent(new Event('change'));
    await settle();
  };
  /** The names of the listed fields, in order. */
  const fieldNames = () =>
    [...element.querySelectorAll('section[vdAttributeList] li .font-mono')].map(text);
  const dirty = () => fixture.componentInstance.hasUnsavedChanges();
  return {
    fixture,
    element,
    find,
    findAll,
    text,
    button,
    click,
    type,
    select,
    fieldNames,
    dirty,
    settle,
    calls,
    schemaLoads: () => schemaLoads,
    sourceLoads: () => sourceLoads,
  };
}

describe('Builder', () => {
  afterEach(() =>
    document.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove()),
  );

  it('lists the types and components and opens the routed one', async () => {
    const page = await setup('article');
    const current = page.element.querySelector('aside [aria-current="page"]');
    expect(page.text(current)).toBe('Article');
    expect(page.text(page.element.querySelector('aside'))).toContain('shared.seo');
    expect(page.find<HTMLInputElement>('#display-name')!.value).toBe('Article');
    expect(page.find<HTMLInputElement>('#singular')!.disabled).toBe(true);
    expect(page.fieldNames()).toEqual(['title', 'featured']);
  });

  describe('adding fields', () => {
    it('adds a text field with a length limit', async () => {
      const page = await setup('article');
      await page.click('builder.fields.add');
      expect(page.text(page.find('[hlmDialogTitle]'))).toBe('builder.field.addTitle');
      await page.type('#field-name', 'subtitle');
      const card = page
        .findAll('vd-field-type-picker button')
        .find((node) => page.text(node).startsWith('builder.types.textbuilder'));
      await page.click(card);
      expect(card!.getAttribute('aria-pressed')).toBe('true');
      await page.type('#max-length', '200', 'change');
      await page.click('builder.field.done');

      expect(page.find('[hlmDialogTitle]')).toBeNull();
      expect(page.fieldNames()).toEqual(['title', 'featured', 'subtitle']);
      const row = page.element.querySelectorAll('section[vdAttributeList] li')[2];
      expect(page.text(row)).toContain('builder.types.text');
      expect(page.text(row)).toContain('builder.summary.maxLength {"count":200}');
    });

    it('adds an enumeration, a media field and a relation with its inverse side', async () => {
      const page = await setup('article');

      await page.click('builder.fields.add');
      await page.type('#field-name', 'status');
      await page.select('field-type', 'enumeration');
      expect(page.find<HTMLInputElement>('#field-enum')!.value).toBe('option-a, option-b');
      await page.type('#field-enum', 'draft, , live ', 'change');
      await page.click('builder.field.done');

      await page.click('builder.fields.add');
      await page.type('#field-name', 'cover');
      await page.select('field-type', 'media');
      await page.click(page.find<HTMLButtonElement>('#media-videos button, button#media-videos')!);
      await page.click('builder.field.done');

      await page.click('builder.fields.add');
      await page.type('#field-name', 'writer');
      await page.select('field-type', 'relation');
      expect(page.find<HTMLSelectElement>('select#relation-kind')!.value).toBe('manyToOne');
      await page.select('relation-target', 'api::author');
      await page.type('#inverse-name', 'articles');
      await page.click('builder.field.done');

      expect(page.fieldNames()).toEqual(['title', 'featured', 'status', 'cover', 'writer']);
      await page.click('common.save');
      const [plan] = page.calls;
      expect(plan.path).toBe('/schema/plan');
      const types = plan.body['contentTypes'] as Sources['contentTypes'];
      expect(types['article'].attributes).toEqual({
        title: { type: 'string' },
        featured: { type: 'boolean' },
        status: { type: 'enumeration', enum: ['draft', 'live'] },
        cover: { type: 'media', allowedTypes: ['images', 'audios', 'files'] },
        writer: {
          type: 'relation',
          relation: 'manyToOne',
          target: 'api::author',
          inversedBy: 'articles',
        },
      });
      expect(types['author'].attributes['articles']).toEqual({
        type: 'relation',
        relation: 'oneToMany',
        target: 'api::article',
        mappedBy: 'writer',
      });
    });

    it('edits an existing field in place and keeps its position', async () => {
      const page = await setup('article');
      await page.click(page.find<HTMLButtonElement>('button[aria-label^="builder.fields.edit"]')!);
      expect(page.text(page.find('[hlmDialogTitle]'))).toBe('builder.field.editTitle');
      // An existing field's kind is not picked again.
      expect(page.find('vd-field-type-picker')).toBeNull();
      await page.type('#field-name', 'headline');
      await page.click('builder.field.done');
      expect(page.fieldNames()).toEqual(['headline', 'featured']);
    });
  });

  describe('names', () => {
    it('writes field names in camel case and needs one', async () => {
      const page = await setup('article');
      await page.click('builder.fields.add');
      expect(page.button('builder.field.done')!.disabled).toBe(true);
      await page.type('#field-name', 'Hello wörld 2!');
      expect(page.find<HTMLInputElement>('#field-name')!.value).toBe('helloWorld2');
      expect(page.button('builder.field.done')!.disabled).toBe(false);
      await page.type('#field-name', '!!');
      expect(page.button('builder.field.done')!.disabled).toBe(true);
    });

    it('derives the API names of a new content type from its display name', async () => {
      const page = await setup('new');
      await page.type('#display-name', 'Blog Post');
      expect(page.find<HTMLInputElement>('#singular')!.value).toBe('blog-post');
      expect(page.find<HTMLInputElement>('#plural')!.value).toBe('blog-posts');
      await page.type('#display-name', 'Category');
      expect(page.find<HTMLInputElement>('#plural')!.value).toBe('categories');
      await page.type('#singular', 'Café Item');
      expect(page.find<HTMLInputElement>('#singular')!.value).toBe('cafe-item');
    });

    it('derives a new component UID and leaves password out of components', async () => {
      const page = await setup('new-component');
      await page.type('#display-name', 'Hero Banner');
      expect(page.find<HTMLInputElement>('#component-uid')!.value).toBe('shared.hero-banner');
      await page.type('#component-uid', 'layout.hero');
      await page.type('#display-name', 'Big Hero');
      expect(page.find<HTMLInputElement>('#component-uid')!.value).toBe('layout.big-hero');
      await page.click('builder.fields.add');
      const types = [...page.find<HTMLSelectElement>('select#field-type')!.options].map(
        (option) => option.value,
      );
      expect(types).toContain('string');
      expect(types).not.toContain('password');
    });

    it('rejects an inverse polymorphic side without an owner', async () => {
      const page = await setup('article');
      await page.click('builder.fields.add');
      await page.type('#field-name', 'notes');
      await page.select('field-type', 'relation');
      await page.select('relation-kind', 'morphMany');
      expect(page.text(page.find('[data-field-issue]'))).toBe('builder.morph.issue.target');
      expect(page.button('builder.field.done')!.disabled).toBe(true);
      await page.select('relation-kind', 'manyToOne');
      expect(page.find('[data-field-issue]')).toBeNull();
    });
  });

  describe('unsaved changes', () => {
    it('compares the draft with the one opened', async () => {
      const page = await setup('article');
      expect(page.dirty()).toBe(false);
      await page.type('#display-name', 'Post');
      expect(page.dirty()).toBe(true);
      await page.type('#display-name', 'Article');
      expect(page.dirty()).toBe(false);

      await page.click('builder.fields.add');
      await page.type('#field-name', 'extra');
      // A field still in its dialog is not part of the draft.
      expect(page.dirty()).toBe(false);
      await page.click('builder.field.done');
      expect(page.dirty()).toBe(true);
      await page.click(
        page.find<HTMLButtonElement>(
          'button[aria-label^="builder.fields.remove"][aria-label*="extra"]',
        )!,
      );
      expect(page.dirty()).toBe(false);
    });

    it('counts reordered fields and a planned inverse side as edits', async () => {
      const page = await setup('article');
      await page.click(
        page.find<HTMLButtonElement>('button[aria-label="builder.fields.moveDown"]')!,
      );
      expect(page.fieldNames()).toEqual(['featured', 'title']);
      expect(page.dirty()).toBe(true);
      await page.click(
        page.find<HTMLButtonElement>('button[aria-label="builder.fields.moveDown"]')!,
      );
      expect(page.dirty()).toBe(false);
    });

    it('opens another type without asking again (the route guard asked)', async () => {
      const page = await setup('article');
      await page.type('#display-name', 'Post');
      const confirm = TestBed.inject(Confirm);
      page.fixture.componentRef.setInput('name', 'author');
      await page.settle();
      expect(confirm.request()).toBeNull();
      expect(page.find<HTMLInputElement>('#display-name')!.value).toBe('Author');
      expect(page.dirty()).toBe(false);
    });
  });

  describe('the migration plan', () => {
    it('shows each step with its risk and applies the reviewed plan', async () => {
      const page = await setup('article');
      await page.type('#display-name', 'Post');
      await page.click('common.save');

      expect(page.text(page.find('[hlmDialogTitle]'))).toBe('builder.plan.title');
      const steps = page.findAll('ol > li').map(page.text);
      expect(steps).toHaveLength(3);
      expect(steps[0]).toContain('Add column headline');
      expect(steps[0]).toContain('builder.risk.safe');
      expect(steps[1]).toContain('builder.risk.risky');
      expect(steps[2]).toContain('builder.risk.destructive');
      expect(page.text(page.find('ol > li pre'))).toBe('ALTER TABLE a ADD b');
      expect(page.text(page.find('[hlmAlert] [hlmAlertTitle]'))).toBe(
        'builder.plan.destructiveWarning',
      );
      expect(page.button('builder.plan.apply')!.className).toContain('text-destructive');

      // Accepting a rename plans again with it.
      expect(page.button('builder.plan.replan')).toBeUndefined();
      await page.click(page.find<HTMLButtonElement>('fieldset button[role="checkbox"]')!);
      await page.click('builder.plan.replan');
      expect(page.calls.map((call) => call.path)).toEqual(['/schema/plan', '/schema/plan']);
      expect(page.calls[1].body['renameColumns']).toEqual(['article.title:headline']);

      await page.click('builder.plan.apply');
      const apply = page.calls[2];
      expect(apply.path).toBe('/schema/apply');
      expect(apply.body['allow']).toBe('destructive');
      expect(apply.body['renameColumns']).toEqual(['article.title:headline']);
      const types = apply.body['contentTypes'] as Sources['contentTypes'];
      expect(types['article']['displayName']).toBe('Post');
      expect(page.find('[hlmDialogTitle]')).toBeNull();
      expect(page.schemaLoads()).toBe(1);
      expect(page.sourceLoads()).toBe(2);
      expect(page.dirty()).toBe(false);
    });

    it('plans the removal of the open type', async () => {
      const page = await setup('article', { valid: true, requires: 'safe', steps: [] });
      await page.click('common.delete');
      expect(page.calls[0].body['contentTypes']).toEqual({ article: null });
      expect(page.text(page.find('[hlmDialogDescription]'))).toBe('builder.plan.noChanges');
      await page.click('builder.plan.apply');
      expect(page.calls[1]).toMatchObject({
        path: '/schema/apply',
        body: { contentTypes: { article: null }, allow: 'safe' },
      });
    });

    it('lists the errors of an invalid schema and cannot apply it', async () => {
      const page = await setup('article', {
        valid: false,
        errors: [{ file: 'article', path: 'attributes.title', message: 'is reserved' }],
      });
      await page.click('common.save');
      expect(page.text(page.find('[hlmDialogTitle]'))).toBe('builder.plan.invalidTitle');
      expect(page.text(page.find('[hlmAlert]'))).toBe('attributes.title is reserved');
      expect(page.button('builder.plan.apply')).toBeUndefined();
      await page.click('common.cancel');
      expect(page.find('[hlmDialogTitle]')).toBeNull();
      expect(page.dirty()).toBe(false);
    });
  });
});
