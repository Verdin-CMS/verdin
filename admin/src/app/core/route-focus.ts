import { LiveAnnouncer } from '@angular/cdk/a11y';
import { Dialog } from '@angular/cdk/dialog';
import { DOCUMENT } from '@angular/common';
import { Injectable, Injector, afterNextRender, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter, switchMap, take } from 'rxjs';

/** The id of the shell's content region: the skip link's target. */
export const MAIN_CONTENT_ID = 'main-content';

/** The path of a URL, without its query and fragment. */
export function urlPath(url: string): string {
  return url.split(/[?#]/)[0];
}

/**
 * Keyboard and screen reader users follow navigations: after each one that changes the
 * page (not only its query, such as a list's filters) focus moves to the page's main
 * heading, or else its content region, and the new title is announced politely. The first
 * page load is left alone: the browser announces the document itself.
 *
 * Dialogs return focus to their trigger themselves (the CDK's `restoreFocus`); when that
 * trigger is gone (the row a dialog deleted), focus would fall to the page's body, so it
 * goes to the main heading instead.
 */
@Injectable({ providedIn: 'root' })
export class RouteFocus {
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly announcer = inject(LiveAnnouncer);
  private readonly dialog = inject(Dialog);
  private started = false;
  private lastPath: string | null = null;

  start(): void {
    if (this.started) return;
    this.started = true;
    this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe((event) => this.navigated(event.urlAfterRedirects));
    this.dialog.afterOpened
      .pipe(switchMap(() => this.dialog.afterAllClosed.pipe(take(1))))
      .subscribe(() =>
        // After the dialog's own focus restoration.
        setTimeout(() => {
          if (this.focusLost()) this.focusMain();
        }),
      );
  }

  /** Focuses the main heading (or the content region) and announces `title`. */
  focusMain(title?: string): boolean {
    const target = this.target();
    if (target) {
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.setAttribute('data-route-focus', '');
      target.focus({ preventScroll: true });
    }
    if (title) void this.announcer.announce(title, 'polite');
    return !!target;
  }

  private navigated(url: string): void {
    const path = urlPath(url);
    const previous = this.lastPath;
    this.lastPath = path;
    if (previous === null || previous === path) return;
    afterNextRender(
      {
        read: () => {
          // A dialog the new page opened, or a field it focused, keeps the focus.
          if (this.dialog.openDialogs.length || this.focusedInPage()) {
            void this.announcer.announce(this.document.title, 'polite');
            return;
          }
          this.focusMain(this.document.title);
        },
      },
      { injector: this.injector },
    );
  }

  private target(): HTMLElement | null {
    const main = this.document.getElementById(MAIN_CONTENT_ID);
    const scope: ParentNode = main ?? this.document;
    return scope.querySelector<HTMLElement>('h1') ?? main;
  }

  /** Something in the page's content has the focus (the page moved it there itself). */
  private focusedInPage(): boolean {
    const main = this.document.getElementById(MAIN_CONTENT_ID);
    const active = this.document.activeElement;
    return !!main && !!active && active !== main && active.isConnected && main.contains(active);
  }

  private focusLost(): boolean {
    const active = this.document.activeElement;
    return !active || active === this.document.body || !active.isConnected;
  }
}
