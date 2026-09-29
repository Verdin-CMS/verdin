import { Injectable, inject, signal } from '@angular/core';

import { Api } from './api';

/** A feature as `/features` reports it. */
export interface Feature {
  id: string;
  available: boolean;
  planned: string | null;
  core: boolean;
  enabled: boolean;
  settings: Record<string, unknown> | null;
}

/** The feature catalog with its switches; any admin may read it, and the panel adapts to it. */
@Injectable({ providedIn: 'root' })
export class Features {
  private readonly api = inject(Api);

  /** `null` until loaded. */
  readonly catalog = signal<Feature[] | null>(null);

  private loading: Promise<Feature[] | null> | null = null;

  async load(): Promise<Feature[]> {
    const features = await this.api.get<Feature[]>('/features');
    this.catalog.set(features);
    return features;
  }

  /** The catalog, loaded once if needed (`null` when it cannot be read). */
  async ensure(): Promise<Feature[] | null> {
    const catalog = this.catalog();
    if (catalog) return catalog;
    this.loading ??= this.load()
      .catch(() => null)
      .finally(() => (this.loading = null));
    return this.loading;
  }

  async update(
    id: string,
    enabled: boolean,
    settings: Record<string, unknown> | null,
  ): Promise<Feature[]> {
    const features = await this.api.put<Feature[]>(`/features/${id}`, { enabled, settings });
    this.catalog.set(features);
    return features;
  }

  /** The stored settings of a feature (`null` when none or not loaded). */
  settings(id: string): Record<string, unknown> | null {
    return (this.catalog() ?? []).find((feature) => feature.id === id)?.settings ?? null;
  }

  enabled(id: string): boolean {
    return (this.catalog() ?? []).some((feature) => feature.id === id && feature.enabled);
  }
}
