import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';

import { Api, RUNTIME_CONFIG } from './api';
import { Auth } from './auth';
import { EntryKey, Realtime, Viewer } from './realtime';

/** How often the editor says it is still there (presence expires after 45 s). */
export const HEARTBEAT_INTERVAL = 20_000;

/** The other admins on the entry, editors first. */
export function othersOf(viewers: readonly Viewer[], me: number | null | undefined): Viewer[] {
  return viewers
    .filter((viewer) => viewer.userId !== me)
    .sort((a, b) => Number(b.editing) - Number(a.editing) || a.name.localeCompare(b.name));
}

/** Who else holds the soft lock (`null`: nobody, or this admin). */
export function lockHolder(
  viewers: readonly Viewer[],
  me: number | null | undefined,
): Viewer | null {
  return viewers.find((viewer) => viewer.holdsLock && viewer.userId !== me) ?? null;
}

/** Up to two initials of a name or email (`Ada Lovelace` → `AL`, `ada@x.io` → `A`). */
export function initialsOf(name: string): string {
  const words = name
    .split('@')[0]
    .split(/[\s._-]+/)
    .filter(Boolean);
  const letters = words.length > 1 ? [words[0], words[words.length - 1]] : words.slice(0, 1);
  return letters.map((word) => [...word][0]?.toUpperCase() ?? '').join('');
}

/** The heartbeat body `POST /presence` expects. */
export function heartbeatBody(entry: EntryKey, editing: boolean, leave: boolean) {
  return {
    uid: entry.uid,
    documentId: entry.documentId,
    ...(entry.locale ? { locale: entry.locale } : {}),
    editing: editing && !leave,
    leave,
  };
}

/**
 * Presence on the entry an editor has open: heartbeats while it is open (`editing` once
 * the form has unsaved changes), `leave` when it closes, and who else is there, kept up
 * to date by `presence` events. Provided by the entry editor.
 */
@Injectable()
export class EntryPresence {
  private readonly api = inject(Api);
  private readonly auth = inject(Auth);
  private readonly config = inject(RUNTIME_CONFIG);
  private readonly realtime = inject(Realtime);

  readonly viewers = signal<Viewer[]>([]);
  readonly others = computed(() => othersOf(this.viewers(), this.auth.user()?.id));
  /** Another admin who holds the soft lock. */
  readonly holder = computed(() => lockHolder(this.viewers(), this.auth.user()?.id));

  private entry: EntryKey | null = null;
  private editing = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private release: (() => void) | null = null;
  private subscription: Subscription | null = null;
  /** Presence is unavailable (e.g. no realtime on this server): stop trying. */
  private off = false;
  private readonly unload = () => this.leaveOnUnload();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.track(null));
  }

  /** Starts (or moves) presence to `entry`; `null` leaves. */
  track(entry: EntryKey | null): void {
    const same =
      entry &&
      this.entry &&
      entry.uid === this.entry.uid &&
      entry.documentId === this.entry.documentId &&
      (entry.locale ?? '') === (this.entry.locale ?? '');
    if (same) return;
    if (this.entry) {
      void this.send(this.entry, false, true);
      clearInterval(this.timer);
      this.subscription?.unsubscribe();
      this.subscription = null;
      this.release?.();
      this.release = null;
      window.removeEventListener('pagehide', this.unload);
    }
    this.entry = entry;
    this.editing = false;
    this.viewers.set([]);
    if (!entry || this.off) return;
    this.release = this.realtime.retain();
    this.subscription = this.realtime.entry(entry).subscribe((message) => {
      if (message.event === 'presence' && message.presence) this.viewers.set(message.presence);
    });
    this.subscription.add(this.realtime.resync.subscribe(() => void this.beat()));
    this.timer = setInterval(() => void this.beat(), HEARTBEAT_INTERVAL);
    window.addEventListener('pagehide', this.unload);
    void this.beat();
  }

  /** Has unsaved changes: sent at once when it changes. */
  setEditing(editing: boolean): void {
    if (editing === this.editing) return;
    this.editing = editing;
    if (this.entry) void this.beat();
  }

  private async beat(): Promise<void> {
    const entry = this.entry;
    if (!entry || this.off) return;
    const viewers = await this.send(entry, this.editing, false);
    if (viewers && this.entry === entry) this.viewers.set(viewers);
  }

  private async send(entry: EntryKey, editing: boolean, leave: boolean): Promise<Viewer[] | null> {
    try {
      return await this.api.post<Viewer[]>('/presence', heartbeatBody(entry, editing, leave));
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 404) {
        this.off = true;
        clearInterval(this.timer);
      }
      return null;
    }
  }

  /** Closing the tab: a request that outlives the page (HttpClient cannot do that). */
  private leaveOnUnload(): void {
    const entry = this.entry;
    if (!entry) return;
    void this.auth
      .fetch(`${this.config.apiBase}/presence`, {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(heartbeatBody(entry, false, true)),
      })
      .catch(() => undefined);
  }
}
