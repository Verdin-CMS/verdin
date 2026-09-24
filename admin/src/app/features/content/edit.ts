import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  OnInit,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { FieldTree, FormRoot, SchemaPath, form, submit, validate } from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';

import { Api, ApiFailure, Issue, toQuery } from '../../core/api';
import { Auth } from '../../core/auth';
import { Schema } from '../../core/schema';
import { Attributes, ContentType, Document } from '../../core/types';
import { FieldsComponent } from './fields/fields';
import { FormModel, documentLabel, toModel, toPayload } from './fields/model';

type Tree = FieldTree<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Client-side checks mirroring the schema. `required` is left to the server: drafts may be incomplete. */
function applyRules(path: SchemaPath<FormModel>, attributes: Attributes): void {
  for (const [name, attribute] of Object.entries(attributes)) {
    const field = (path as unknown as Record<string, SchemaPath<unknown>>)[name];
    validate(field, ({ value }) => {
      const current = value();
      if (current === null || current === undefined || current === '') return undefined;
      if (typeof current === 'string') {
        const length = [...current].length;
        if (attribute.maxLength !== undefined && length > attribute.maxLength) {
          return { kind: 'maxLength', message: `At most ${attribute.maxLength} characters.` };
        }
        if (attribute.minLength !== undefined && length < attribute.minLength) {
          return { kind: 'minLength', message: `At least ${attribute.minLength} characters.` };
        }
        if (attribute.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(current)) {
          return { kind: 'email', message: 'Enter a valid email address.' };
        }
        if (attribute.regex && !new RegExp(attribute.regex).test(current)) {
          return { kind: 'pattern', message: `Must match ${attribute.regex}.` };
        }
      }
      if (typeof current === 'number') {
        if (attribute.min !== undefined && current < attribute.min) {
          return { kind: 'min', message: `Must be at least ${attribute.min}.` };
        }
        if (attribute.max !== undefined && current > attribute.max) {
          return { kind: 'max', message: `Must be at most ${attribute.max}.` };
        }
      }
      return undefined;
    });
  }
}

