import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';

import { Api } from './api';
import { Preferences } from './preferences';

/** Sidebar badge text: `null` hides it (0 or less), large counts show as `99+`. */
export function formatBadge(count: number | null | undefined, max = 99): string | null {
  if (!count || !Number.isFinite(count) || count <= 0) return null;
  return count > max ? `${max}+` : String(Math.floor(count));
}

const INTERVAL_MS = 60_000;

/**
 * Entries the admin has not seen since they changed, per readable content type
 * (`GET /engagement/unseen`), for the sidebar badges. Polls every minute while started;
 * `refresh()` coalesces bursts (navigation, saves). Off when the user hides the badges.
 */
@Injectable({ providedIn: 'root' })
export class Unseen {
  private readonly api = inject(Api);
  private readonly preferences = inject(Preferences);

  readonly counts = signal<Record<string, number>>({});
  /** The "Show unseen badges" preference (default on). */
  readonly enabled = computed(() => this.preferences.value().unseenBadges !== false);

  private timer: ReturnType<typeof setInterval> | null = null;
  private pending: ReturnType<typeof setTimeout> | null = null;
  private request = 0;

  /** Polls until `destroyRef` is destroyed. */
  start(destroyRef: DestroyRef): void {
    this.stop();
    this.refresh(0);
    this.timer = setInterval(() => this.refresh(0), INTERVAL_MS);
    destroyRef.onDestroy(() => this.stop());
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.pending) clearTimeout(this.pending);
    this.timer = null;
    this.pending = null;
    // Another admin may sign in next.
    this.request++;
    this.counts.set({});
  }

  /** Fetches the counts after `delay` ms; calls in between share one request. */
  refresh(delay = 300): void {
    if (this.pending) clearTimeout(this.pending);
    this.pending = setTimeout(() => {
      this.pending = null;
      void this.fetch();
    }, delay);
  }

  setEnabled(enabled: boolean): void {
    this.preferences.update({ unseenBadges: enabled ? undefined : false });
    if (enabled && this.timer) this.refresh(0);
  }

  private async fetch(): Promise<void> {
    if (!this.enabled()) return;
    const request = ++this.request;
    try {
      const counts = await this.api.get<Record<string, number>>('/engagement/unseen');
      if (request === this.request) this.counts.set(counts ?? {});
    } catch {
      // Keep the last counts; the next poll tries again.
    }
  }
}
