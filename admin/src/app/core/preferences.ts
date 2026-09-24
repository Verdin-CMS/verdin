import { Injectable, signal } from '@angular/core';

import type { Weekday } from './i18n/week';

/** Per-browser admin preferences. */
export interface PreferenceValues {
  locale?: string;
  theme?: 'light' | 'dark' | 'system';
  weekStart?: Weekday;
}

const KEY = 'verdin.preferences';

/** Preferences kept in `localStorage`; storage may be unavailable (private mode, policies). */
@Injectable({ providedIn: 'root' })
export class Preferences {
  readonly value = signal<PreferenceValues>(read());

  update(changes: Partial<PreferenceValues>): void {
    const next = { ...this.value(), ...changes };
    for (const key of Object.keys(next) as (keyof PreferenceValues)[]) {
      if (next[key] === undefined) delete next[key];
    }
    this.value.set(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Not persisted; the choice still applies to this session.
    }
  }
}

function read(): PreferenceValues {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as PreferenceValues) : {};
  } catch {
    return {};
  }
}
