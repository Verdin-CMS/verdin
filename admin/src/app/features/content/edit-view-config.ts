import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList } from '@angular/cdk/drag-drop';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { HlmSwitchImports } from '@spartan-ng/helm/switch';

import { ApiFailure } from '../../core/api';
import { Auth } from '../../core/auth';
import {
  EditViews,
  FieldSettings,
  LayoutItem,
  WIDTHS,
  mainFieldOptions,
  moveItem,
  orderedFields,
  viewPayload,
} from '../../core/edit-view';
import { I18n } from '../../core/i18n/i18n';
import { isMorph } from '../../core/morph';
import { Schema } from '../../core/schema';
import { Attribute } from '../../core/types';
import { PageHeader } from '../../shared/components/page-header';
import { humanize } from './fields/fields';

/** Only paths inside the admin are followed back (`?from=` comes from the URL). */
function internalPath(path: string | undefined): string | null {
  return path && /^\/(content|single)\//.test(path) ? path : null;
}

/**
 * `/content/:uid/configure-view`: the entry editor's layout for a content type, shared by
 * every admin: field order and widths in a 12-column grid (drag and drop, or the move
 * buttons), and per-field label, description, placeholder, editability and, for relations,
 * the field that names related entries.
 */
@Component({
  selector: 'vd-edit-view-config',
  imports: [
    CdkDropList,
    CdkDrag,
    CdkDragHandle,
    NgIcon,
    RouterLink,
    PageHeader,
    HlmAlertImports,
    HlmAlertDialogImports,
    HlmBadgeImports,
    HlmButtonImports,
    HlmCardImports,
    HlmDialogImports,
    HlmFieldImports,
    HlmInputImports,
    HlmNativeSelectImports,
    HlmSkeletonImports,
    HlmSpinnerImports,
    HlmSwitchImports,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-6">
      <vd-page-header
        [title]="t('content.view.title')"
        [description]="t('content.view.description', { type: type()?.displayName ?? uid() })"
      >
        <div eyebrow>
          <a
            class="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
            [routerLink]="backLink()"
            ><ng-icon name="lucideArrowLeft" size="14" class="rtl:-scale-x-100" />{{
              t('content.view.back')
            }}</a
          >
        </div>
        @if (canManage() && type()) {
          <div actions>
            <hlm-alert-dialog>
              <button
                hlmAlertDialogTrigger
                hlmBtn
                variant="outline"
                type="button"
                [disabled]="busy() || !configured()"
              >
                <ng-icon name="lucideRotateCcw" /> {{ t('content.view.reset') }}
              </button>
              <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx">
                <hlm-alert-dialog-header>
                  <h2 hlmAlertDialogTitle>{{ t('content.view.resetTitle') }}</h2>
                  <p hlmAlertDialogDescription>{{ t('content.view.resetHint') }}</p>
                </hlm-alert-dialog-header>
                <hlm-alert-dialog-footer>
                  <button hlmAlertDialogCancel (click)="ctx.close()">
                    {{ t('common.cancel') }}
                  </button>
                  <button hlmAlertDialogAction (click)="ctx.close(); reset()">
                    {{ t('content.view.reset') }}
                  </button>
                </hlm-alert-dialog-footer>
              </hlm-alert-dialog-content>
            </hlm-alert-dialog>
            <button hlmBtn type="button" [disabled]="busy() || loading()" (click)="save()">
              @if (busy()) {
                <hlm-spinner />
              } @else {
                <ng-icon name="lucideSave" />
              }
              {{ t('common.save') }}
            </button>
          </div>
        }
      </vd-page-header>

      @if (!canManage()) {
        <div hlmAlert>
          <ng-icon hlmAlertIcon name="lucideInfo" />
          <p hlmAlertDescription>{{ t('content.view.forbidden') }}</p>
        </div>
      } @else if (!type()) {
        <div hlmAlert variant="destructive">
          <ng-icon name="lucideCircleAlert" />
          <p hlmAlertTitle>{{ t('content.edit.unknownType', { uid: uid() }) }}</p>
        </div>
      } @else if (loading()) {
        <hlm-skeleton class="h-64 rounded-xl" />
      } @else {
        <section hlmCard>
          <div hlmCardHeader>
            <h2 hlmCardTitle>{{ t('content.view.layout') }}</h2>
            <p hlmCardDescription id="view-layout-hint">{{ t('content.view.layoutHint') }}</p>
          </div>
          <div hlmCardContent>
            <ul
              class="-m-1.5 flex flex-wrap"
              cdkDropList
              cdkDropListOrientation="mixed"
              aria-describedby="view-layout-hint"
              [attr.aria-label]="t('content.view.layout')"
              (cdkDropListDropped)="drop($event)"
            >
              @for (item of items(); track item.name; let index = $index) {
                @let attribute = attributeOf(item.name);
                <li
                  cdkDrag
                  class="w-full p-1.5 sm:w-(--width)"
                  [style.--width]="width(item.size)"
                  [attr.data-view-field]="item.name"
                >
                  <div
                    class="bg-card flex h-full flex-col gap-2 rounded-lg border p-3 shadow-xs"
                    [class.border-dashed]="settingsOf(item.name).editable === false"
                  >
                    <div class="flex items-start gap-2">
                      <span
                        cdkDragHandle
                        class="text-muted-foreground hover:text-foreground mt-0.5 flex cursor-grab items-center rounded-sm active:cursor-grabbing"
                        aria-hidden="true"
                        [title]="t('content.view.dragHint')"
                      >
                        <ng-icon name="lucideGripVertical" size="16" />
                      </span>
                      <div class="flex min-w-0 flex-1 flex-col">
                        <span class="truncate text-sm font-medium">{{ labelOf(item.name) }}</span>
                        <span class="text-muted-foreground truncate font-mono text-xs">{{
                          item.name
                        }}</span>
                      </div>
                      <span hlmBadge variant="secondary" class="shrink-0">{{
                        attribute?.type
                      }}</span>
                    </div>
                    <div class="mt-auto flex flex-wrap items-center gap-1">
                      <label class="sr-only" [for]="'view-width-' + item.name">{{
                        t('content.view.width', { field: labelOf(item.name) })
                      }}</label>
                      <hlm-native-select
                        size="sm"
                        class="w-32"
                        [selectId]="'view-width-' + item.name"
                        [value]="String(item.size)"
                        (valueChange)="setSize(index, Number($event))"
                      >
                        @for (option of widthOptions(item.size); track option) {
                          <option hlmNativeSelectOption [value]="String(option)">
                            {{ t('content.view.columns', { count: option }) }}
                          </option>
                        }
                      </hlm-native-select>
                      <span class="ms-auto"></span>
                      <button
                        hlmBtn
                        size="icon-xs"
                        variant="ghost"
                        type="button"
                        [attr.aria-label]="
                          t('content.view.moveEarlier', { field: labelOf(item.name) })
                        "
                        [title]="t('content.view.moveEarlier', { field: labelOf(item.name) })"
                        [disabled]="index === 0"
                        (click)="move(index, index - 1)"
                      >
                        <ng-icon name="lucideArrowLeft" class="rtl:-scale-x-100" />
                      </button>
                      <button
                        hlmBtn
                        size="icon-xs"
                        variant="ghost"
                        type="button"
                        [attr.aria-label]="
                          t('content.view.moveLater', { field: labelOf(item.name) })
                        "
                        [title]="t('content.view.moveLater', { field: labelOf(item.name) })"
                        [disabled]="index === items().length - 1"
                        (click)="move(index, index + 1)"
                      >
                        <ng-icon name="lucideArrowRight" class="rtl:-scale-x-100" />
                      </button>
                      <button
                        hlmBtn
                        size="icon-xs"
                        variant="ghost"
                        type="button"
                        [attr.aria-label]="
                          t('content.view.editField', { field: labelOf(item.name) })
                        "
                        [title]="t('content.view.editField', { field: labelOf(item.name) })"
                        (click)="openSettings(item.name)"
                      >
                        <ng-icon name="lucideSettings2" />
                      </button>
                    </div>
                  </div>
                </li>
              }
            </ul>
            <p class="sr-only" aria-live="polite">{{ announcement() }}</p>
          </div>
        </section>
      }
    </div>

    <hlm-dialog [state]="editing() ? 'open' : 'closed'" (closed)="editing.set(null)">
      <hlm-dialog-content
        *hlmDialogPortal="let ctx"
        class="sm:max-w-lg"
        [closeLabel]="t('common.close')"
      >
        @if (editing(); as name) {
          @let draft = draftSettings();
          @let attribute = attributeOf(name);
          <form class="flex flex-col gap-4" (submit)="$event.preventDefault(); applySettings()">
            <hlm-dialog-header>
              <h2 hlmDialogTitle>{{ t('content.view.fieldTitle', { field: name }) }}</h2>
              <p hlmDialogDescription>{{ t('content.view.fieldHint') }}</p>
            </hlm-dialog-header>
            <div hlmField>
              <label hlmFieldLabel for="view-field-label">{{ t('content.view.label') }}</label>
              <input
                hlmInput
                id="view-field-label"
                maxlength="500"
                [placeholder]="humanize(name)"
                [value]="draft.label ?? ''"
                (input)="patchDraft({ label: $any($event.target).value })"
              />
            </div>
            <div hlmField>
              <label hlmFieldLabel for="view-field-description">{{
                t('content.view.fieldDescription')
              }}</label>
              <input
                hlmInput
                id="view-field-description"
                maxlength="500"
                [value]="draft.description ?? ''"
                (input)="patchDraft({ description: $any($event.target).value })"
              />
            </div>
            @if (hasPlaceholder(attribute)) {
              <div hlmField>
                <label hlmFieldLabel for="view-field-placeholder">{{
                  t('content.view.placeholder')
                }}</label>
                <input
                  hlmInput
                  id="view-field-placeholder"
                  maxlength="500"
                  [value]="draft.placeholder ?? ''"
                  (input)="patchDraft({ placeholder: $any($event.target).value })"
                />
              </div>
            }
            @if (attribute?.type === 'relation' && !isMorph(attribute)) {
              <div hlmField>
                <label hlmFieldLabel for="view-field-main">{{ t('content.view.mainField') }}</label>
                <hlm-native-select
                  selectId="view-field-main"
                  [value]="draft.mainField ?? ''"
                  (valueChange)="patchDraft({ mainField: $event || undefined })"
                >
                  <option hlmNativeSelectOption value="">
                    {{ t('content.view.mainFieldDefault') }}
                  </option>
                  @for (option of mainFields(attribute); track option) {
                    <option hlmNativeSelectOption [value]="option">{{ option }}</option>
                  }
                </hlm-native-select>
                <p hlmFieldDescription>{{ t('content.view.mainFieldHint') }}</p>
              </div>
            }
            <div hlmField orientation="horizontal">
              <hlm-switch
                inputId="view-field-editable"
                [checked]="draft.editable !== false"
                (checkedChange)="patchDraft({ editable: $event ? undefined : false })"
              />
              <div hlmFieldContent>
                <label hlmFieldLabel for="view-field-editable">{{
                  t('content.view.editable')
                }}</label>
                <p hlmFieldDescription>{{ t('content.view.editableHint') }}</p>
              </div>
            </div>
            <hlm-dialog-footer>
              <button hlmBtn variant="outline" type="button" (click)="editing.set(null)">
                {{ t('common.cancel') }}
              </button>
              <button hlmBtn type="submit">
                <ng-icon name="lucideCheck" /> {{ t('content.view.apply') }}
              </button>
            </hlm-dialog-footer>
          </form>
        }
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class EditViewConfigPage {
  private readonly views = inject(EditViews);
  private readonly schema = inject(Schema);
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  protected readonly humanize = humanize;
  protected readonly isMorph = isMorph;
  protected readonly String = String;
  protected readonly Number = Number;

  readonly uid = input.required<string>();
  /** `?from=`: the editor that opened this page. */
  readonly from = input<string>();

  protected readonly type = computed(() => this.schema.type(this.uid()));
  protected readonly canManage = computed(() => this.auth.can('views.manage'));
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  /** Whether a configuration is stored (Reset then applies). */
  protected readonly configured = signal(false);
  protected readonly items = signal<LayoutItem[]>([]);
  protected readonly fields = signal<Record<string, FieldSettings>>({});
  protected readonly editing = signal<string | null>(null);
  protected readonly draftSettings = signal<FieldSettings>({});
  protected readonly announcement = signal('');

  protected readonly backLink = computed(() => {
    const type = this.type();
    const fallback =
      type?.kind === 'singleType' ? `/single/${this.uid()}` : `/content/${this.uid()}`;
    return this.router.parseUrl(internalPath(this.from()) ?? fallback);
  });

  constructor() {
    effect(() => {
      const uid = this.uid();
      const type = this.type();
      if (type && this.canManage()) untracked(() => void this.load(uid));
    });
  }

  private async load(uid: string): Promise<void> {
    this.loading.set(true);
    try {
      const view = await this.views.get(uid);
      const type = this.schema.type(uid);
      this.configured.set(!!view);
      this.items.set(orderedFields(type?.attributes ?? {}, view));
      this.fields.set(structuredClone(view?.fields ?? {}));
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    } finally {
      this.loading.set(false);
    }
  }

  protected attributeOf(name: string): Attribute | undefined {
    return this.type()?.attributes[name];
  }

  protected settingsOf(name: string): FieldSettings {
    return this.fields()[name] ?? {};
  }

  protected labelOf(name: string): string {
    return this.settingsOf(name).label?.trim() || humanize(name);
  }

  /** The item's width in the 12-column preview. */
  protected width(size: number): string {
    return `${(size / 12) * 100}%`;
  }

  /** The offered widths, plus the current one if it is not among them. */
  protected widthOptions(size: number): number[] {
    const options: number[] = [...WIDTHS];
    return options.includes(size) ? options : [...options, size].sort((a, b) => a - b);
  }

  protected setSize(index: number, size: number): void {
    this.items.update((items) =>
      items.map((item, position) => (position === index ? { ...item, size } : item)),
    );
  }

  protected move(from: number, to: number): void {
    const items = this.items();
    if (to < 0 || to >= items.length || from === to) return;
    const next = moveItem(items, from, to);
    this.items.set(next);
    this.announcement.set(
      this.t('content.view.moved', {
        field: this.labelOf(next[to].name),
        position: to + 1,
        count: next.length,
      }),
    );
  }

  protected drop(event: CdkDragDrop<unknown>): void {
    this.move(event.previousIndex, event.currentIndex);
  }

  protected hasPlaceholder(attribute: Attribute | undefined): boolean {
    return !!attribute && ['string', 'email', 'text', 'uid'].includes(attribute.type);
  }

  protected mainFields(attribute: Attribute | undefined): string[] {
    return mainFieldOptions(this.schema.type(attribute?.target ?? ''));
  }

  protected openSettings(name: string): void {
    this.draftSettings.set({ ...this.settingsOf(name) });
    this.editing.set(name);
  }

  protected patchDraft(changes: Partial<FieldSettings>): void {
    this.draftSettings.update((draft) => {
      const next = { ...draft, ...changes };
      for (const key of Object.keys(next) as (keyof FieldSettings)[])
        if (next[key] === undefined) delete next[key];
      return next;
    });
  }

  protected applySettings(): void {
    const name = this.editing();
    if (!name) return;
    this.fields.update((fields) => ({ ...fields, [name]: this.draftSettings() }));
    this.editing.set(null);
  }

  protected async save(): Promise<void> {
    const type = this.type();
    if (!type || this.busy()) return;
    this.busy.set(true);
    try {
      const saved = await this.views.save(
        type.uid,
        viewPayload(type.attributes, this.items(), this.fields()),
      );
      this.configured.set(true);
      this.fields.set(structuredClone(saved.fields ?? {}));
      toast.success(this.t('content.view.saved'));
    } catch (error) {
      toast.error(this.t('content.view.saveFailed'), {
        description: ApiFailure.from(error).message,
      });
    } finally {
      this.busy.set(false);
    }
  }

  protected async reset(): Promise<void> {
    const type = this.type();
    if (!type || this.busy()) return;
    this.busy.set(true);
    try {
      await this.views.reset(type.uid);
      this.configured.set(false);
      this.items.set(orderedFields(type.attributes, null));
      this.fields.set({});
      toast.success(this.t('content.view.resetDone'));
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    } finally {
      this.busy.set(false);
    }
  }
}
