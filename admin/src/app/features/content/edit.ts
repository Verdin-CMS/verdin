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
import { Engagement } from '../../core/engagement';
import { I18n } from '../../core/i18n/i18n';
import { Schema } from '../../core/schema';
import { Attributes, ContentType, Document } from '../../core/types';
import { PageHeader } from '../../shared/components/page-header';
import { VoteControl } from '../../shared/components/vote-control';
import { FieldsComponent } from './fields/fields';
import { FormModel, documentLabel, toModel, toPayload } from './fields/model';

type Tree = FieldTree<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

type Translate = I18n['t'];

/** Client-side checks mirroring the schema. `required` is left to the server: drafts may be incomplete. */
function applyRules(path: SchemaPath<FormModel>, attributes: Attributes, t: Translate): void {
  for (const [name, attribute] of Object.entries(attributes)) {
    const field = (path as unknown as Record<string, SchemaPath<unknown>>)[name];
    validate(field, ({ value }) => {
      const current = value();
      if (current === null || current === undefined || current === '') return undefined;
      if (typeof current === 'string') {
        const length = [...current].length;
        if (attribute.maxLength !== undefined && length > attribute.maxLength) {
          return {
            kind: 'maxLength',
            message: t('content.validation.maxLength', { count: attribute.maxLength }),
          };
        }
        if (attribute.minLength !== undefined && length < attribute.minLength) {
          return {
            kind: 'minLength',
            message: t('content.validation.minLength', { count: attribute.minLength }),
          };
        }
        if (attribute.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(current)) {
          return { kind: 'email', message: t('content.validation.email') };
        }
        if (attribute.regex && !new RegExp(attribute.regex).test(current)) {
          return {
            kind: 'pattern',
            message: t('content.validation.pattern', { pattern: attribute.regex }),
          };
        }
      }
      if (typeof current === 'number') {
        if (attribute.min !== undefined && current < attribute.min) {
          return { kind: 'min', message: t('content.validation.min', { min: attribute.min }) };
        }
        if (attribute.max !== undefined && current > attribute.max) {
          return { kind: 'max', message: t('content.validation.max', { max: attribute.max }) };
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
    VoteControl,
    FormRoot,
    RouterLink,
    NgIcon,
    FieldsComponent,
    PageHeader,
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
      <vd-page-header [title]="heading()">
        @if (type().kind === 'collectionType') {
          <div eyebrow>
            <a
              class="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
              [routerLink]="['/content', type().uid]"
              ><ng-icon name="lucideArrowLeft" size="14" />{{ type().displayName }}</a
            >
          </div>
        }
        <div actions>
          <button
            hlmBtn
            variant="outline"
            type="button"
            [disabled]="busy() || !canSave()"
            (click)="save(false)"
          >
            @if (busy()) {
              <hlm-spinner />
            } @else {
              <ng-icon name="lucideSave" />
            }
            {{ type().draftAndPublish ? t('content.edit.saveDraft') : t('common.save') }}
          </button>
          @if (type().draftAndPublish && canPublish()) {
            <button hlmBtn type="button" [disabled]="busy() || !canSave()" (click)="save(true)">
              <ng-icon name="lucideSend" /> {{ t('content.edit.publish') }}
            </button>
          }
        </div>
      </vd-page-header>

      @if (problem()) {
        <div hlmAlert variant="destructive">
          <ng-icon name="lucideCircleAlert" />
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

      <div class="grid items-start gap-6 lg:grid-cols-3">
        <form
          class="min-w-0 lg:col-span-2"
          [formRoot]="documentForm"
          (submit)="$event.preventDefault(); save(false)"
        >
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

        <aside class="flex flex-col gap-6 lg:sticky lg:top-6">
          <section hlmCard size="sm">
            <div hlmCardHeader>
              <h2 hlmCardTitle>{{ t('content.edit.details') }}</h2>
              @if (type().draftAndPublish) {
                <div hlmCardAction>
                  <span hlmBadge [variant]="status() === 'published' ? 'secondary' : 'outline'">
                    <span
                      class="size-1.5 rounded-full"
                      aria-hidden="true"
                      [class]="
                        status() === 'published'
                          ? 'bg-emerald-500'
                          : status() === 'modified'
                            ? 'bg-amber-500'
                            : 'bg-muted-foreground/60'
                      "
                    ></span>
                    {{ statusLabel() }}
                  </span>
                </div>
              }
            </div>
            <div hlmCardContent class="flex flex-col gap-4">
              @if (type().draftAndPublish && documentId()) {
                <p class="text-muted-foreground text-sm">{{ statusHint() }}</p>
              }
              <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt class="text-muted-foreground">{{ t('content.edit.created') }}</dt>
                <dd class="text-end" [title]="i18n.formatDate(createdAt(), 'long')">
                  {{ createdAt() ? i18n.formatDate(createdAt(), 'datetime') : '—' }}
                </dd>
                <dt class="text-muted-foreground">{{ t('content.edit.updated') }}</dt>
                <dd class="text-end" [title]="i18n.formatDate(draftUpdatedAt(), 'long')">
                  {{ draftUpdatedAt() ? i18n.formatDate(draftUpdatedAt(), 'datetime') : '—' }}
                </dd>
                @if (type().draftAndPublish) {
                  <dt class="text-muted-foreground">{{ t('content.edit.lastPublished') }}</dt>
                  <dd class="text-end" [title]="i18n.formatDate(publishedUpdatedAt(), 'long')">
                    {{
                      published() && publishedUpdatedAt()
                        ? i18n.formatDate(publishedUpdatedAt(), 'datetime')
                        : '—'
                    }}
                  </dd>
                }
              </dl>
              @if (documentId(); as id) {
                <div class="flex items-center justify-between border-t pt-3">
                  <span class="text-muted-foreground text-sm">{{ t('votes.title') }}</span>
                  <vd-vote-control [uid]="type().uid" [documentId]="id" />
                </div>
              }
            </div>
            @if (documentId() && type().draftAndPublish && published() && canPublish()) {
              <div hlmCardFooter class="flex flex-col items-stretch gap-2 border-t">
                <button
                  hlmBtn
                  variant="outline"
                  size="sm"
                  type="button"
                  [disabled]="busy()"
                  (click)="action('unpublish')"
                >
                  <ng-icon name="lucideEyeOff" /> {{ t('content.edit.unpublish') }}
                </button>
                @if (status() === 'modified') {
                  <button
                    hlmBtn
                    variant="outline"
                    size="sm"
                    type="button"
                    [disabled]="busy()"
                    (click)="action('discard-draft')"
                  >
                    <ng-icon name="lucideUndo2" /> {{ t('content.edit.discard') }}
                  </button>
                }
              </div>
            }
          </section>

          @if (documentId() && auth.canContent('content.delete', type().uid)) {
            <section hlmCard size="sm" class="ring-destructive/30">
              <div hlmCardHeader>
                <h2 hlmCardTitle>{{ t('content.edit.dangerZone') }}</h2>
                <p hlmCardDescription>{{ t('content.edit.dangerHint') }}</p>
              </div>
              <div hlmCardFooter>
                <hlm-alert-dialog>
                  <button
                    hlmAlertDialogTrigger
                    hlmBtn
                    variant="destructive"
                    size="sm"
                    type="button"
                    class="w-full"
                  >
                    <ng-icon name="lucideTrash2" /> {{ t('common.delete') }}
                  </button>
                  <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx">
                    <hlm-alert-dialog-header>
                      <h2 hlmAlertDialogTitle>{{ t('content.edit.deleteTitle') }}</h2>
                      <p hlmAlertDialogDescription>{{ t('content.edit.deleteHint') }}</p>
                    </hlm-alert-dialog-header>
                    <hlm-alert-dialog-footer>
                      <button hlmAlertDialogCancel (click)="ctx.close()">
                        {{ t('common.cancel') }}
                      </button>
                      <button
                        hlmAlertDialogAction
                        variant="destructive"
                        (click)="ctx.close(); remove()"
                      >
                        {{ t('common.delete') }}
                      </button>
                    </hlm-alert-dialog-footer>
                  </hlm-alert-dialog-content>
                </hlm-alert-dialog>
              </div>
            </section>
          }
        </aside>
      </div>
    </div>
  `,
})
export class DocumentForm implements OnInit {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  protected readonly auth = inject(Auth);
  private readonly schema = inject(Schema);
  private readonly injector = inject(Injector);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;

  readonly type = input.required<ContentType>();
  /** The loaded draft (or only version); `null` for a new document. */
  readonly document = input<Document | null>(null);
  readonly publishedAt = input<string | null>(null);

  protected readonly documentId = signal<string | null>(null);
  protected readonly published = signal(false);
  protected readonly createdAt = signal<string | null>(null);
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
  protected readonly statusLabel = computed(() =>
    this.t(
      (
        {
          draft: 'content.status.draft',
          published: 'content.status.published',
          modified: 'content.status.modified',
        } as const
      )[this.status()],
    ),
  );
  protected readonly statusHint = computed(() =>
    this.t(
      (
        {
          draft: 'content.edit.hint.draft',
          published: 'content.edit.hint.published',
          modified: 'content.edit.hint.modified',
        } as const
      )[this.status()],
    ),
  );
  protected readonly canPublish = computed(() =>
    this.auth.canContent('content.publish', this.type().uid),
  );
  protected readonly heading = computed(() => {
    const type = this.type();
    if (type.kind === 'singleType') return type.displayName;
    if (!this.documentId()) return this.t('content.edit.newEntry');
    const field = this.schema.titleField(type);
    const title = field ? this.model()[field] : null;
    return title ? String(title) : this.t('content.edit.untitled');
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
    this.documentForm = form(this.model, (path) => applyRules(path, type.attributes, this.t), {
      injector: this.injector,
    }) as unknown as Tree;
    this.tree = this.documentForm;
    this.documentId.set(document?.documentId ?? null);
    this.published.set(!!this.publishedAt() || (!type.draftAndPublish && !!document));
    this.createdAt.set(document?.createdAt ?? null);
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
          this.createdAt.set(document.createdAt ?? null);
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
        toast.success(
          this.t(publish ? 'content.edit.toast.published' : 'content.edit.toast.saved'),
        );
        if (type.kind === 'collectionType' && !this.router.url.endsWith(document.documentId)) {
          await this.router.navigate(['/content', type.uid, document.documentId], {
            replaceUrl: true,
          });
        }
        return undefined;
      } catch (error) {
        return this.fail(
          error,
          this.t(publish ? 'content.edit.error.publish' : 'content.edit.error.save'),
        );
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
        toast.success(this.t('content.edit.toast.unpublished'));
      } else {
        const draft = await this.api.get<Document>(
          `/content/${type.uid}/${this.documentId()}`,
          'populate=*',
        );
        this.model.set(toModel(type.attributes, draft, (uid) => this.schema.component(uid)));
        this.draftUpdatedAt.set(this.publishedUpdatedAt());
        toast.success(this.t('content.edit.toast.discarded'));
      }
    } catch (error) {
      this.fail(error, this.t('content.edit.error.action'));
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const type = this.type();
    try {
      await this.api.delete(`/content/${type.uid}/${this.documentId()}`);
      toast.success(this.t('content.edit.toast.deleted'));
      await this.router.navigate(type.kind === 'singleType' ? ['/'] : ['/content', type.uid]);
    } catch (error) {
      this.fail(error, this.t('content.edit.error.delete'));
    }
  }

  /** Maps validation issues onto fields; the rest go to the banner. */
  private fail(error: unknown, title: string) {
    const failure = ApiFailure.from(error);
    this.problem.set(
      failure.issues.length
        ? this.t('content.edit.error.fixFields', { title })
        : this.t('content.edit.error.withMessage', { title, message: failure.message }),
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
  imports: [DocumentForm, NgIcon, HlmSpinnerImports, HlmAlertImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (error()) {
      <div hlmAlert variant="destructive">
        <ng-icon name="lucideCircleAlert" />
        <p hlmAlertTitle>{{ error() }}</p>
      </div>
    } @else if (loading() || !type()) {
      <div
        class="text-muted-foreground flex items-center justify-center gap-2 py-24 text-sm"
        role="status"
      >
        <hlm-spinner /> {{ t('common.loading') }}
      </div>
    } @else {
      @for (key of [loadKey()]; track key) {
        <vd-document-form [type]="type()!" [document]="document()" [publishedAt]="publishedAt()" />
      }
    }
  `,
})
export class ContentEdit {
  private readonly api = inject(Api);
  private readonly engagement = inject(Engagement);
  private readonly schema = inject(Schema);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;

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
      this.error.set(this.t('content.edit.unknownType', { uid }));
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
        // Opening a document marks it seen (it leaves "unseen" dashboard widgets).
        this.engagement.view(uid, documentId).catch(() => undefined);
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
      this.error.set(failure.status === 404 ? this.t('content.edit.notFound') : failure.message);
    } finally {
      this.loading.set(false);
    }
  }
}
