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
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCheckboxImports } from '@spartan-ng/helm/checkbox';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputGroupImports } from '@spartan-ng/helm/input-group';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';

import { Api, ApiFailure, toQuery } from '../../../core/api';
import { Auth } from '../../../core/auth';
import { ContentLocales } from '../../../core/content-locales';
import { I18n } from '../../../core/i18n/i18n';
import {
  MorphRef,
  morphKey,
  morphSearchLocale,
  morphSearchQuery,
  morphTargetTypes,
  toggleMorphPick,
} from '../../../core/morph';
import { Schema } from '../../../core/schema';
import { Document } from '../../../core/types';
import { MorphEntry, morphEntry } from './model';

let nextId = 0;

/**
 * Chooses entries for a polymorphic owner: a content type (among those the admin may read),
 * then entries of it found with the list search (`_q`). A to-one owner takes the entry
 * clicked; a to-many one collects entries (from several types) and adds them together.
 * Entries already linked are shown, not offered again.
 */
@Component({
  selector: 'vd-morph-picker',
  imports: [
    NgIcon,
    HlmDialogImports,
    HlmButtonImports,
    HlmBadgeImports,
    HlmCheckboxImports,
    HlmFieldImports,
    HlmInputGroupImports,
    HlmNativeSelectImports,
    HlmSpinnerImports,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-dialog [state]="open() ? 'open' : 'closed'" (closed)="closed.emit()">
      <hlm-dialog-content
        *hlmDialogPortal="let ctx"
        class="flex max-h-[90svh] flex-col gap-4 sm:max-w-xl"
        [closeLabel]="t('common.close')"
      >
        <hlm-dialog-header>
          <h2 hlmDialogTitle>
            {{ many() ? t('morph.picker.titleMany') : t('morph.picker.titleOne') }}
          </h2>
          <p hlmDialogDescription>{{ t('morph.picker.description', { field: field() }) }}</p>
        </hlm-dialog-header>

        @if (types().length) {
          <div class="grid gap-3 sm:grid-cols-[minmax(0,12rem)_1fr]">
            <div hlmField>
              <label hlmFieldLabel [for]="id + '-type'">{{ t('morph.picker.type') }}</label>
              <hlm-native-select
                [selectId]="id + '-type'"
                [value]="uid()"
                (valueChange)="chooseType($any($event))"
              >
                @for (type of types(); track type.uid) {
                  <option hlmNativeSelectOption [value]="type.uid">{{ type.displayName }}</option>
                }
              </hlm-native-select>
            </div>
            <div hlmField>
              <label hlmFieldLabel [for]="id + '-search'">{{ t('morph.picker.search') }}</label>
              <div hlmInputGroup>
                <div hlmInputGroupAddon><ng-icon name="lucideSearch" /></div>
                <input
                  hlmInputGroupInput
                  type="search"
                  autocomplete="off"
                  cdkFocusInitial
                  [id]="id + '-search'"
                  [attr.aria-controls]="id + '-results'"
                  [placeholder]="t('content.relation.search', { type: typeName() })"
                  [value]="term()"
                  (input)="term.set($any($event.target).value)"
                />
              </div>
            </div>
          </div>
          @if (locale(); as code) {
            <p class="text-muted-foreground -mt-2 text-xs">
              {{ t('morph.picker.locale', { locale: locales.name(code) }) }}
            </p>
          }

          <div class="-mx-6 min-h-40 overflow-y-auto px-6">
            <ul
              class="flex flex-col gap-1"
              [id]="id + '-results'"
              [attr.aria-label]="t('morph.picker.results', { type: typeName() })"
              [attr.aria-busy]="loading()"
            >
              @for (entry of results(); track entry.documentId) {
                @let linked = isLinked(entry);
                @let chosen = isChosen(entry);
                <li>
                  @if (many()) {
                    <div
                      class="hover:bg-muted/60 flex items-center gap-2.5 rounded-md border px-2.5 py-2 text-sm"
                      [class.border-primary]="chosen"
                      [class.bg-primary/5]="chosen"
                    >
                      <hlm-checkbox
                        [inputId]="id + '-' + entry.documentId"
                        [checked]="linked || chosen"
                        [disabled]="linked"
                        (checkedChange)="toggle(entry)"
                      />
                      <label
                        class="flex min-w-0 flex-1 items-center gap-2"
                        [for]="id + '-' + entry.documentId"
                      >
                        <span class="truncate" data-morph-result>{{ entry.label }}</span>
                        @if (linked) {
                          <span hlmBadge variant="outline" class="ms-auto shrink-0">{{
                            t('morph.picker.linked')
                          }}</span>
                        }
                      </label>
                    </div>
                  } @else {
                    <button
                      type="button"
                      class="hover:bg-muted/60 focus-visible:ring-ring/50 flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-start text-sm outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-60"
                      [disabled]="linked"
                      (click)="pickOne(entry)"
                    >
                      <span class="truncate" data-morph-result>{{ entry.label }}</span>
                      @if (linked) {
                        <span hlmBadge variant="outline" class="ms-auto shrink-0">{{
                          t('morph.picker.linked')
                        }}</span>
                      }
                    </button>
                  }
                </li>
              } @empty {
                @if (!loading()) {
                  <li class="text-muted-foreground px-1 py-6 text-center text-sm">
                    {{ failure() ?? t('content.relation.noResults') }}
                  </li>
                }
              }
            </ul>
            @if (loading()) {
              <div class="flex justify-center py-4"><hlm-spinner /></div>
            }
          </div>
          <p class="sr-only" aria-live="polite">{{ status() }}</p>
        } @else {
          <p class="text-muted-foreground py-6 text-center text-sm">
            {{ t('morph.picker.noTypes') }}
          </p>
        }

        <hlm-dialog-footer class="items-center">
          @if (many() && chosen().length) {
            <span class="text-muted-foreground me-auto text-sm">{{
              t('morph.picker.chosen', { count: chosen().length })
            }}</span>
          }
          <button hlmBtn variant="outline" type="button" (click)="ctx.close()">
            {{ t('common.cancel') }}
          </button>
          @if (many()) {
            <button hlmBtn type="button" [disabled]="!chosen().length" (click)="confirm()">
              <ng-icon name="lucidePlus" />
              {{ t('morph.picker.add', { count: chosen().length }) }}
            </button>
          }
        </hlm-dialog-footer>
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class MorphPicker {
  private readonly api = inject(Api);
  private readonly auth = inject(Auth);
  private readonly schema = inject(Schema);
  protected readonly locales = inject(ContentLocales);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  protected readonly id = `morph-picker-${++nextId}`;

  readonly open = input(false);
  readonly many = input(false);
  /** The field's label, for the description. */
  readonly field = input('');
  /** Links the field holds: shown as linked, not picked again. */
  readonly linked = input<MorphRef[]>([]);
  /** The editor's locale: localized types are searched in it (else in the default one). */
  readonly editorLocale = input<string | null>(null);
  readonly picked = output<MorphEntry[]>();
  readonly closed = output<void>();

  /** Types the admin may read, by name. */
  protected readonly types = computed(() =>
    morphTargetTypes(this.schema.contentTypes(), (uid) =>
      this.auth.canContent('content.read', uid),
    ),
  );
  protected readonly uid = signal('');
  protected readonly term = signal('');
  protected readonly results = signal<MorphEntry[]>([]);
  protected readonly loading = signal(false);
  protected readonly failure = signal<string | null>(null);
  /** Entries chosen in this session (to-many), in pick order, across types. */
  private readonly chosenEntries = signal<MorphEntry[]>([]);
  protected readonly chosen = computed(() =>
    this.chosenEntries().map((entry) => ({ __type: entry.uid, documentId: entry.documentId })),
  );

  private readonly type = computed(() => this.schema.type(this.uid()));
  protected readonly typeName = computed(
    () => this.type()?.displayName ?? this.t('content.relation.documents'),
  );
  protected readonly locale = computed(() =>
    morphSearchLocale(this.type(), this.editorLocale(), this.locales.defaultCode()),
  );
  protected readonly status = computed(() =>
    this.loading() ? '' : this.t('morph.picker.found', { count: this.results().length }),
  );

  private requestId = 0;

  constructor() {
    // Each opening starts afresh, on the last type used (else the first one).
    effect(() => {
      if (!this.open()) return;
      untracked(() => {
        const types = this.types();
        if (!types.some((type) => type.uid === this.uid())) this.uid.set(types[0]?.uid ?? '');
        this.term.set('');
        this.chosenEntries.set([]);
        this.results.set([]);
        this.failure.set(null);
        // Localized types are searched in the default locale when the editor has none.
        if (!this.locales.loaded()) void this.locales.load().catch(() => undefined);
      });
    });
    effect((onCleanup) => {
      if (!this.open()) return;
      const request = { uid: this.uid(), term: this.term(), locale: this.locale() };
      if (!request.uid) return;
      const timer = setTimeout(() => void this.find(request), 250);
      onCleanup(() => clearTimeout(timer));
    });
  }

  private async find(request: { uid: string; term: string; locale: string | null }): Promise<void> {
    const id = ++this.requestId;
    this.loading.set(true);
    this.failure.set(null);
    try {
      const response = await this.api.list<Document>(
        `/content/${request.uid}`,
        toQuery(morphSearchQuery(request.term, request.locale)),
      );
      if (id !== this.requestId) return;
      this.results.set(
        response.data.map((document) =>
          morphEntry(
            { uid: request.uid, documentId: document.documentId, entry: document },
            (uid) => this.schema.type(uid),
            (type) => this.schema.titleField(type),
          ),
        ),
      );
    } catch (error) {
      if (id !== this.requestId) return;
      this.results.set([]);
      this.failure.set(ApiFailure.from(error).message);
    } finally {
      if (id === this.requestId) this.loading.set(false);
    }
  }

  protected chooseType(uid: string): void {
    this.uid.set(uid);
    this.results.set([]);
  }

  private ref(entry: MorphEntry): MorphRef {
    return { __type: entry.uid, documentId: entry.documentId };
  }

  protected isLinked(entry: MorphEntry): boolean {
    const key = morphKey(entry);
    return this.linked().some((ref) => morphKey(ref) === key);
  }

  protected isChosen(entry: MorphEntry): boolean {
    const key = morphKey(entry);
    return this.chosen().some((ref) => morphKey(ref) === key);
  }

  /** To-many: checks or unchecks an entry. */
  protected toggle(entry: MorphEntry): void {
    const next = toggleMorphPick(this.chosen(), this.ref(entry), true, this.linked());
    const keys = new Set(next.map(morphKey));
    const known = [...this.chosenEntries(), entry];
    this.chosenEntries.set(
      next
        .map((ref) => known.find((item) => morphKey(item) === morphKey(ref)))
        .filter((item): item is MorphEntry => !!item && keys.has(morphKey(item))),
    );
  }

  /** To-one: the entry clicked is the choice. */
  protected pickOne(entry: MorphEntry): void {
    if (!toggleMorphPick([], this.ref(entry), false, this.linked()).length) return;
    this.picked.emit([entry]);
  }

  protected confirm(): void {
    if (this.chosenEntries().length) this.picked.emit(this.chosenEntries());
  }
}
