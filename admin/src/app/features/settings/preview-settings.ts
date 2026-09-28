import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';

import { Api, ApiFailure } from '../../core/api';
import {
  PREVIEW_MAX_TTL,
  previewSettingsFrom,
  previewTtlProblem,
  readPreviewSettings,
  validPreviewTemplate,
} from '../../core/feature-settings';
import { Feature, Features } from '../../core/features';
import { I18n } from '../../core/i18n/i18n';
import { Schema } from '../../core/schema';

/** Settings → Features → Preview: a URL template per content type, and the token lifetime. */
@Component({
  selector: 'vd-preview-settings',
  imports: [
    NgIcon,
    HlmAlertImports,
    HlmButtonImports,
    HlmDialogImports,
    HlmFieldImports,
    HlmInputImports,
    HlmSpinnerImports,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-dialog [state]="open() ? 'open' : 'closed'" (closed)="closed.emit()">
      <hlm-dialog-content
        *hlmDialogPortal="let ctx"
        class="max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-2xl"
        [closeLabel]="t('common.close')"
      >
        <hlm-dialog-header>
          <h2 hlmDialogTitle>{{ t('features.preview.settingsTitle') }}</h2>
          <p hlmDialogDescription>{{ t('features.preview.settingsDescription') }}</p>
        </hlm-dialog-header>
        <form
          id="preview-settings-form"
          class="-mx-6 flex min-h-0 flex-col gap-5 overflow-y-auto px-6"
          novalidate
          (submit)="$event.preventDefault(); save()"
        >
          <div class="bg-muted/50 flex flex-col gap-1.5 rounded-lg p-3 text-xs">
            <p class="font-medium">{{ t('features.preview.placeholders') }}</p>
            <ul class="text-muted-foreground flex flex-col gap-1">
              <li>
                <code class="bg-background rounded px-1 font-mono">{{ ph.field }}</code>
                {{ t('features.preview.placeholderField') }}
              </li>
              <li>
                <code class="bg-background rounded px-1 font-mono">{{ ph.documentId }}</code>
                ·
                <code class="bg-background rounded px-1 font-mono">{{ ph.uid }}</code>
                {{ t('features.preview.placeholderIds') }}
              </li>
              <li>
                <code class="bg-background rounded px-1 font-mono">{{ ph.token }}</code>
                {{ t('features.preview.placeholderToken') }}
              </li>
            </ul>
          </div>

          <fieldset class="flex flex-col gap-4">
            <legend class="mb-2 text-sm font-medium">{{ t('features.preview.urls') }}</legend>
            @for (row of rows(); track row.uid; let index = $index) {
              @let id = 'preview-url-' + index;
              @let invalid = row.template.trim() !== '' && !valid(row.template);
              <div hlmField [attr.data-invalid]="invalid ? true : null">
                <label hlmFieldLabel [for]="id">
                  {{ row.name }}
                  <span class="text-muted-foreground font-mono text-xs font-normal">{{
                    row.uid
                  }}</span>
                </label>
                <input
                  dir="ltr"
                  hlmInput
                  type="url"
                  spellcheck="false"
                  autocomplete="off"
                  class="font-mono text-xs"
                  [id]="id"
                  [attr.aria-invalid]="invalid ? true : null"
                  [attr.aria-describedby]="invalid ? id + '-error' : null"
                  [placeholder]="example(row.uid)"
                  [value]="row.template"
                  (input)="setTemplate(index, $any($event.target).value)"
                />
                @if (invalid) {
                  <p class="text-destructive text-sm" [id]="id + '-error'">
                    {{ t('features.preview.invalidUrl') }}
                  </p>
                }
              </div>
            } @empty {
              <p class="text-muted-foreground text-sm">{{ t('features.preview.noTypes') }}</p>
            }
          </fieldset>

          <div hlmField [attr.data-invalid]="ttlProblem() ? true : null">
            <label hlmFieldLabel for="preview-ttl">{{ t('features.preview.ttl') }}</label>
            <input
              hlmInput
              id="preview-ttl"
              type="number"
              inputmode="numeric"
              min="1"
              [max]="maxTtl"
              step="1"
              class="max-w-40"
              placeholder="60"
              [attr.aria-invalid]="ttlProblem() ? true : null"
              aria-describedby="preview-ttl-hint"
              [value]="ttl()"
              (input)="ttl.set($any($event.target).value)"
            />
            <p class="text-muted-foreground text-xs" id="preview-ttl-hint">
              {{ t('features.preview.ttlHint', { max: maxTtl }) }}
            </p>
          </div>

          <section
            class="flex flex-col gap-2 rounded-lg border p-3 text-xs"
            aria-labelledby="visual-editing-title"
          >
            <h3 id="visual-editing-title" class="flex items-center gap-1.5 text-sm font-medium">
              <ng-icon name="lucideCrosshair" aria-hidden="true" />
              {{ t('visualEditing.settings.title') }}
            </h3>
            <p class="text-muted-foreground">{{ t('visualEditing.settings.hint') }}</p>
            <p id="visual-editing-script">{{ t('visualEditing.settings.script') }}</p>
            <div class="flex items-start gap-1">
              <pre
                dir="ltr"
                class="bg-muted min-w-0 flex-1 overflow-x-auto rounded p-2 font-mono"
                aria-labelledby="visual-editing-script"
              ><code>{{ scriptTag }}</code></pre>
              <button
                hlmBtn
                variant="ghost"
                size="icon-xs"
                type="button"
                [attr.aria-label]="t('visualEditing.settings.copyScript')"
                [title]="t('visualEditing.settings.copyScript')"
                (click)="copy(scriptTag)"
              >
                <ng-icon name="lucideCopy" />
              </button>
            </div>
            <p id="visual-editing-header">{{ t('visualEditing.settings.header') }}</p>
            <pre
              dir="ltr"
              class="bg-muted overflow-x-auto rounded p-2 font-mono"
              aria-labelledby="visual-editing-header"
            ><code>{{ stegaHeader }}</code></pre>
            <p class="text-muted-foreground">{{ t('visualEditing.settings.privacy') }}</p>
          </section>

          @if (error()) {
            <div hlmAlert variant="destructive" role="alert">
              <ng-icon hlmAlertIcon name="lucideCircleAlert" />
              <p hlmAlertTitle>{{ t('features.settingsRejected') }}</p>
              <p hlmAlertDescription>{{ error() }}</p>
            </div>
          }
        </form>
        <hlm-dialog-footer>
          <button hlmBtn type="button" variant="outline" (click)="closed.emit()">
            {{ t('common.cancel') }}
          </button>
          <button
            hlmBtn
            type="submit"
            form="preview-settings-form"
            [disabled]="saving() || invalid()"
          >
            @if (saving()) {
              <hlm-spinner class="size-4" />
            }
            {{ t('common.save') }}
          </button>
        </hlm-dialog-footer>
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class PreviewSettingsDialog {
  private readonly features = inject(Features);
  private readonly schema = inject(Schema);
  protected readonly t = inject(I18n).t;

  readonly open = input(false);
  readonly feature = input.required<Feature>();
  readonly closed = output<void>();

  protected readonly maxTtl = PREVIEW_MAX_TTL;
  /** Placeholders as shown (braces are template syntax). */
  protected readonly ph = {
    field: '{field}',
    documentId: '{documentId}',
    uid: '{uid}',
    token: '{token}',
  };
  protected readonly rows = signal<{ uid: string; name: string; template: string }[]>([]);
  protected readonly ttl = signal('');
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly ttlProblem = computed(() => previewTtlProblem(this.ttl()));
  protected readonly invalid = computed(
    () =>
      !!this.ttlProblem() ||
      this.rows().some((row) => row.template.trim() && !validPreviewTemplate(row.template)),
  );
  protected readonly valid = validPreviewTemplate;
  /** Visual editing: the overlay script to load on preview pages, and the header to send. */
  protected readonly scriptTag = `<script src="${
    new URL(`${inject(Api).base}/visual-editing.js`, location.href).href
  }" defer></script>`;
  protected readonly stegaHeader = 'x-verdin-stega: true';

  constructor() {
    effect(() => {
      if (!this.open()) return;
      const feature = this.feature();
      untracked(() => {
        const settings = readPreviewSettings(feature.settings);
        const types = [...this.schema.contentTypes()].sort((a, b) =>
          a.displayName.localeCompare(b.displayName),
        );
        const rows = types.map((type) => ({
          uid: type.uid,
          name: type.displayName,
          template: settings.urls[type.uid] ?? '',
        }));
        // Templates of types that no longer exist stay (the server keeps them).
        for (const [uid, template] of Object.entries(settings.urls)) {
          if (!rows.some((row) => row.uid === uid)) rows.push({ uid, name: uid, template });
        }
        this.rows.set(rows);
        this.ttl.set(settings.ttlMinutes !== undefined ? String(settings.ttlMinutes) : '');
        this.error.set(null);
      });
    });
  }

  protected example(uid: string): string {
    const type = this.schema.type(uid);
    const name = type?.singularName ?? 'entry';
    return `https://example.com/${name}/{documentId}`;
  }

  protected async copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(this.t('common.copied'));
    } catch {
      toast.error(this.t('visualEditing.settings.copyFailed'));
    }
  }

  protected setTemplate(index: number, template: string): void {
    this.rows.update((rows) => rows.map((row, i) => (i === index ? { ...row, template } : row)));
  }

  protected async save(): Promise<void> {
    if (this.invalid() || this.saving()) return;
    const feature = this.feature();
    this.saving.set(true);
    this.error.set(null);
    try {
      const settings = previewSettingsFrom(this.rows(), this.ttl());
      await this.features.update(feature.id, feature.enabled, { ...settings });
      toast.success(this.t('features.settingsSaved', { name: this.t('features.preview.name') }));
      this.closed.emit();
    } catch (error) {
      this.error.set(ApiFailure.from(error).message);
    } finally {
      this.saving.set(false);
    }
  }
}
