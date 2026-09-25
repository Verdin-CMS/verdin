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

  async load(): Promise<Feature[]> {
    const features = await this.api.get<Feature[]>('/features');
    this.catalog.set(features);
    return features;
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

  enabled(id: string): boolean {
    return (this.catalog() ?? []).some((feature) => feature.id === id && feature.enabled);
  }
}
