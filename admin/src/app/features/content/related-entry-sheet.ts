import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  OnInit,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FieldTree, FormRoot, form, submit } from '@angular/forms/signals';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmSheetImports } from '@spartan-ng/helm/sheet';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';

import { Api, ApiFailure, toQuery } from '../../core/api';
import { Auth } from '../../core/auth';
import { I18n } from '../../core/i18n/i18n';
import { Schema } from '../../core/schema';
import { ContentType, Document } from '../../core/types';
import { FieldsComponent } from './fields/fields';
import {
  FormModel,
  MorphEntry,
  References,
  documentLabel,
  mediaFilesOf,
  morphEntriesOf,
  referencesOf,
  relationLabelsOf,
  toModel,
  toPayload,
  withoutPasswords,
} from './fields/model';
import { RelatedEditor } from './fields/related-editor';
import { applyRules } from './fields/rules';

type Tree = FieldTree<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The form of one related entry, recreated per entry by `RelatedEntrySheet`. */
@Component({
  selector: 'vd-related-entry-form',
  imports: [
    FormRoot,
    FieldsComponent,
    NgIcon,
    HlmAlertImports,
    HlmButtonImports,
    HlmSpinnerImports,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-h-0 flex-1 flex-col' },
  template: `
    <form
      id="related-entry-form"
      class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4"
      [formRoot]="entryForm"
      (submit)="$event.preventDefault(); save()"
    >
      @if (problem()) {
        <div hlmAlert variant="destructive">
          <ng-icon name="lucideCircleAlert" />
          <p hlmAlertTitle>{{ problem() }}</p>
        </div>
      }
      <vd-fields
        [attributes]="type().attributes"
        [tree]="entryForm"
        [context]="{ uid: type().uid, documentId: document().documentId, locale: locale() }"
        [relationLabels]="relationLabels"
        [mediaFiles]="mediaFiles"
        [refs]="refs"
        [inverse]="inverse"
        [morphs]="morphs"
        prefix="related"
      />
    </form>
    <div class="flex flex-wrap justify-end gap-2 border-t p-4">
      <button hlmBtn variant="outline" type="button" (click)="cancel.emit()">
        {{ t('common.cancel') }}
      </button>
      <button hlmBtn type="submit" form="related-entry-form" [disabled]="busy() || !canSave()">
        @if (busy()) {
          <hlm-spinner />
        } @else {
          <ng-icon name="lucideSave" />
        }
        {{ type().draftAndPublish ? t('content.edit.saveDraft') : t('common.save') }}
      </button>
    </div>
  `,
})
export class RelatedEntryForm implements OnInit {
  private readonly api = inject(Api);
  private readonly auth = inject(Auth);
  private readonly schema = inject(Schema);
  private readonly injector = inject(Injector);
  protected readonly t = inject(I18n).t;

  readonly type = input.required<ContentType>();
  readonly document = input.required<Document>();
  readonly locale = input<string | null>(null);
  /** The saved draft. */
  readonly saved = output<Document>();
  readonly cancel = output<void>();

  protected readonly model = signal<FormModel>({});
  protected entryForm!: Tree;
  protected relationLabels: Record<string, Record<string, string>> = {};
  protected inverse: Record<string, { id: string; label: string }[]> = {};
  protected morphs: Record<string, MorphEntry[]> = {};
  protected mediaFiles = {};
  protected refs: References = { labels: {}, files: [] };
  protected readonly busy = signal(false);
  protected readonly problem = signal<string | null>(null);
  protected readonly canSave = computed(() =>
    this.auth.canContent('content.update', this.type().uid),
  );

  private readonly components = (uid: string) => this.schema.component(uid);
  private readonly titleFieldOf = (target: string) => {
    const type = this.schema.type(target);
    return type ? this.schema.titleField(type) : null;
  };

  ngOnInit(): void {
    const type = this.type();
    const document = this.document();
    this.model.set(toModel(type.attributes, document, this.components));
    this.entryForm = form(this.model, (path) => applyRules(path, type.attributes, this.t), {
      injector: this.injector,
    }) as unknown as Tree;
    const { labels, inverse } = relationLabelsOf(type.attributes, document, this.titleFieldOf);
    this.relationLabels = labels;
    this.inverse = inverse;
    this.morphs = morphEntriesOf(
      type.attributes,
      document,
      (uid) => this.schema.type(uid),
      (target) => this.schema.titleField(target),
    );
    this.mediaFiles = mediaFilesOf(type.attributes, document);
    this.refs = referencesOf(type.attributes, document, this.components, this.titleFieldOf);
  }

  protected async save(): Promise<void> {
    if (this.busy() || !this.canSave()) return;
    this.problem.set(null);
    this.busy.set(true);
    const type = this.type();
    await submit(this.entryForm as FieldTree<FormModel>, async () => {
      try {
        const data = toPayload(type.attributes, this.model(), this.components);
        const document = await this.api.put<Document>(
          `/content/${type.uid}/${this.document().documentId}`,
          { data },
          toQuery({ populate: '*', locale: this.locale() }),
        );
        this.model.set(withoutPasswords(type.attributes, this.model()));
        this.saved.emit(document);
        return undefined;
      } catch (error) {
        const failure = ApiFailure.from(error);
        this.problem.set(
          this.t('content.edit.error.withMessage', {
            title: this.t('content.edit.error.save'),
            message: failure.message,
          }),
        );
        const placed: { kind: string; message: string; fieldTree: Tree }[] = [];
        for (const issue of failure.issues) {
          let field: unknown = this.entryForm;
          for (const segment of issue.path)
            field = (field as Record<string | number, unknown> | undefined)?.[segment];
          if (field && issue.path.length)
            placed.push({ kind: 'server', message: issue.message, fieldTree: field as Tree });
        }
        return placed;
      }
    });
    this.busy.set(false);
  }
}

/**
 * The side sheet where a related entry is edited without leaving the entry editor.
 * Hosted by the editor, opened by its relation pickers through `RelatedEditor`.
 */
@Component({
  selector: 'vd-related-entry-sheet',
  imports: [
    RelatedEntryForm,
    RouterLink,
    NgIcon,
    HlmAlertImports,
    HlmButtonImports,
    HlmSheetImports,
    HlmSpinnerImports,
  ],
  // No sheet in a sheet: pickers inside this one have no "Edit" button.
  providers: [{ provide: RelatedEditor, useValue: null }],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-sheet
      [side]="i18n.endSide()"
      [state]="request() ? 'open' : 'closed'"
      (closed)="editor.close()"
    >
      <hlm-sheet-content
        *hlmSheetPortal="let ctx"
        class="gap-0 p-0 data-[side=left]:w-full data-[side=right]:w-full data-[side=left]:sm:max-w-xl data-[side=right]:sm:max-w-xl"
      >
        <hlm-sheet-header class="border-b p-4 pe-12">
          <p class="text-muted-foreground text-xs">{{ type()?.displayName }}</p>
          <h2 hlmSheetTitle class="truncate">{{ heading() }}</h2>
          @if (request(); as current) {
            <p hlmSheetDescription>
              <a
                class="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline"
                [routerLink]="['/content', current.uid, current.documentId]"
                [queryParams]="current.locale ? { locale: current.locale } : {}"
                (click)="editor.close()"
                >{{ t('content.relation.openFull') }}
                <ng-icon name="lucideArrowRight" size="14" class="rtl:-scale-x-100"
              /></a>
            </p>
          }
        </hlm-sheet-header>
        @if (error()) {
          <div class="p-4">
            <div hlmAlert variant="destructive">
              <ng-icon name="lucideCircleAlert" />
              <p hlmAlertTitle>{{ error() }}</p>
            </div>
          </div>
        } @else if (loading() || !document() || !type()) {
          <div
            class="text-muted-foreground flex items-center justify-center gap-2 py-24 text-sm"
            role="status"
          >
            <hlm-spinner /> {{ t('common.loading') }}
          </div>
        } @else {
          @for (key of [loadKey()]; track key) {
            <vd-related-entry-form
              [type]="type()!"
              [document]="document()!"
              [locale]="request()?.locale ?? null"
              (saved)="onSaved($event)"
              (cancel)="editor.close()"
            />
          }
        }
      </hlm-sheet-content>
    </hlm-sheet>
  `,
})
export class RelatedEntrySheet {
  private readonly api = inject(Api);
  private readonly schema = inject(Schema);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  /** The editor's (this component provides `null` to its own children). */
  protected readonly editor = inject(RelatedEditor, { skipSelf: true });

  protected readonly request = this.editor.request;
  protected readonly type = computed(() => {
    const request = this.request();
    return request ? this.schema.type(request.uid) : undefined;
  });
  protected readonly document = signal<Document | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly loadKey = signal('');
  protected readonly heading = computed(() => {
    const type = this.type();
    const document = this.document();
    if (!type || !document) return this.t('content.relation.editTitle');
    return documentLabel(document, this.schema.titleField(type));
  });
  private requests = 0;

  constructor() {
    effect(() => {
      const request = this.request();
      untracked(() => void this.load(request));
    });
  }

  private async load(request: ReturnType<RelatedEditor['request']>): Promise<void> {
    const current = ++this.requests;
    this.document.set(null);
    this.error.set(null);
    if (!request) return;
    this.loading.set(true);
    try {
      const document = await this.api.get<Document>(
        `/content/${request.uid}/${request.documentId}`,
        toQuery({ populate: '*', status: 'draft', locale: request.locale }),
      );
      if (current !== this.requests) return;
      this.document.set(document);
      this.loadKey.set(`${request.uid}|${request.documentId}|${current}`);
    } catch (error) {
      if (current !== this.requests) return;
      const failure = ApiFailure.from(error);
      this.error.set(failure.status === 404 ? this.t('content.edit.notFound') : failure.message);
    } finally {
      if (current === this.requests) this.loading.set(false);
    }
  }

  protected onSaved(document: Document): void {
    const type = this.type();
    if (type)
      this.editor.saved(document.documentId, documentLabel(document, this.schema.titleField(type)));
    toast.success(this.t('content.edit.toast.saved'));
    this.editor.close();
  }
}
