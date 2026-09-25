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
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmDropdownMenuImports } from '@spartan-ng/helm/dropdown-menu';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';

import { Api, ApiFailure, Issue, toQuery } from '../../core/api';
import { Auth } from '../../core/auth';
import {
  ContentLocales,
  LocaleState,
  LocaleVersion,
  isLocalized,
  localeState,
} from '../../core/content-locales';
import { Engagement } from '../../core/engagement';
import { Features } from '../../core/features';
import { I18n } from '../../core/i18n/i18n';
import { Schema } from '../../core/schema';
import { Attributes, ContentType, Document, MediaFile } from '../../core/types';
import { PageHeader } from '../../shared/components/page-header';
import { VoteControl } from '../../shared/components/vote-control';
import { FieldsComponent } from './fields/fields';
import {
  FormModel,
  References,
  documentLabel,
  mediaFilesOf,
  referencesOf,
  toModel,
  toPayload,
} from './fields/model';
import { fillFromLocale, prefillShared, sharedFields } from './locale-model';

type Tree = FieldTree<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

type Translate = I18n['t'];

const LOCALE_STATE_LABELS = {
  published: 'content.locale.state.published',
  draft: 'content.locale.state.draft',
  missing: 'content.locale.state.missing',
} as const satisfies Record<LocaleState, string>;

/** The status dot of a locale version. */
function localeDot(state: LocaleState): string {
  return state === 'published'
    ? 'bg-emerald-500'
    : state === 'draft'
      ? 'bg-muted-foreground/60'
      : 'border-muted-foreground/60 border border-dashed';
}

