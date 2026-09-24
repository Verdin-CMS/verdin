import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';

import { Preferences } from './preferences';

export type ThemeChoice = 'light' | 'dark' | 'system';

/** Light, dark or following the system; toggles the `dark` class spartan's tokens key on. */
@Injectable({ providedIn: 'root' })
export class Theme {
  private readonly document = inject(DOCUMENT);
  private readonly preferences = inject(Preferences);

  readonly choice = computed<ThemeChoice>(() => this.preferences.value().theme ?? 'system');
  private readonly systemDark = signal(false);
  readonly dark = computed(() =>
    this.choice() === 'system' ? this.systemDark() : this.choice() === 'dark',
  );

  constructor() {
    const media = this.document.defaultView?.matchMedia?.('(prefers-color-scheme: dark)');
    if (media) {
      this.systemDark.set(media.matches);
      const listener = (event: MediaQueryListEvent) => this.systemDark.set(event.matches);
      media.addEventListener('change', listener);
      inject(DestroyRef).onDestroy(() => media.removeEventListener('change', listener));
    }
    effect(() => {
      const root = this.document.documentElement;
      root.classList.toggle('dark', this.dark());
      root.style.colorScheme = this.dark() ? 'dark' : 'light';
    });
  }

  set(choice: ThemeChoice): void {
    this.preferences.update({ theme: choice === 'system' ? undefined : choice });
  }
}
