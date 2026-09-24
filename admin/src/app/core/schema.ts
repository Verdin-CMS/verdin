import { Injectable, computed, inject, signal } from '@angular/core';

import { Api } from './api';
import { Component, ContentType, SystemInfo } from './types';

/** Content types and components the admin can see, plus server info. */
@Injectable({ providedIn: 'root' })
export class Schema {
  private readonly api = inject(Api);

  readonly contentTypes = signal<ContentType[]>([]);
  readonly components = signal<Component[]>([]);
  readonly info = signal<SystemInfo | null>(null);
  readonly loaded = signal(false);

  readonly collections = computed(() =>
    this.contentTypes()
      .filter((type) => type.kind === 'collectionType')
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
  );
  readonly singles = computed(() =>
    this.contentTypes()
      .filter((type) => type.kind === 'singleType')
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
  );
  readonly devMode = computed(() => this.info()?.mode === 'development');

  async load(): Promise<void> {
    const [types, components, info] = await Promise.all([
      this.api.get<ContentType[]>('/content-types'),
      this.api.get<Component[]>('/components'),
      this.api.get<SystemInfo>('/system/info'),
    ]);
    this.contentTypes.set(types);
    this.components.set(components);
    this.info.set(info);
    this.loaded.set(true);
  }

  type(uid: string): ContentType | undefined {
    return this.contentTypes().find((type) => type.uid === uid);
  }

  component(uid: string): Component | undefined {
    return this.components().find((component) => component.uid === uid);
  }

  /** The attribute shown as a document's title: the first string-like attribute. */
  titleField(type: ContentType): string | null {
    const entry = Object.entries(type.attributes).find(([, attribute]) =>
      ['string', 'uid', 'email', 'text'].includes(attribute.type),
    );
    return entry?.[0] ?? null;
  }
}