/** The editable form of one document; recreated per document by `ContentEdit`. */
@Component({
  selector: 'vd-document-form',
  imports: [
    FormRoot,
    RouterLink,
    NgIcon,
    FieldsComponent,
    HlmButtonImports,
    HlmBadgeImports,
    HlmCardImports,
    HlmAlertImports,
    HlmAlertDialogImports,
    HlmSpinnerImports,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-6">
      <div class="flex flex-wrap items-center gap-3">
        @if (type().kind === 'collectionType') {
          <a
            hlmBtn
            variant="ghost"
            size="icon"
            [routerLink]="['/content', type().uid]"
            aria-label="Back"
            ><ng-icon name="lucideArrowLeft"
          /></a>
        }
        <div class="min-w-0">
          <h1 class="truncate text-2xl font-semibold">{{ heading() }}</h1>
          <p class="text-muted-foreground text-sm">{{ type().displayName }}</p>
        </div>
        @if (type().draftAndPublish && documentId()) {
          <span hlmBadge [variant]="status() === 'published' ? 'default' : 'secondary'">{{
            statusLabel()
          }}</span>
        }
        <div class="ms-auto flex flex-wrap items-center gap-2">
          @if (
            documentId() &&
            type().draftAndPublish &&
            published() &&
            auth.canContent('content.publish', type().uid)
          ) {
            <button
              hlmBtn
              variant="outline"
              type="button"
              [disabled]="busy()"
              (click)="action('unpublish')"
            >
              <ng-icon name="lucideEyeOff" /> Unpublish
            </button>
            @if (status() === 'modified') {
              <button
                hlmBtn
                variant="outline"
                type="button"
                [disabled]="busy()"
                (click)="action('discard-draft')"
              >
                <ng-icon name="lucideUndo2" /> Discard changes
              </button>
            }
          }
          <button
            hlmBtn
            variant="secondary"
            type="button"
            [disabled]="busy() || !canSave()"
            (click)="save(false)"
          >
            @if (busy()) {
              <hlm-spinner />
            } @else {
              <ng-icon name="lucideSave" />
            }
            {{ type().draftAndPublish ? 'Save draft' : 'Save' }}
          </button>
          @if (type().draftAndPublish && auth.canContent('content.publish', type().uid)) {
            <button hlmBtn type="button" [disabled]="busy() || !canSave()" (click)="save(true)">
              <ng-icon name="lucideSend" /> Publish
            </button>
          }
        </div>
      </div>

      @if (problem()) {
        <div hlmAlert variant="destructive">
          <p hlmAlertTitle>{{ problem() }}</p>
          @if (unplacedIssues().length) {
            <ul hlmAlertDescription class="list-disc ps-4">
              @for (issue of unplacedIssues(); track $index) {
                <li>{{ issue.path.join('.') }}: {{ issue.message }}</li>
              }
            </ul>
          }
        </div>
      }

      <form [formRoot]="documentForm" (submit)="$event.preventDefault(); save(false)">
        <section hlmCard>
          <div hlmCardContent>
            <vd-fields
              [attributes]="type().attributes"
              [tree]="tree"
              [context]="{ uid: type().uid, documentId: documentId() }"
              [relationLabels]="relationLabels"
              [inverse]="inverse"
              prefix="doc"
            />
          </div>
        </section>
      </form>

      @if (documentId() && auth.canContent('content.delete', type().uid)) {
        <section hlmCard>
          <div hlmCardHeader>
            <h2 hlmCardTitle>Danger zone</h2>
            <p hlmCardDescription>
              Deleting removes every version of this document and the links pointing at it.
            </p>
          </div>
          <div hlmCardFooter>
            <hlm-alert-dialog>
              <button hlmAlertDialogTrigger hlmBtn variant="destructive" type="button">
                <ng-icon name="lucideTrash2" /> Delete
              </button>
              <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx">
                <hlm-alert-dialog-header>
                  <h2 hlmAlertDialogTitle>Delete this document?</h2>
                  <p hlmAlertDialogDescription>This cannot be undone.</p>
                </hlm-alert-dialog-header>
                <hlm-alert-dialog-footer>
                  <button hlmAlertDialogCancel (click)="ctx.close()">Cancel</button>
                  <button
                    hlmAlertDialogAction
                    variant="destructive"
                    (click)="ctx.close(); remove()"
                  >
                    Delete
                  </button>
                </hlm-alert-dialog-footer>
              </hlm-alert-dialog-content>
            </hlm-alert-dialog>
          </div>
        </section>
      }
    </div>
  `,
})
export class DocumentForm implements OnInit {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  protected readonly auth = inject(Auth);
  private readonly schema = inject(Schema);
  private readonly injector = inject(Injector);

  readonly type = input.required<ContentType>();
  /** The loaded draft (or only version); `null` for a new document. */
  readonly document = input<Document | null>(null);
  readonly publishedAt = input<string | null>(null);

  protected readonly documentId = signal<string | null>(null);
  protected readonly published = signal(false);
  protected readonly draftUpdatedAt = signal<string | null>(null);
  protected readonly publishedUpdatedAt = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly problem = signal<string | null>(null);
  protected readonly unplacedIssues = signal<Issue[]>([]);

  protected readonly model = signal<FormModel>({});
  protected documentForm!: Tree;
  protected tree!: Tree;
  protected relationLabels: Record<string, Record<string, string>> = {};
  protected inverse: Record<string, { id: string; label: string }[]> = {};

  protected readonly status = computed<'draft' | 'published' | 'modified'>(() => {
    if (!this.published()) return 'draft';
    const draft = this.draftUpdatedAt();
    const live = this.publishedUpdatedAt();
    return draft && live && draft > live ? 'modified' : 'published';
  });
  protected readonly statusLabel = computed(
    () =>
      ({ draft: 'Draft', published: 'Published', modified: 'Modified since publishing' })[
        this.status()
      ],
  );
  protected readonly heading = computed(() => {
    const type = this.type();
    if (type.kind === 'singleType') return type.displayName;
    if (!this.documentId()) return `New ${type.displayName.toLowerCase()}`;
    const field = this.schema.titleField(type);
    const title = field ? this.model()[field] : null;
    return title ? String(title) : 'Untitled';
  });

  protected canSave(): boolean {
    const uid = this.type().uid;
    return this.documentId()
      ? this.auth.canContent('content.update', uid)
      : this.auth.canContent('content.create', uid);
  }

  ngOnInit(): void {
    const type = this.type();
    const document = this.document();
    const components = (uid: string) => this.schema.component(uid);
    this.model.set(toModel(type.attributes, document, components));
    this.documentForm = form(this.model, (path) => applyRules(path, type.attributes), {
      injector: this.injector,
    }) as unknown as Tree;
    this.tree = this.documentForm;
    this.documentId.set(document?.documentId ?? null);
    this.published.set(!!this.publishedAt() || (!type.draftAndPublish && !!document));
    this.draftUpdatedAt.set(document?.updatedAt ?? null);
    this.publishedUpdatedAt.set(this.publishedAt());

    // Labels for relation pickers and read-only inverse sides, from the populated document.
    for (const [name, attribute] of Object.entries(type.attributes)) {
      if (attribute.type !== 'relation' || !document) continue;
      const target = this.schema.type(attribute.target ?? '');
      const titleField = target ? this.schema.titleField(target) : null;
      const related = document[name];
      const items = (Array.isArray(related) ? related : related ? [related] : []) as Record<
        string,
        unknown
      >[];
      const labelled = items.map((item) => ({
        id: String(item['documentId']),
        label: documentLabel(item, titleField),
      }));
      if (attribute.mappedBy) {
        this.inverse[name] = labelled;
      } else {
        this.relationLabels[name] = Object.fromEntries(
          labelled.map((item) => [item.id, item.label]),
        );
      }
    }
  }

  /** Saves the draft; `publish` then publishes it. */
  protected async save(publish: boolean): Promise<void> {
    this.problem.set(null);
    this.unplacedIssues.set([]);
    this.busy.set(true);
    const type = this.type();
    await submit(this.documentForm as FieldTree<FormModel>, async () => {
      try {
        const data = toPayload(type.attributes, this.model(), (uid) => this.schema.component(uid));
        const base = `/content/${type.uid}`;
        let document: Document;
        if (this.documentId()) {
          document = await this.api.put<Document>(
            `${base}/${this.documentId()}`,
            { data },
            'populate=*',
          );
        } else {
          document = await this.api.post<Document>(base, { data }, 'populate=*');
          this.documentId.set(document.documentId);
        }
        this.draftUpdatedAt.set(document.updatedAt ?? null);
        if (publish) {
          const live = await this.api.post<Document>(
            `${base}/${document.documentId}/actions/publish`,
          );
          this.published.set(true);
          this.publishedUpdatedAt.set(live.updatedAt ?? null);
          this.draftUpdatedAt.set(live.updatedAt ?? null);
        } else if (!type.draftAndPublish) {
          this.published.set(true);
        }
        toast.success(publish ? 'Published' : 'Saved');
        if (type.kind === 'collectionType' && !this.router.url.endsWith(document.documentId)) {
          await this.router.navigate(['/content', type.uid, document.documentId], {
            replaceUrl: true,
          });
        }
        return undefined;
      } catch (error) {
        return this.fail(error, publish ? 'Could not publish' : 'Could not save');
      }
    });
    this.busy.set(false);
  }

  protected async action(action: 'unpublish' | 'discard-draft'): Promise<void> {
    const type = this.type();
    this.busy.set(true);
    try {
      await this.api.post(`/content/${type.uid}/${this.documentId()}/actions/${action}`);
      if (action === 'unpublish') {
        this.published.set(false);
        toast.success('Unpublished');
      } else {
        const draft = await this.api.get<Document>(
          `/content/${type.uid}/${this.documentId()}`,
          'populate=*',
        );
        this.model.set(toModel(type.attributes, draft, (uid) => this.schema.component(uid)));
        this.draftUpdatedAt.set(this.publishedUpdatedAt());
        toast.success('Changes discarded');
      }
    } catch (error) {
      this.fail(error, 'Action failed');
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const type = this.type();
    try {
      await this.api.delete(`/content/${type.uid}/${this.documentId()}`);
      toast.success('Deleted');
      await this.router.navigate(type.kind === 'singleType' ? ['/'] : ['/content', type.uid]);
    } catch (error) {
      this.fail(error, 'Could not delete');
    }
  }

  /** Maps validation issues onto fields; the rest go to the banner. */
  private fail(error: unknown, title: string) {
    const failure = ApiFailure.from(error);
    this.problem.set(
      failure.issues.length
        ? `${title}: fix the highlighted fields`
        : `${title}: ${failure.message}`,
    );
    const placed: { kind: string; message: string; fieldTree: Tree }[] = [];
    const unplaced: Issue[] = [];
    for (const issue of failure.issues) {
      let field: unknown = this.documentForm;
      for (const segment of issue.path)
        field = (field as Record<string | number, unknown> | undefined)?.[segment];
      if (field && issue.path.length)
        placed.push({ kind: 'server', message: issue.message, fieldTree: field as Tree });
      else unplaced.push(issue);
    }
    this.unplacedIssues.set(unplaced);
    return placed;
  }
}

/** Loads the document for the route, then renders a fresh `DocumentForm` for it. */
@Component({
  selector: 'vd-content-edit',
  imports: [DocumentForm, HlmSpinnerImports, HlmAlertImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (error()) {
      <div hlmAlert variant="destructive">
        <p hlmAlertTitle>{{ error() }}</p>
      </div>
    } @else if (loading() || !type()) {
      <hlm-spinner />
    } @else {
      @for (key of [loadKey()]; track key) {
        <vd-document-form [type]="type()!" [document]="document()" [publishedAt]="publishedAt()" />
      }
    }
  `,
})
export class ContentEdit {
  private readonly api = inject(Api);
  private readonly schema = inject(Schema);

  readonly uid = input.required<string>();
  readonly documentId = input<string>();

  protected readonly type = computed(() => this.schema.type(this.uid()));
  protected readonly document = signal<Document | null>(null);
  protected readonly publishedAt = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly loadKey = signal('');

  constructor() {
    // Reload whenever the route's type or document changes.
    effect(() => {
      const key = `${this.uid()}|${this.documentId() ?? ''}`;
      untracked(() => void this.load(key));
    });
  }

  private async load(key: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    this.document.set(null);
    this.publishedAt.set(null);
    const uid = this.uid();
    const type = this.type();
    if (!type) {
      this.error.set(`Unknown content type ${uid}`);
      this.loading.set(false);
      return;
    }
    try {
      let documentId = this.documentId() ?? null;
      if (type.kind === 'singleType') {
        const list = await this.api.list<Document>(
          `/content/${uid}`,
          toQuery({ pagination: { pageSize: 1 } }),
        );
        documentId = list.data[0]?.documentId ?? null;
      }
      if (documentId) {
        this.document.set(
          await this.api.get<Document>(`/content/${uid}/${documentId}`, 'populate=*&status=draft'),
        );
        if (type.draftAndPublish) {
          try {
            const live = await this.api.get<Document>(
              `/content/${uid}/${documentId}`,
              'status=published&fields=updatedAt',
            );
            this.publishedAt.set(live.updatedAt ?? live.publishedAt ?? null);
          } catch (error) {
            if (ApiFailure.from(error).status !== 404) throw error;
          }
        }
      }
      this.loadKey.set(key);
    } catch (error) {
      const failure = ApiFailure.from(error);
      this.error.set(
        failure.status === 404
          ? 'This document does not exist (or you cannot see it).'
          : failure.message,
      );
    } finally {
      this.loading.set(false);
    }
  }
}
