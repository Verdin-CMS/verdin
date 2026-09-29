import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';

import { ApiFailure } from '../../core/api';
import { I18n } from '../../core/i18n/i18n';
import { Schema } from '../../core/schema';
import { HasUnsavedChanges } from '../../shared/components/confirm';
import { DocumentForm } from './editor/document-form';
import { EntryLoader, LoadedEntry } from './editor/entry-loader';

/**
 * The entry editor's route (`/content/:uid/:documentId`, `/content/:uid/new`,
 * `/single/:uid`): loads the entry with `EntryLoader`, then renders a fresh `DocumentForm`
 * for it (recreated whenever the route's entry or locale changes, or on a reload).
 */
@Component({
  selector: 'vd-content-edit',
  imports: [DocumentForm, NgIcon, HlmSpinnerImports, HlmAlertImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (error()) {
      <div hlmAlert variant="destructive">
        <ng-icon name="lucideCircleAlert" />
        <p hlmAlertTitle>{{ error() }}</p>
      </div>
    } @else if (loading() || !type() || !entry()) {
      <div
        class="text-muted-foreground flex items-center justify-center gap-2 py-24 text-sm"
        role="status"
      >
        <hlm-spinner /> {{ t('common.loading') }}
      </div>
    } @else {
      @let loaded = entry()!;
      @for (key of [loadKey()]; track key) {
        <vd-document-form
          [type]="type()!"
          [document]="loaded.document"
          [publishedAt]="loaded.publishedAt"
          [locale]="loaded.locale"
          [versions]="loaded.versions"
          [existingId]="loaded.existingId"
          [sharedSource]="loaded.sharedSource"
          [view]="loaded.view"
          [focus]="field() ?? null"
          (reload)="reload()"
        />
      }
    }
  `,
})
export class ContentEdit implements HasUnsavedChanges {
  private readonly loader = inject(EntryLoader);
  private readonly schema = inject(Schema);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;

  readonly uid = input.required<string>();
  readonly documentId = input<string>();
  /** `?locale=` (localized types; the default locale otherwise). */
  readonly locale = input<string>();
  /** `?field=`: a field to scroll to (links from the visual editing overlay). */
  readonly field = input<string>();

  protected readonly type = computed(() => this.schema.type(this.uid()));
  protected readonly entry = signal<LoadedEntry | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly loadKey = signal('');
  private readonly form = viewChild(DocumentForm);

  /** For the route's unsaved changes guard. */
  hasUnsavedChanges(): boolean {
    return this.form()?.hasUnsavedChanges() ?? false;
  }

  constructor() {
    // Reload whenever the route's type or document changes.
    effect(() => {
      const key = `${this.uid()}|${this.documentId() ?? ''}|${this.locale() ?? ''}`;
      untracked(() => void this.load(key));
    });
  }

  /** Loads the entry again, with a fresh form (another admin changed it). */
  protected reload(): void {
    const key = `${this.uid()}|${this.documentId() ?? ''}|${this.locale() ?? ''}`;
    void this.load(`${key}|${++this.reloads}`);
  }

  private reloads = 0;

  /** Identifies the latest load; an older one stops once it notices. */
  private requests = 0;

  private async load(key: string): Promise<void> {
    const request = ++this.requests;
    const stale = () => request !== this.requests;
    this.loading.set(true);
    this.error.set(null);
    this.entry.set(null);
    const uid = this.uid();
    const type = this.type();
    if (!type) {
      this.error.set(this.t('content.edit.unknownType', { uid }));
      this.loading.set(false);
      return;
    }
    try {
      const entry = await this.loader.load(
        type,
        { documentId: this.documentId(), locale: this.locale() },
        stale,
      );
      if (!entry || stale()) return;
      this.entry.set(entry);
      this.loadKey.set(key);
    } catch (error) {
      if (stale()) return;
      const failure = ApiFailure.from(error);
      this.error.set(failure.status === 404 ? this.t('content.edit.notFound') : failure.message);
    } finally {
      if (!stale()) this.loading.set(false);
    }
  }
}
