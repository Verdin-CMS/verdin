import { LiveAnnouncer } from '@angular/cdk/a11y';
import { Dialog } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, afterNextRender } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MAIN_CONTENT_ID, RouteFocus, urlPath } from './route-focus';

@Component({
  selector: 'vd-with-heading',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div id="${MAIN_CONTENT_ID}">
    <button type="button">Before</button>
    <h1>Webhooks</h1>
  </div>`,
})
class WithHeading {}

@Component({
  selector: 'vd-without-heading',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div id="${MAIN_CONTENT_ID}"><p>No heading here</p></div>`,
})
class WithoutHeading {}

@Component({
  selector: 'vd-focusing',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div id="${MAIN_CONTENT_ID}">
    <h1>Search</h1>
    <input id="own-field" />
  </div>`,
})
class Focusing {
  constructor() {
    afterNextRender(() => document.getElementById('own-field')?.focus());
  }
}

async function setup() {
  const announce = vi.fn(async () => undefined);
  const dialog = {
    afterOpened: new Subject<void>(),
    afterAllClosed: new Subject<void>(),
    openDialogs: [] as unknown[],
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'webhooks', component: WithHeading },
        { path: 'roles', component: WithHeading },
        { path: 'empty', component: WithoutHeading },
        { path: 'search', component: Focusing },
      ]),
      { provide: LiveAnnouncer, useValue: { announce } },
      { provide: Dialog, useValue: dialog },
    ],
  });
  TestBed.inject(RouteFocus).start();
  const harness = await RouterTestingHarness.create();
  const visit = async (url: string) => {
    await harness.navigateByUrl(url);
    await harness.fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    TestBed.tick();
  };
  return { announce, dialog, visit };
}

describe('urlPath', () => {
  it('drops the query and the fragment', () => {
    expect(urlPath('/content/a?page=2&sort=title')).toBe('/content/a');
    expect(urlPath('/profile#two-factor')).toBe('/profile');
    expect(urlPath('/settings')).toBe('/settings');
  });
});

describe('RouteFocus', () => {
  it('leaves the first page alone', async () => {
    const { visit, announce } = await setup();
    document.title = 'Webhooks · Settings · Verdin';
    await visit('/webhooks');
    expect(document.activeElement?.tagName).not.toBe('H1');
    expect(announce).not.toHaveBeenCalled();
  });

  it('focuses the main heading after a navigation and announces the title', async () => {
    const { visit, announce } = await setup();
    await visit('/webhooks');
    document.title = 'Roles · Settings · Verdin';
    await visit('/roles');
    const heading = document.activeElement as HTMLElement;
    expect(heading.tagName).toBe('H1');
    expect(heading.getAttribute('tabindex')).toBe('-1');
    expect(announce).toHaveBeenCalledWith('Roles · Settings · Verdin', 'polite');
  });

  it('falls back to the content region without a heading', async () => {
    const { visit } = await setup();
    await visit('/webhooks');
    await visit('/empty');
    expect(document.activeElement?.id).toBe(MAIN_CONTENT_ID);
  });

  it('ignores query changes (a list filtering itself)', async () => {
    const { visit, announce } = await setup();
    await visit('/webhooks');
    await visit('/roles');
    announce.mockClear();
    const button = document.querySelector<HTMLButtonElement>('button')!;
    button.focus();
    await visit('/roles?page=2');
    expect(document.activeElement).toBe(button);
    expect(announce).not.toHaveBeenCalled();
  });

  it('keeps a focus the new page set itself, and still announces', async () => {
    const { visit, announce } = await setup();
    await visit('/webhooks');
    document.title = 'Search';
    await visit('/search');
    expect(document.activeElement?.id).toBe('own-field');
    expect(announce).toHaveBeenCalledWith('Search', 'polite');
  });

  it('moves the focus to the heading when a closed dialog has nowhere to return it', async () => {
    const { visit, dialog } = await setup();
    await visit('/webhooks');
    (document.activeElement as HTMLElement | null)?.blur();
    dialog.afterOpened.next();
    dialog.afterAllClosed.next();
    await new Promise((resolve) => setTimeout(resolve));
    expect(document.activeElement?.tagName).toBe('H1');
  });

  it('leaves the focus a dialog returned to its trigger', async () => {
    const { visit, dialog } = await setup();
    await visit('/webhooks');
    const trigger = document.querySelector<HTMLButtonElement>('button')!;
    trigger.focus();
    dialog.afterOpened.next();
    dialog.afterAllClosed.next();
    await new Promise((resolve) => setTimeout(resolve));
    expect(document.activeElement).toBe(trigger);
  });
});
