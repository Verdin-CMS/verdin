import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';

import { ApiFailure } from '../../core/api';
import { I18n } from '../../core/i18n/i18n';
import { Media } from '../../core/media';
import { MediaFolder } from '../../core/types';
import { folderOptions, isWithin } from './media-format';

/** What the folder dialog does: create/rename a folder, or move a folder or files. */
export type FolderDialogRequest =
  | { mode: 'create'; name: string }
  | { mode: 'rename'; folder: MediaFolder; name: string }
  | { mode: 'move'; folder: MediaFolder; target: number | null }
  | { mode: 'moveFiles'; ids: number[]; target: number | null };

/** The media library's folder dialog; it saves the change itself, then emits `done`. */
@Component({
  selector: 'vd-media-folder-dialog',
  imports: [
    HlmButtonImports,
    HlmDialogImports,
    HlmFieldImports,
    HlmInputImports,
    HlmNativeSelectImports,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-dialog [state]="dialog() ? 'open' : 'closed'" (closed)="closed.emit()">
      <hlm-dialog-content *hlmDialogPortal="let ctx" class="sm:max-w-md">
        @if (dialog(); as current) {
          <form class="flex flex-col gap-4" (submit)="$event.preventDefault(); submit()">
            <hlm-dialog-header>
              <h2 hlmDialogTitle>{{ title() }}</h2>
              @if (current.mode === 'moveFiles') {
                <p hlmDialogDescription>
                  {{ t('media.selection.moveHint', { count: current.ids.length }) }}
                </p>
              }
            </hlm-dialog-header>
            @if (current.mode === 'create' || current.mode === 'rename') {
              <div hlmField>
                <label hlmFieldLabel for="media-folder-name">{{ t('common.name') }}</label>
                <input
                  hlmInput
                  id="media-folder-name"
                  autocomplete="off"
                  [value]="current.name"
                  (input)="setName($any($event.target).value)"
                />
              </div>
            } @else {
              <div hlmField>
                <label hlmFieldLabel for="media-folder-target">{{
                  t('media.folder.destination')
                }}</label>
                <hlm-native-select
                  selectId="media-folder-target"
                  [value]="current.target === null ? '' : String(current.target)"
                  (valueChange)="setTarget($event ? Number($event) : null)"
                >
                  <option hlmNativeSelectOption value="">{{ t('media.root') }}</option>
                  @for (option of targetOptions(); track option.id) {
                    <option hlmNativeSelectOption [value]="String(option.id)">
                      {{ option.label }}
                    </option>
                  }
                </hlm-native-select>
              </div>
            }
            <hlm-dialog-footer>
              <button hlmBtn variant="outline" type="button" (click)="ctx.close()">
                {{ t('common.cancel') }}
              </button>
              <button hlmBtn type="submit" [disabled]="busy() || !valid()">
                {{ current.mode === 'create' ? t('common.create') : t('common.save') }}
              </button>
            </hlm-dialog-footer>
          </form>
        }
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class MediaFolderDialog {
  private readonly media = inject(Media);
  protected readonly t = inject(I18n).t;
  protected readonly String = String;
  protected readonly Number = Number;

  /** The dialog to show; `null` closes it. */
  readonly request = input<FolderDialogRequest | null>(null);
  /** Every folder (move destinations). */
  readonly folders = input<MediaFolder[]>([]);
  /** Where a new folder goes. */
  readonly parent = input<number | null>(null);
  /** The change was saved (files moved: some may have failed, as toasts said). */
  readonly done = output<FolderDialogRequest>();
  readonly closed = output<void>();

  /** The request as edited in the dialog. */
  protected readonly dialog = linkedSignal(() => this.request());
  protected readonly busy = signal(false);

  protected readonly title = computed(() => {
    const dialog = this.dialog();
    switch (dialog?.mode) {
      case 'create':
        return this.t('media.folder.new');
      case 'rename':
        return this.t('media.folder.renameTitle', { name: dialog.folder.name });
      case 'move':
        return this.t('media.folder.moveTitle', { name: dialog.folder.name });
      case 'moveFiles':
        return this.t('media.selection.moveTitle', { count: dialog.ids.length });
      default:
        return '';
    }
  });
  protected readonly valid = computed(() => {
    const dialog = this.dialog();
    if (!dialog) return false;
    if (dialog.mode === 'create' || dialog.mode === 'rename') return !!dialog.name.trim();
    return true;
  });
  /** Destinations for a move: never the folder itself or a folder below it. */
  protected readonly targetOptions = computed(() => {
    const dialog = this.dialog();
    const all = this.folders();
    const moving = dialog?.mode === 'move' ? dialog.folder : null;
    const allowed = moving ? all.filter((folder) => !isWithin(folder, moving)) : all;
    return folderOptions(allowed);
  });

  protected setName(name: string): void {
    this.dialog.update((dialog) =>
      dialog && (dialog.mode === 'create' || dialog.mode === 'rename')
        ? { ...dialog, name }
        : dialog,
    );
  }

  protected setTarget(target: number | null): void {
    this.dialog.update((dialog) =>
      dialog && (dialog.mode === 'move' || dialog.mode === 'moveFiles')
        ? { ...dialog, target }
        : dialog,
    );
  }

  protected async submit(): Promise<void> {
    const dialog = this.dialog();
    if (!dialog || !this.valid()) return;
    this.busy.set(true);
    try {
      switch (dialog.mode) {
        case 'create':
          await this.media.createFolder(dialog.name.trim(), this.parent());
          toast.success(this.t('media.folder.created'));
          break;
        case 'rename':
          await this.media.updateFolder(dialog.folder.id, { name: dialog.name.trim() });
          toast.success(this.t('media.folder.renamed'));
          break;
        case 'move':
          await this.media.updateFolder(dialog.folder.id, { parent: dialog.target });
          toast.success(this.t('media.folder.moved'));
          break;
        case 'moveFiles': {
          const results = await Promise.allSettled(
            dialog.ids.map((id) => this.media.update(id, { folder: dialog.target })),
          );
          const failed = results.filter((result) => result.status === 'rejected').length;
          const done = dialog.ids.length - failed;
          if (done) toast.success(this.t('media.selection.moved', { count: done }));
          if (failed) toast.error(this.t('media.selection.moveFailed', { count: failed }));
          break;
        }
      }
      this.done.emit(dialog);
    } catch (error) {
      toast.error(this.t('media.folder.saveFailed'), {
        description: ApiFailure.from(error).message,
      });
    } finally {
      this.busy.set(false);
    }
  }
}