/** A query string with `?locale=` added when there is one. */
function withLocale(query: string, locale: string | null): string {
  if (!locale) return query;
  const param = `locale=${encodeURIComponent(locale)}`;
  return query ? `${query}&${param}` : param;
}

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
    HlmDialogImports,
    HlmDropdownMenuImports,
    HlmFieldImports,
    HlmNativeSelectImports,
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
          @if (locale(); as current) {
            @let currentState = stateOf(current);
            <button
              hlmBtn
              variant="outline"
              type="button"
              [hlmDropdownMenuTrigger]="localeMenu"
              align="end"
              [attr.aria-label]="t('content.locale.switch', { locale: locales.name(current) })"
            >
              <ng-icon name="lucideLanguages" />
              <span [attr.lang]="current">{{ locales.name(current) }}</span>
              <span
                class="size-2 rounded-full"
                aria-hidden="true"
                [class]="localeDot(currentState)"
                [attr.title]="t(localeStateLabels[currentState])"
              ></span>
              <ng-icon name="lucideChevronDown" class="text-muted-foreground" />
            </button>
            <ng-template #localeMenu>
              <hlm-dropdown-menu class="w-64">
                <hlm-dropdown-menu-label>{{ t('content.locale.label') }}</hlm-dropdown-menu-label>
                <hlm-dropdown-menu-group>
                  @for (option of locales.list() ?? []; track option.code) {
                    @let state = stateOf(option.code);
                    <button
                      hlmDropdownMenuRadio
                      [checked]="option.code === current"
                      (triggered)="switchLocale(option.code)"
                    >
                      <span
                        class="size-2 shrink-0 rounded-full"
                        aria-hidden="true"
                        [class]="localeDot(state)"
                      ></span>
                      <span class="flex min-w-0 flex-col">
                        <span class="truncate" [attr.lang]="option.code">{{ option.name }}</span>
                        <span class="text-muted-foreground text-xs"
                          >{{ option.code }} · {{ t(localeStateLabels[state]) }}</span
                        >
                      </span>
                      <hlm-dropdown-menu-radio-indicator />
                    </button>
                  }
                </hlm-dropdown-menu-group>
              </hlm-dropdown-menu>
            </ng-template>
          }
          @if (documentId() && historyOn() && !missing()) {
            <a
              hlmBtn
              variant="ghost"
              [routerLink]="['/content', type().uid, documentId(), 'history']"
              [queryParams]="locale() ? { locale: locale() } : {}"
            >
              <ng-icon name="lucideHistory" /> {{ t('content.history.open') }}
            </a>
          }
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

      @if (missing()) {
        <div hlmAlert>
          <ng-icon hlmAlertIcon name="lucideLanguages" />
          <p hlmAlertTitle>
            {{ t('content.locale.missingTitle', { locale: locales.name(locale()) }) }}
          </p>
          <p hlmAlertDescription>{{ t('content.locale.missingHint') }}</p>
          @if (fillSources().length) {
            <div class="col-start-2 mt-2">
              <button
                hlmBtn
                variant="outline"
                size="sm"
                type="button"
                [disabled]="busy()"
                (click)="openFill()"
              >
                <ng-icon name="lucideCopy" /> {{ t('content.locale.fill') }}
              </button>
            </div>
          }
        </div>
      }

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
                [context]="{ uid: type().uid, documentId: documentId(), locale: locale() }"
                [relationLabels]="relationLabels()"
                [mediaFiles]="mediaFiles()"
                [refs]="refs()"
                [inverse]="inverse()"
                [shared]="shared()"
                prefix="doc"
              />
            </div>
          </section>
        </form>

        <aside class="flex flex-col gap-6 lg:sticky lg:top-6">
          <section hlmCard size="sm">
            <div hlmCardHeader>
              <h2 hlmCardTitle>{{ t('content.edit.details') }}</h2>
              @if (type().draftAndPublish && !missing()) {
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
              @if (type().draftAndPublish && documentId() && !missing()) {
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

          @if (documentId() && !missing() && auth.canContent('content.delete', type().uid)) {
            <section hlmCard size="sm" class="ring-destructive/30">
              <div hlmCardHeader>
                <h2 hlmCardTitle>{{ t('content.edit.dangerZone') }}</h2>
                <p hlmCardDescription>
                  {{
                    locale()
                      ? t('content.locale.dangerHint', { locale: locales.name(locale()) })
                      : t('content.edit.dangerHint')
                  }}
                </p>
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

    <hlm-dialog [state]="filling() ? 'open' : 'closed'" (closed)="filling.set(false)">
      <hlm-dialog-content
        *hlmDialogPortal="let ctx"
        class="sm:max-w-md"
        [closeLabel]="t('common.close')"
      >
        <hlm-dialog-header>
          <h2 hlmDialogTitle>{{ t('content.locale.fill') }}</h2>
          <p hlmDialogDescription>{{ t('content.locale.fillDescription') }}</p>
        </hlm-dialog-header>
        <div hlmField>
          <label hlmFieldLabel for="fill-source">{{ t('content.locale.fillSource') }}</label>
          <hlm-native-select
            selectId="fill-source"
            [value]="fillSource()"
            (valueChange)="fillSource.set($event ?? '')"
          >
            @for (code of fillSources(); track code) {
              <option hlmNativeSelectOption [value]="code">
                {{ locales.name(code) }} ({{ code }})
              </option>
            }
          </hlm-native-select>
        </div>
        <hlm-dialog-footer>
          <button hlmBtn variant="outline" type="button" (click)="filling.set(false)">
            {{ t('common.cancel') }}
          </button>
          <button hlmBtn type="button" [disabled]="!fillSource() || busy()" (click)="fill()">
            @if (busy()) {
              <hlm-spinner />
            } @else {
              <ng-icon name="lucideCopy" />
            }
            {{ t('content.locale.fillAction') }}
          </button>
        </hlm-dialog-footer>
      </hlm-dialog-content>
    </hlm-dialog>
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
  /** The edited locale (localized types only). */
  readonly locale = input<string | null>(null);
  /** The document's versions per locale, as loaded. */
  readonly versions = input<LocaleVersion[]>([]);
  /** A document that exists in other locales but not in `locale` (`document` is then null). */
  readonly existingId = input<string | null>(null);
  /** Another locale's version, whose shared fields prefill a missing locale. */
  readonly sharedSource = input<Document | null>(null);

  protected readonly locales = inject(ContentLocales);
  protected readonly localeStateLabels = LOCALE_STATE_LABELS;
  protected readonly localeDot = localeDot;
  protected readonly localeVersions = signal<LocaleVersion[]>([]);
  /** The document has no version in `locale` yet; saving creates it. */
  protected readonly missing = signal(false);
  protected readonly filling = signal(false);
  protected readonly fillSource = signal('');
  protected readonly shared = computed(() =>
    this.locale() ? sharedFields(this.type().attributes) : [],
  );
  /** Other locales with a version to copy from. */
  protected readonly fillSources = computed(() =>
    this.localeVersions()
      .filter((version) => version.locale !== this.locale())
      .filter((version) => localeState(this.localeVersions(), version.locale) !== 'missing')
      .map((version) => version.locale),
  );

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
  protected readonly relationLabels = signal<Record<string, Record<string, string>>>({});
  protected readonly inverse = signal<Record<string, { id: string; label: string }[]>>({});
  protected readonly mediaFiles = signal<Record<string, MediaFile[]>>({});
  protected readonly refs = signal<References>({ labels: {}, files: [] });

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
  private readonly features = inject(Features);
  /** Content history is an optional feature; its entry point hides while it is off. */
  protected readonly historyOn = computed(() => this.features.enabled('history'));
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
    const missing = !!this.locale() && !document && !!this.existingId();
    this.missing.set(missing);
    this.localeVersions.set(this.versions());
    this.model.set(
      missing
        ? prefillShared(type.attributes, this.sharedSource(), components)
        : toModel(type.attributes, document, components),
    );
    this.documentForm = form(this.model, (path) => applyRules(path, type.attributes, this.t), {
      injector: this.injector,
    }) as unknown as Tree;
    this.tree = this.documentForm;
    this.documentId.set(document?.documentId ?? this.existingId());
    this.published.set(!!this.publishedAt() || (!type.draftAndPublish && !!document));
    this.createdAt.set(document?.createdAt ?? null);
    this.draftUpdatedAt.set(document?.updatedAt ?? null);
    this.publishedUpdatedAt.set(this.publishedAt());
    // A missing locale shows the shared relations and media of the other version.
    this.absorb(missing ? this.sharedSource() : document);
  }

  /** Adds the labels and previews of a populated document's references. */
  private absorb(document: Document | null): void {
    const type = this.type();
    const components = (uid: string) => this.schema.component(uid);
    const files = mediaFilesOf(type.attributes, document);
    this.mediaFiles.update((current) => {
      const next = { ...current };
      for (const [name, list] of Object.entries(files)) {
        const known = new Set((next[name] ?? []).map((file) => file.id));
        next[name] = [...(next[name] ?? []), ...list.filter((file) => !known.has(file.id))];
      }
      return next;
    });
    // Labels and previews for relations and media nested in components and dynamic zones.
    const current = this.refs();
    this.refs.set(
      referencesOf(
        type.attributes,
        document,
        components,
        (target) => {
          const targetType = this.schema.type(target);
          return targetType ? this.schema.titleField(targetType) : null;
        },
        { labels: { ...current.labels }, files: [...current.files] },
      ),
    );

    // Labels for relation pickers and read-only inverse sides, from the populated document.
    const relationLabels = { ...this.relationLabels() };
    const inverse = { ...this.inverse() };
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
        inverse[name] = labelled;
      } else {
        relationLabels[name] = {
          ...relationLabels[name],
          ...Object.fromEntries(labelled.map((item) => [item.id, item.label])),
        };
      }
    }
    this.relationLabels.set(relationLabels);
    this.inverse.set(inverse);
  }

  protected stateOf(code: string): LocaleState {
    return localeState(this.localeVersions(), code);
  }

  protected switchLocale(code: string): void {
    if (code === this.locale()) return;
    const type = this.type();
    const path =
      type.kind === 'singleType'
        ? ['/single', type.uid]
        : ['/content', type.uid, this.documentId() ?? 'new'];
    void this.router.navigate(path, { queryParams: { locale: code } });
  }

  /** Reloads the document's locale versions (after a save or a publication change). */
  private async refreshVersions(): Promise<void> {
    const id = this.documentId();
    if (!this.locale() || !id) return;
    try {
      this.localeVersions.set(
        await this.api.get<LocaleVersion[]>(`/content/${this.type().uid}/${id}/locales`),
      );
    } catch {
      // The switcher keeps the previous states.
    }
  }

  protected openFill(): void {
    const sources = this.fillSources();
    const preferred = this.locales.defaultCode();
    this.fillSource.set(preferred && sources.includes(preferred) ? preferred : (sources[0] ?? ''));
    this.filling.set(true);
  }

  /** Copies the localized fields of another locale's version into the form. */
  protected async fill(): Promise<void> {
    const source = this.fillSource();
    const id = this.documentId();
    if (!source || !id) return;
    const type = this.type();
    const components = (uid: string) => this.schema.component(uid);
    this.busy.set(true);
    try {
      const document = await this.api.get<Document>(
        `/content/${type.uid}/${id}`,
        withLocale('populate=*&status=draft', source),
      );
      this.absorb(document);
      this.model.set(
        fillFromLocale(
          type.attributes,
          this.model(),
          toModel(type.attributes, document, components),
          components,
        ),
      );
      this.filling.set(false);
      toast.success(this.t('content.locale.filled', { locale: this.locales.name(source) }));
    } catch (error) {
      toast.error(this.t('content.locale.fillError', { locale: this.locales.name(source) }), {
        description: ApiFailure.from(error).message,
      });
    } finally {
      this.busy.set(false);
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
        const locale = this.locale();
        let document: Document;
        if (this.documentId()) {
          document = await this.api.put<Document>(
            `${base}/${this.documentId()}`,
            { data },
            withLocale('populate=*', locale),
          );
          if (this.missing()) {
            this.missing.set(false);
            this.createdAt.set(document.createdAt ?? null);
          }
        } else {
          document = await this.api.post<Document>(
            base,
            { data },
            withLocale('populate=*', locale),
          );
          this.documentId.set(document.documentId);
          this.createdAt.set(document.createdAt ?? null);
        }
        this.draftUpdatedAt.set(document.updatedAt ?? null);
        if (publish) {
          const live = await this.api.post<Document>(
            `${base}/${document.documentId}/actions/publish`,
            {},
            withLocale('', locale),
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
        void this.refreshVersions();
        const path = this.router.url.split('?')[0];
        if (type.kind === 'collectionType' && !path.endsWith(document.documentId)) {
          await this.router.navigate(['/content', type.uid, document.documentId], {
            replaceUrl: true,
            queryParams: locale ? { locale } : {},
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
    const locale = this.locale();
    this.busy.set(true);
    try {
      await this.api.post(
        `/content/${type.uid}/${this.documentId()}/actions/${action}`,
        {},
        withLocale('', locale),
      );
      if (action === 'unpublish') {
        this.published.set(false);
        void this.refreshVersions();
        toast.success(this.t('content.edit.toast.unpublished'));
      } else {
        const draft = await this.api.get<Document>(
          `/content/${type.uid}/${this.documentId()}`,
          withLocale('populate=*', locale),
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
      await this.api.delete(
        `/content/${type.uid}/${this.documentId()}`,
        withLocale('', this.locale()) || undefined,
      );
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
        <vd-document-form
          [type]="type()!"
          [document]="document()"
          [publishedAt]="publishedAt()"
          [locale]="activeLocale()"
          [versions]="versions()"
          [existingId]="existingId()"
          [sharedSource]="sharedSource()"
        />
      }
    }
  `,
})
export class ContentEdit {
  private readonly api = inject(Api);
  private readonly engagement = inject(Engagement);
  private readonly schema = inject(Schema);
  private readonly locales = inject(ContentLocales);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;

  readonly uid = input.required<string>();
  readonly documentId = input<string>();
  /** `?locale=` (localized types; the default locale otherwise). */
  readonly locale = input<string>();

  protected readonly type = computed(() => this.schema.type(this.uid()));
  protected readonly document = signal<Document | null>(null);
  protected readonly publishedAt = signal<string | null>(null);
  protected readonly activeLocale = signal<string | null>(null);
  protected readonly versions = signal<LocaleVersion[]>([]);
  protected readonly existingId = signal<string | null>(null);
  protected readonly sharedSource = signal<Document | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly loadKey = signal('');

  constructor() {
    // Reload whenever the route's type or document changes.
    effect(() => {
      const key = `${this.uid()}|${this.documentId() ?? ''}|${this.locale() ?? ''}`;
      untracked(() => void this.load(key));
    });
  }

  /** Identifies the latest load; an older one stops once it notices. */
  private requests = 0;

  private async load(key: string): Promise<void> {
    const request = ++this.requests;
    this.loading.set(true);
    this.error.set(null);
    this.document.set(null);
    this.publishedAt.set(null);
    this.versions.set([]);
    this.existingId.set(null);
    this.sharedSource.set(null);
    const uid = this.uid();
    const type = this.type();
    if (!type) {
      this.error.set(this.t('content.edit.unknownType', { uid }));
      this.loading.set(false);
      return;
    }
    try {
      let locale: string | null = null;
      if (isLocalized(type)) {
        await this.locales.load();
        locale = this.locales.resolve(this.locale());
      }
      if (request !== this.requests) return;
      this.activeLocale.set(locale);
      let documentId = this.documentId() ?? null;
      if (type.kind === 'singleType') documentId = await this.singleDocument(uid, locale);
      if (documentId && locale) {
        const versions = await this.api.get<LocaleVersion[]>(
          `/content/${uid}/${documentId}/locales`,
        );
        this.versions.set(versions);
        if (localeState(versions, locale) === 'missing') {
          // A new locale of an existing document: its shared fields come from another one.
          const source =
            versions.find((version) => version.locale === this.locales.defaultCode()) ??
            versions[0];
          if (!source) throw new ApiFailure(404, 'NotFoundError', 'Not Found');
          this.sharedSource.set(
            await this.api.get<Document>(
              `/content/${uid}/${documentId}`,
              withLocale(source.draft ? 'populate=*&status=draft' : 'populate=*', source.locale),
            ),
          );
          this.existingId.set(documentId);
          documentId = null;
        }
      }
      if (documentId) {
        this.document.set(
          await this.api.get<Document>(
            `/content/${uid}/${documentId}`,
            withLocale('populate=*&status=draft', locale),
          ),
        );
        // Opening a document marks it seen (it leaves "unseen" dashboard widgets).
        this.engagement.view(uid, documentId).catch(() => undefined);
        if (type.draftAndPublish) {
          try {
            const live = await this.api.get<Document>(
              `/content/${uid}/${documentId}`,
              withLocale('status=published&fields=updatedAt', locale),
            );
            this.publishedAt.set(live.updatedAt ?? live.publishedAt ?? null);
          } catch (error) {
            if (ApiFailure.from(error).status !== 404) throw error;
          }
        }
      }
      if (request !== this.requests) return;
      this.loadKey.set(key);
    } catch (error) {
      if (request !== this.requests) return;
      const failure = ApiFailure.from(error);
      this.error.set(failure.status === 404 ? this.t('content.edit.notFound') : failure.message);
    } finally {
      if (request === this.requests) this.loading.set(false);
    }
  }

  /**
   * The single type's document: its version in `locale`, else (localized types) a version
   * in another locale, so that saving adds `locale` to it.
   */
  private async singleDocument(uid: string, locale: string | null): Promise<string | null> {
    const first = async (code: string | null) => {
      const list = await this.api.list<Document>(
        `/content/${uid}`,
        withLocale(toQuery({ pagination: { pageSize: 1 } }), code),
      );
      return list.data[0]?.documentId ?? null;
    };
    const found = await first(locale);
    if (found || !locale) return found;
    for (const other of this.locales.list() ?? []) {
      if (other.code === locale) continue;
      const id = await first(other.code);
      if (id) return id;
    }
    return null;
  }
}
