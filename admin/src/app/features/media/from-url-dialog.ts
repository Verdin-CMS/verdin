import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';

import { ApiFailure } from '../../core/api';
import { I18n } from '../../core/i18n/i18n';
import { Media } from '../../core/media';
import { MediaFile } from '../../core/types';

interface FromUrlForm {
  url: string;
  name: string;
  alternativeText: string;
}

/** "Add from URL": the server downloads the file into the current folder. */
@Component({
  selector: 'vd-media-from-url-dialog',
  imports: [
    NgIcon,
    HlmButtonImports,
    HlmDialogImports,
    HlmFieldImports,
    HlmInputImports,
    HlmSpinnerImports,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-dialog [state]="form() ? 'open' : 'closed'" (closed)="close()">
      <hlm-dialog-content
        *hlmDialogPortal="let ctx"
        class="sm:max-w-md"
        [closeLabel]="t('common.close')"
      >
        @if (form(); as form) {
          <form class="flex flex-col gap-4" (submit)="$event.preventDefault(); add()">
            <hlm-dialog-header>
              <h2 hlmDialogTitle>{{ t('media.fromUrl.title') }}</h2>
              <p hlmDialogDescription>
                {{ t('media.fromUrl.description', { folder: folderName() }) }}
              </p>
            </hlm-dialog-header>
            <div hlmField [attr.data-invalid]="error() ? true : null">
              <label hlmFieldLabel for="media-from-url">{{ t('media.fromUrl.url') }}</label>
              <input
                dir="ltr"
                hlmInput
                id="media-from-url"
                type="url"
                inputmode="url"
                autocomplete="off"
                placeholder="https://"
                required
                [attr.aria-invalid]="error() ? true : null"
                [attr.aria-describedby]="error() ? 'media-from-url-error' : null"
                [value]="form.url"
                (input)="patch({ url: $any($event.target).value })"
              />
              @if (error(); as message) {
                <hlm-field-error forceShow id="media-from-url-error">{{ message }}</hlm-field-error>
              }
            </div>
            <div hlmField>
              <label hlmFieldLabel for="media-from-url-name">{{ t('media.fromUrl.name') }}</label>
              <input
                hlmInput
                id="media-from-url-name"
                [value]="form.name"
                (input)="patch({ name: $any($event.target).value })"
              />
              <p hlmFieldDescription>{{ t('media.fromUrl.nameHint') }}</p>
            </div>
            <div hlmField>
              <label hlmFieldLabel for="media-from-url-alt">{{ t('media.file.alt') }}</label>
              <input
                hlmInput
                id="media-from-url-alt"
                [value]="form.alternativeText"
                (input)="patch({ alternativeText: $any($event.target).value })"
              />
            </div>
            <hlm-dialog-footer>
              <button hlmBtn variant="outline" type="button" (click)="close()">
                {{ t('common.cancel') }}
              </button>
              <button hlmBtn type="submit" [disabled]="fetching() || !form.url.trim()">
                @if (fetching()) {
                  <hlm-spinner />
                } @else {
                  <ng-icon name="lucideDownload" />
                }
                {{ t('media.fromUrl.add') }}
              </button>
            </hlm-dialog-footer>
          </form>
        }
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class MediaFromUrlDialog {
  private readonly media = inject(Media);
  protected readonly t = inject(I18n).t;

  readonly open = input(false);
  /** The folder the file goes to (`null`: the root), and its name. */
  readonly folder = input<number | null>(null);
  readonly folderName = input('');
  readonly added = output<MediaFile>();
  readonly closed = output<void>();

  protected readonly form = signal<FromUrlForm | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly fetching = signal(false);

  constructor() {
    // Each opening starts with an empty form.
    effect(() => {
      const open = this.open();
      untracked(() => {
        this.error.set(null);
        this.form.set(open ? { url: '', name: '', alternativeText: '' } : null);
      });
    });
  }

  protected close(): void {
    this.form.set(null);
    this.closed.emit();
  }

  protected patch(changes: Partial<FromUrlForm>): void {
    this.form.update((form) => (form ? { ...form, ...changes } : form));
    if (changes.url !== undefined) this.error.set(null);
  }

  protected async add(): Promise<void> {
    const form = this.form();
    if (!form || !form.url.trim() || this.fetching()) return;
    this.fetching.set(true);
    this.error.set(null);
    try {
      const file = await this.media.fromUrl({
        url: form.url.trim(),
        folder: this.folder(),
        ...(form.name.trim() ? { name: form.name.trim() } : {}),
        ...(form.alternativeText.trim() ? { alternativeText: form.alternativeText.trim() } : {}),
      });
      toast.success(this.t('media.fromUrl.done', { name: file.name }));
      this.close();
      this.added.emit(file);
    } catch (error) {
      this.error.set(ApiFailure.from(error).message);
    } finally {
      this.fetching.set(false);
    }
  }
}
