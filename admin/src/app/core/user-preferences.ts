import { Injectable, inject, signal } from '@angular/core';

import { Api } from './api';
import { Auth } from './auth';

export type PreferenceObject = Record<string, unknown>;

const PATH = '/users/me/preferences';

/** A plain JSON object, or `{}` for anything else (the stored value is user-writable). */
export function asObject(value: unknown): PreferenceObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as PreferenceObject)
    : {};
}

/**
 * `preferences` with `path` (e.g. `['listViews', 'api::article.article']`) set to `value`,
 * or removed when `value` is `undefined`. Other keys are kept; emptied parents are dropped.
 */
export function setPreference(
  preferences: PreferenceObject,
  path: readonly string[],
  value: unknown,
): PreferenceObject {
  const [head, ...rest] = path;
  if (head === undefined) return preferences;
  const next: PreferenceObject = { ...preferences };
  const child = rest.length ? setPreference(asObject(next[head]), rest, value) : value;
  const empty =
    child === undefined || (rest.length > 0 && Object.keys(child as PreferenceObject).length === 0);
  if (empty) delete next[head];
  else next[head] = child;
  return next;
}

/**
 * The signed-in user's server-side preferences (one JSON object shared by every feature:
 * dashboard layout, list views…). Each change is a queued read-modify-write of the
 * whole object against the latest server copy, so features never drop each other's keys.
 */
@Injectable({ providedIn: 'root' })
export class UserPreferences {
  private readonly api = inject(Api);
  private readonly auth = inject(Auth);

  readonly value = signal<PreferenceObject>({});
  readonly loaded = signal(false);

  private loading: Promise<PreferenceObject> | null = null;
  /** Whose preferences `value` holds (a new sign-in fetches them again). */
  private owner: number | null = null;
  private writes: Promise<unknown> = Promise.resolve();

  /** Fetches the preferences once per user (later calls share it); `{}` on failure. */
  load(): Promise<PreferenceObject> {
    const owner = this.auth.user()?.id ?? null;
    if (owner !== this.owner) {
      this.owner = owner;
      this.loading = null;
      this.loaded.set(false);
      this.value.set({});
    }
    this.loading ??= this.api
      .get<unknown>(PATH)
      .then(asObject)
      .catch(() => ({}))
      .then((value) => {
        if (this.owner === owner) {
          this.value.set(value);
          this.loaded.set(true);
        }
        return value;
      });
    return this.loading;
  }

  /** Sets (or with `undefined`, removes) the value at `path` and saves it. */
  set(path: readonly string[], value: unknown): Promise<void> {
    this.value.set(setPreference(this.value(), path, value));
    const write = this.writes
      .catch(() => undefined)
      .then(async () => {
        const latest = await this.api.get<unknown>(PATH).then(asObject);
        const next = setPreference(latest, path, value);
        await this.api.put(PATH, { data: next });
      });
    this.writes = write;
    return write;
  }
}
