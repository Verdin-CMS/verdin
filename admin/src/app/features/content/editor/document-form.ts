import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Injector,
  OnInit,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FieldTree, form, submit } from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertImports } from '@spartan-ng/helm/alert';

import { AiActions, aiErrorMessage } from '../../../core/ai';
import { ApiFailure, Issue } from '../../../core/api';
import { Auth } from '../../../core/auth';
import { fieldLabel } from '../../../core/comments';
import { ContentLocales, LocaleVersion, localeState } from '../../../core/content-locales';
import { ContentDocuments } from '../../../core/documents';
import { EntryDuplicates } from '../../../core/duplicate';
import { EditView } from '../../../core/edit-view';
import { previewTemplate } from '../../../core/feature-settings';
import { Features } from '../../../core/features';
import { I18n } from '../../../core/i18n/i18n';
import { isMorphOwner } from '../../../core/morph';
import { EntryPresence } from '../../../core/presence';
import { Realtime } from '../../../core/realtime';
import { EntryReview as EntryReviewState, pendingPublishStage } from '../../../core/review';
import { Schema } from '../../../core/schema';
import { ContentType, Document, MediaFile } from '../../../core/types';
import { Unseen } from '../../../core/unseen';
import { Confirm, HasUnsavedChanges } from '../../../shared/components/confirm';
import { PageHeader } from '../../../shared/components/page-header';
import { mergeTranslation, translatableFields } from '../ai-model';
import { CollabSheet } from '../collab/collab-sheet';
import { EntryCollab } from '../collab/entry-collab';
import { PresenceAvatars } from '../collab/presence-avatars';
import { EntryReleases } from '../entry-releases';
import { EntryReview } from '../entry-review';
import { EntryUsage } from '../entry-usage';
import { humanize } from '../fields/fields';
import {
  FormModel,
  MorphEntry,
  References,
  mediaFilesOf,
  mergeMorphEntries,
  morphEntriesOf,
  referencesOf,
  relationLabelsOf,
  toModel,
  toPayload,
  withoutPasswords,
} from '../fields/model';
import { RelatedEditor } from '../fields/related-editor';
import { applyRules } from '../fields/rules';
import { fillFromLocale, prefillShared, sharedFields } from '../locale-model';
import { frameableUrl } from '../preview-pane';
import { RelatedEntrySheet } from '../related-entry-sheet';
import {
  EditTarget,
  findFieldElement,
  resolveFieldPath,
  revealField,
  validFieldPath,
} from '../visual-editing';
import { DocumentBody } from './document-body';
import { EntryDangerZone } from './entry-danger-zone';
import { EntryDetails } from './entry-details';
import { EntryToolbar } from './entry-toolbar';
import { MissingLocaleNotice, RemoteChangeNotice, TranslationReview } from './editor-notices';
import { LocaleFillDialog, TranslateDialog } from './locale-dialogs';
import { LocaleSwitcher } from './locale-switcher';
import { PreviewSplit } from './preview-split';

type Tree = FieldTree<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * The editable form of one document; recreated per document by `ContentEdit`. It holds
 * the form, its state and the actions (save, publish, locales, translation, preview); the
 * header toolbar, notices, side panels and dialogs are child components.
 */
@Component({
  selector: 'vd-document-form',
  imports: [
    RouterLink,
    NgIcon,
    PageHeader,
    PresenceAvatars,
    LocaleSwitcher,
    EntryToolbar,
    MissingLocaleNotice,
    TranslationReview,
    RemoteChangeNotice,
    PreviewSplit,
    DocumentBody,
    EntryDetails,
    EntryReview,
    EntryReleases,
    EntryUsage,
    EntryDangerZone,
    RelatedEntrySheet,
    CollabSheet,
    LocaleFillDialog,
    TranslateDialog,
    HlmAlertImports,
  ],
  // Relation pickers open related entries in this editor's side sheet; comments, tasks and
  // presence follow the open entry.
  providers: [RelatedEditor, EntryCollab, EntryPresence],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:beforeunload)': 'beforeUnload($event)' },
  template: `
    <div class="flex flex-col gap-6">
      <vd-page-header [title]="heading()">
        @if (type().kind === 'collectionType') {
          <div eyebrow>
            <a
              class="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
              [routerLink]="['/content', type().uid]"
              ><ng-icon name="lucideArrowLeft" size="14" class="rtl:-scale-x-100" />{{
                type().displayName
              }}</a
            >
          </div>
        }
        <div actions>
          <vd-presence-avatars [viewers]="presence.others()" />
          @if (locale(); as current) {
            <vd-locale-switcher
              [uid]="type().uid"
              [locale]="current"
              [versions]="localeVersions()"
              (switched)="switchLocale($event)"
            />
          }
          <vd-entry-toolbar
            [type]="type()"
            [documentId]="documentId()"
            [locale]="locale()"
            [missing]="missing()"
            [busy]="busy()"
            [canSave]="canSave()"
            [canPublish]="canPublish()"
            [canDuplicate]="canDuplicate()"
            [canConfigure]="canConfigure()"
            [canTranslate]="canTranslate()"
            [translateFrom]="translateDefault()"
            [historyOn]="historyOn()"
            [collabOn]="collabOn()"
            [previewOn]="previewOn()"
            [previewing]="previewing()"
            [previewLoading]="previewLoading()"
            [sideBySide]="sideBySide()"
            [publishHold]="publishHold()"
            (save)="save($event)"
            (openPreview)="openPreview()"
            (toggleSideBySide)="toggleSideBySide()"
            (translate)="openTranslate()"
            (duplicate)="duplicate()"
            (configure)="configureView()"
          />
        </div>
      </vd-page-header>

      @if (missing()) {
        <vd-missing-locale-notice
          [locale]="locale()"
          [canFill]="fillSources().length > 0"
          [canTranslate]="canTranslate()"
          [translateFrom]="translateDefault()"
          [busy]="busy()"
          [translating]="translating()"
          (fill)="openFill()"
          (translate)="openTranslate()"
        />
      }

      @if (aiChanges(); as changes) {
        <vd-translation-review
          [changes]="changes"
          [fieldLabel]="labelOf"
          (focusField)="focusField($event)"
          (undo)="undoTranslation()"
          (keep)="aiChanges.set(null)"
        />
      }
      <div class="contents" aria-live="polite">
        @if (presence.holder(); as holder) {
          <div hlmAlert>
            <ng-icon hlmAlertIcon name="lucideLock" />
            <p hlmAlertTitle>{{ t('presence.lockTitle', { name: holder.name }) }}</p>
            <p hlmAlertDescription>{{ t('presence.lockHint') }}</p>
          </div>
        }
        @if (remoteChange(); as change) {
          <vd-remote-change-notice
            [event]="change"
            (reload)="reloadRemote()"
            (dismiss)="remoteChange.set(null)"
          />
        }
      </div>

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

      <vd-preview-split
        [sideBySide]="sideBySide()"
        [url]="previewUrl()"
        [version]="previewVersion()"
        [title]="heading()"
        [loading]="previewLoading()"
        (reload)="refreshPreview()"
        (openTab)="openPreview()"
        (closed)="sideBySide.set(false)"
        (edit)="openFromPreview($event)"
      >
        <div class="grid min-w-0 items-start gap-6" [class.lg:grid-cols-3]="!sideBySide()">
          <vd-document-body
            [class.lg:col-span-2]="!sideBySide()"
            [attributes]="type().attributes"
            [tree]="tree"
            [context]="{
              uid: type().uid,
              documentId: documentId(),
              locale: locale(),
              saved: !missing(),
            }"
            [relationLabels]="relationLabels()"
            [mediaFiles]="mediaFiles()"
            [refs]="refs()"
            [inverse]="inverse()"
            [morphs]="morphs()"
            [shared]="shared()"
            [view]="view()"
            [changed]="aiChanges()?.fields ?? []"
            (submitted)="save(false)"
          />

          <aside
            class="flex flex-col gap-6"
            [class.lg:sticky]="!sideBySide()"
            [class.lg:top-6]="!sideBySide()"
          >
            <vd-entry-details
              [type]="type()"
              [documentId]="documentId()"
              [missing]="missing()"
              [published]="published()"
              [createdAt]="createdAt()"
              [draftUpdatedAt]="draftUpdatedAt()"
              [publishedUpdatedAt]="publishedUpdatedAt()"
              [canPublish]="canPublish()"
              [busy]="busy()"
              (unpublish)="confirmAction('unpublish')"
              (discard)="confirmAction('discard-draft')"
            />

            @if (reviewOn() && !missing()) {
              @if (documentId(); as id) {
                <vd-entry-review
                  [uid]="type().uid"
                  [documentId]="id"
                  [locale]="locale()"
                  (changed)="review.set($event)"
                />
              }
            }

            @if (releasesOn() && type().draftAndPublish && !missing()) {
              @if (documentId(); as id) {
                <vd-entry-releases
                  [uid]="type().uid"
                  [documentId]="id"
                  [locale]="locale()"
                  [canAdd]="canPublish()"
                />
              }
            }

            @if (!missing()) {
              @if (documentId(); as id) {
                <vd-entry-usage [uid]="type().uid" [documentId]="id" [locale]="locale()" />
              }
            }

            @if (!missing() && canDelete()) {
              @if (documentId(); as id) {
                <vd-entry-danger-zone
                  [uid]="type().uid"
                  [documentId]="id"
                  [locale]="locale()"
                  (confirmed)="remove()"
                />
              }
            }
          </aside>
        </div>
      </vd-preview-split>
    </div>

    <vd-related-entry-sheet />
    @if (collabOn()) {
      <vd-collab-sheet [heading]="heading()" />
    }

    <vd-locale-fill-dialog
      [open]="filling()"
      [sources]="fillSources()"
      [(source)]="fillSource"
      [busy]="busy()"
      (confirm)="fill()"
      (closed)="filling.set(false)"
    />
    <vd-translate-dialog
      [open]="translateOpen()"
      [locale]="locale()"
      [sources]="fillSources()"
      [(source)]="translateSource"
      [translating]="translating()"
      (confirm)="translate()"
      (closed)="translateOpen.set(false)"
    />
  `,
})
export class DocumentForm implements OnInit, HasUnsavedChanges {
  private readonly documents = inject(ContentDocuments);
  private readonly confirm = inject(Confirm);
  private readonly unseen = inject(Unseen);
  private readonly router = inject(Router);
  protected readonly auth = inject(Auth);
  private readonly schema = inject(Schema);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
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
  /** The type's edit view (`null`: the default layout). */
  readonly view = input<EditView | null>(null);
  /** A field path to scroll to and focus once shown (`?field=`, from visual editing). */
  readonly focus = input<string | null>(null);

  protected readonly ai = inject(AiActions);
  /** "Translate from…": the dialog, its source locale and the running request. */
  protected readonly translateOpen = signal(false);
  protected readonly translateSource = signal('');
  protected readonly translating = signal(false);
  /** The last translation applied to the form, until kept, undone or saved. */
  protected readonly aiChanges = signal<{
    source: string;
    fields: string[];
    previous: FormModel;
  } | null>(null);
  /** Asks the page to load the entry again (after another admin changed it). */
  readonly reload = output<void>();

  protected readonly collab = inject(EntryCollab);
  protected readonly presence = inject(EntryPresence);
  private readonly realtime = inject(Realtime);
  /** Another admin's change to the open entry (the event's name), until reloaded. */
  protected readonly remoteChange = signal<string | null>(null);
  /** Comments and tasks (optional feature), once the entry exists in this locale. */
  protected readonly collabOn = computed(
    () => this.collab.on() && !!this.documentId() && !this.missing(),
  );

  protected readonly locales = inject(ContentLocales);
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
      .filter((version) => this.auth.canInLocale('content.read', this.type().uid, version.locale))
      .map((version) => version.locale),
  );

  /** The translation's preferred source: the default locale, else the first other one. */
  protected readonly translateDefault = computed(() => {
    const sources = this.fillSources();
    const preferred = this.locales.defaultCode();
    return preferred && sources.includes(preferred) ? preferred : (sources[0] ?? '');
  });
  /** AI translation: a localized entry, another readable locale, and rights to edit this one. */
  protected readonly canTranslate = computed(
    () =>
      this.ai.enabled() &&
      !!this.locale() &&
      !!this.documentId() &&
      this.fillSources().length > 0 &&
      this.canSave() &&
      translatableFields(this.type().attributes).length > 0,
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
  /** Linked entries of polymorphic relations: owners' labels, inverse sides' lists. */
  protected readonly morphs = signal<Record<string, MorphEntry[]>>({});
  protected readonly mediaFiles = signal<Record<string, MediaFile[]>>({});
  protected readonly refs = signal<References>({ labels: {}, files: [] });

  private readonly features = inject(Features);
  /** Content history is an optional feature; its entry point hides while it is off. */
  protected readonly historyOn = computed(() => this.features.enabled('history'));
  /** Actions in the edited locale (permissions may be limited to some locales). */
  protected readonly canPublish = computed(() =>
    this.auth.canInLocale('content.publish', this.type().uid, this.locale()),
  );
  protected readonly canDelete = computed(() =>
    this.auth.canInLocale('content.delete', this.type().uid, this.locale()),
  );
  /** Releases (optional feature): the editor's panel needs `releases.manage`. */
  protected readonly releasesOn = computed(
    () => this.features.enabled('releases') && this.auth.can('releases.manage'),
  );
  /** Review workflows (optional feature): the entry's stage, when its type has a workflow. */
  protected readonly reviewOn = computed(() => this.features.enabled('review'));
  protected readonly review = signal<EntryReviewState | null>(null);
  /** The stage the entry must reach before it can be published (`null`: none). */
  protected readonly publishHold = computed(() =>
    this.reviewOn() && this.type().draftAndPublish ? pendingPublishStage(this.review()) : null,
  );
  /** Preview (optional feature): only for types with a URL template. */
  protected readonly previewOn = computed(
    () =>
      this.features.enabled('preview') &&
      !!previewTemplate(this.features.settings('preview'), this.type().uid),
  );
  protected readonly previewing = signal(false);
  /** The side-by-side preview: its URL (checked http(s)) and a counter that reloads it. */
  protected readonly sideBySide = signal(false);
  protected readonly previewUrl = signal<string | null>(null);
  protected readonly previewVersion = signal(0);
  protected readonly previewLoading = signal(false);

  private readonly duplicates = inject(EntryDuplicates);
  /** "Configure the view" needs `views.manage`. */
  protected readonly canConfigure = computed(() => this.auth.can('views.manage'));
  protected readonly canDuplicate = computed(
    () =>
      this.type().kind === 'collectionType' &&
      !!this.documentId() &&
      !this.missing() &&
      this.auth.canInLocale('content.create', this.type().uid, this.locale()),
  );
  protected readonly heading = computed(() => {
    const type = this.type();
    if (type.kind === 'singleType') return type.displayName;
    if (!this.documentId()) return this.t('content.edit.newEntry');
    const field = this.schema.titleField(type);
    const title = field ? this.model()[field] : null;
    return title ? String(title) : this.t('content.edit.untitled');
  });

  /** Set while navigating away on purpose (after asking, or once the entry is gone). */
  private leaving = false;

  /** Edits not saved yet: changed fields, or an AI translation to keep or undo. */
  hasUnsavedChanges(): boolean {
    if (this.leaving || !this.documentForm) return false;
    return this.documentForm().dirty() || !!this.aiChanges();
  }

  /** Closing or reloading the tab with unsaved edits: the browser asks first. */
  protected beforeUnload(event: BeforeUnloadEvent): void {
    if (this.hasUnsavedChanges()) event.preventDefault();
  }

  /** Navigates without the unsaved changes guard (the admin already agreed). */
  private leave(navigation: () => Promise<boolean>): void {
    this.leaving = true;
    void navigation().finally(() => (this.leaving = false));
  }

  /** Asks before discarding unsaved edits; `true` when there are none. */
  private async mayDiscard(): Promise<boolean> {
    return !this.hasUnsavedChanges() || (await this.confirm.discardChanges());
  }

  /** Another admin changed the entry: load it again, once unsaved edits may go. */
  protected async reloadRemote(): Promise<void> {
    if (await this.mayDiscard()) this.reload.emit();
  }

  protected canSave(): boolean {
    const uid = this.type().uid;
    // A missing locale version is created with an update of the document.
    return this.documentId()
      ? this.auth.canInLocale('content.update', uid, this.locale())
      : this.auth.canInLocale('content.create', uid, this.locale());
  }

  constructor() {
    // Scrolls to `?field=` once the form shows (again when it changes on the same entry).
    effect(() => {
      const path = validFieldPath(this.focus());
      if (!path) return;
      untracked(() => afterNextRender(() => this.focusField(path), { injector: this.injector }));
    });
  }

  ngOnInit(): void {
    void this.ai.load();
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
    this.documentForm = form(
      this.model,
      (path) =>
        applyRules(path, type.attributes, this.t, {
          scope: this.model,
          readOnly: (name) => this.view()?.fields[name]?.editable === false,
        }),
      { injector: this.injector },
    ) as unknown as Tree;
    this.tree = this.documentForm;
    this.documentId.set(document?.documentId ?? this.existingId());
    this.published.set(!!this.publishedAt() || (!type.draftAndPublish && !!document));
    this.createdAt.set(document?.createdAt ?? null);
    this.draftUpdatedAt.set(document?.updatedAt ?? null);
    this.publishedUpdatedAt.set(this.publishedAt());
    // A missing locale shows the shared relations and media of the other version.
    this.absorb(missing ? this.sharedSource() : document);
    this.showMorphs(document);
    this.followCollaboration();
  }

  /**
   * Presence (heartbeats, `editing` once the form has unsaved changes), comments and
   * tasks of the open entry, and other admins' changes to it.
   */
  private followCollaboration(): void {
    const key = computed(() => {
      const documentId = this.documentId();
      if (!documentId || this.missing()) return null;
      return { uid: this.type().uid, documentId, locale: this.locale() };
    });
    effect(
      () => {
        const entry = key();
        const comments = this.collab.on();
        untracked(() => {
          this.presence.track(entry);
          this.collab.bind(comments ? entry : null);
        });
      },
      { injector: this.injector },
    );
    effect(() => this.presence.setEditing(this.documentForm().dirty()), {
      injector: this.injector,
    });
    effect(() => this.collab.setViewers(this.presence.viewers()), { injector: this.injector });
    this.collab.labeler.set((path) => this.fieldLabel(path));
    const remote = ['entry.update', 'entry.publish', 'entry.unpublish', 'entry.discard-draft'];
    this.realtime.messages.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((message) => {
      const entry = key();
      if (!entry || message.uid !== entry.uid || message.documentId !== entry.documentId) return;
      if (this.realtime.isOwn(message)) return;
      // Deleting removes every locale; the other changes concern this locale only.
      if (message.event === 'entry.delete') this.remoteChange.set(message.event);
      else if (remote.includes(message.event) && (message.locale ?? '') === (entry.locale ?? ''))
        this.remoteChange.set(message.event);
    });
  }

  /** A field path as it reads in the comments panel (`SEO › Meta title`). */
  protected fieldLabel(path: string): string {
    return fieldLabel(path, (name, depth) =>
      depth === 0 ? this.view()?.fields[name]?.label || humanize(name) : humanize(name),
    );
  }
  protected readonly labelOf = (path: string): string => this.fieldLabel(path);

  /** The polymorphic links of the loaded version (populated by `populate=*`). */
  private showMorphs(document: Document | null): void {
    this.morphs.set(this.morphEntries(document));
  }

  /** The linked entries of a populated document (`ownersOnly`: of polymorphic owners). */
  private morphEntries(
    document: Document | null,
    ownersOnly = false,
  ): Record<string, MorphEntry[]> {
    const attributes = this.type().attributes;
    const entries = morphEntriesOf(
      attributes,
      document,
      (uid) => this.schema.type(uid),
      (type) => this.schema.titleField(type),
    );
    if (!ownersOnly) return entries;
    return Object.fromEntries(
      Object.entries(entries).filter(([name]) => isMorphOwner(attributes[name])),
    );
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
    const found = relationLabelsOf(type.attributes, document, (target, name) => {
      const main = this.view()?.fields[name]?.mainField;
      if (main) return main;
      const targetType = this.schema.type(target);
      return targetType ? this.schema.titleField(targetType) : null;
    });
    const relationLabels = { ...this.relationLabels() };
    for (const [name, labels] of Object.entries(found.labels))
      relationLabels[name] = { ...relationLabels[name], ...labels };
    const inverse = { ...this.inverse(), ...found.inverse };
    this.relationLabels.set(relationLabels);
    this.inverse.set(inverse);
  }

  protected async switchLocale(code: string): Promise<void> {
    if (code === this.locale()) return;
    // Another locale opens a fresh form: unsaved edits of this one would be lost.
    if (!(await this.mayDiscard())) return;
    const type = this.type();
    const path =
      type.kind === 'singleType'
        ? ['/single', type.uid]
        : ['/content', type.uid, this.documentId() ?? 'new'];
    this.leave(() => this.router.navigate(path, { queryParams: { locale: code } }));
  }

  /** Reloads the document's locale versions (after a save or a publication change). */
  private async refreshVersions(): Promise<void> {
    const id = this.documentId();
    if (!this.locale() || !id) return;
    try {
      this.localeVersions.set(await this.documents.locales(this.type().uid, id, this.locale()));
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
      const document = await this.documents.get(type.uid, id, {
        populate: '*',
        status: 'draft',
        locale: source,
      });
      this.absorb(document);
      // Polymorphic links copied from the other locale keep their type names and labels.
      this.morphs.update((current) =>
        mergeMorphEntries(current, this.morphEntries(document, true)),
      );
      this.model.set(
        fillFromLocale(
          type.attributes,
          this.model(),
          toModel(type.attributes, document, components),
          components,
        ),
      );
      this.filling.set(false);
      this.aiChanges.set(null);
      toast.success(this.t('content.locale.filled', { locale: this.locales.name(source) }));
    } catch (error) {
      toast.error(this.t('content.locale.fillError', { locale: this.locales.name(source) }), {
        description: ApiFailure.from(error).message,
      });
    } finally {
      this.busy.set(false);
    }
  }

  protected openTranslate(): void {
    this.translateSource.set(this.translateDefault());
    this.translateOpen.set(true);
  }

  /**
   * Translates the localized text fields of another locale's draft into the form, as
   * unsaved changes: the changed fields are marked and the banner can undo them.
   */
  protected async translate(): Promise<void> {
    const source = this.translateSource();
    const id = this.documentId();
    const target = this.locale();
    if (!source || !id || !target || this.translating()) return;
    const type = this.type();
    const components = (uid: string) => this.schema.component(uid);
    this.translating.set(true);
    try {
      const { fields } = await this.ai.translate({
        uid: type.uid,
        documentId: id,
        from: source,
        to: target,
        fields: translatableFields(type.attributes),
      });
      const previous = this.aiChanges()?.previous ?? this.model();
      const { model, changed } = mergeTranslation(
        type.attributes,
        this.model(),
        fields ?? {},
        components,
      );
      this.translateOpen.set(false);
      if (!changed.length) {
        toast.info(this.t('ai.translate.nothing'));
        return;
      }
      // Labels of relations and files inside translated components.
      this.absorb(fields as Document);
      this.model.set(model);
      this.aiChanges.set({ source, fields: changed, previous });
      toast.success(
        this.t('ai.translate.done', { count: changed.length, locale: this.locales.name(source) }),
      );
      afterNextRender(() => this.focusField(changed[0], false), { injector: this.injector });
    } catch (error) {
      toast.error(this.t('ai.translate.error'), { description: aiErrorMessage(error, this.t) });
    } finally {
      this.translating.set(false);
    }
  }

  protected undoTranslation(): void {
    const changes = this.aiChanges();
    if (!changes) return;
    this.model.set(changes.previous);
    this.aiChanges.set(null);
    toast.success(this.t('ai.translate.undone'));
  }

  /**
   * Scrolls to a field (a dotted path like `seo.metaTitle` or `sections.2.title`), focuses
   * it and highlights it. Controls that render late (editors) get a few frames.
   */
  focusField(path: string, focus = true): void {
    const type = this.type();
    const segments = resolveFieldPath(type.attributes, this.model(), path, (uid) =>
      this.schema.component(uid),
    );
    if (!segments.length) {
      toast.info(this.t('visualEditing.fieldNotFound', { field: path }));
      return;
    }
    let attempts = 0;
    const attempt = () => {
      const element = findFieldElement(document, 'doc', segments);
      if (element) {
        if (focus) revealField(element);
        else element.closest<HTMLElement>('[data-field]')?.scrollIntoView({ block: 'center' });
        return;
      }
      if (++attempts < 20) requestAnimationFrame(attempt);
      else toast.info(this.t('visualEditing.fieldHidden', { field: path }));
    };
    attempt();
  }

  /** The preview's overlay asked to edit a field: here, or in another entry. */
  protected openFromPreview(target: EditTarget): void {
    const type = this.type();
    const locale = target.locale ?? this.locale();
    const here =
      target.uid === type.uid &&
      target.documentId === this.documentId() &&
      (!this.locale() || locale === this.locale());
    if (here) {
      if (target.field) this.focusField(target.field);
      return;
    }
    const other = this.schema.type(target.uid);
    if (!other || !this.auth.canInLocale('content.read', other.uid, target.locale)) {
      toast.error(this.t('visualEditing.cannotOpen'));
      return;
    }
    const open = () =>
      this.leave(() =>
        this.router.navigate(
          other.kind === 'singleType'
            ? ['/single', other.uid]
            : ['/content', other.uid, target.documentId],
          {
            queryParams: {
              ...(target.locale ? { locale: target.locale } : {}),
              ...(target.field ? { field: target.field } : {}),
            },
          },
        ),
      );
    if (this.hasUnsavedChanges()) {
      toast.warning(this.t('visualEditing.unsaved'), {
        action: { label: this.t('visualEditing.openAnyway'), onClick: open },
      });
      return;
    }
    open();
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
        const locale = this.locale();
        const write = { populate: '*', locale } as const;
        let document: Document;
        const existing = this.documentId();
        if (existing) {
          document = await this.documents.update(type.uid, existing, data, write);
          if (this.missing()) {
            this.missing.set(false);
            this.createdAt.set(document.createdAt ?? null);
          }
        } else {
          document = await this.documents.create(type.uid, data, write);
          this.documentId.set(document.documentId);
          this.createdAt.set(document.createdAt ?? null);
        }
        this.draftUpdatedAt.set(document.updatedAt ?? null);
        // Saved links, as populated: their current labels.
        this.morphs.update((current) =>
          mergeMorphEntries(current, this.morphEntries(document, true)),
        );
        if (publish) {
          const live = await this.documents.publish(type.uid, document.documentId, locale);
          this.published.set(true);
          this.publishedUpdatedAt.set(live.updatedAt ?? null);
          this.draftUpdatedAt.set(live.updatedAt ?? null);
        } else if (!type.draftAndPublish) {
          this.published.set(true);
        }
        // Passwords are never read back: the field empties again ("keep the current one").
        this.model.set(withoutPasswords(type.attributes, this.model()));
        this.aiChanges.set(null);
        // Saved: no unsaved changes any more (presence stops saying "editing"), and this
        // version is the latest.
        this.documentForm().reset();
        this.remoteChange.set(null);
        toast.success(
          this.t(publish ? 'content.edit.toast.published' : 'content.edit.toast.saved'),
        );
        if (this.sideBySide()) void this.refreshPreview();
        void this.refreshVersions();
        this.unseen.refresh();
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

  /** Unpublishing and discarding the draft ask first: neither can be undone here. */
  protected async confirmAction(action: 'unpublish' | 'discard-draft'): Promise<void> {
    const unpublish = action === 'unpublish';
    const confirmed = await this.confirm.ask({
      title: this.t(unpublish ? 'content.edit.unpublishTitle' : 'content.edit.discardTitle'),
      description: this.t(unpublish ? 'content.edit.unpublishHint' : 'content.edit.discardHint'),
      confirm: this.t(unpublish ? 'content.edit.unpublish' : 'content.edit.discard'),
      destructive: true,
    });
    if (confirmed) await this.action(action);
  }

  protected async action(action: 'unpublish' | 'discard-draft'): Promise<void> {
    const type = this.type();
    const locale = this.locale();
    const id = this.documentId();
    if (!id) return;
    this.busy.set(true);
    try {
      if (action === 'unpublish') {
        await this.documents.unpublish(type.uid, id, locale);
        this.published.set(false);
        void this.refreshVersions();
        toast.success(this.t('content.edit.toast.unpublished'));
      } else {
        await this.documents.discardDraft(type.uid, id, locale);
        const draft = await this.documents.get(type.uid, id, { populate: '*', locale });
        this.model.set(toModel(type.attributes, draft, (uid) => this.schema.component(uid)));
        this.showMorphs(draft);
        this.aiChanges.set(null);
        // The form shows the published version again: nothing is left unsaved.
        this.documentForm().reset();
        this.remoteChange.set(null);
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
    const id = this.documentId();
    if (!id) return;
    try {
      await this.documents.delete(type.uid, id, this.locale());
      toast.success(this.t('content.edit.toast.deleted'));
      // The entry is gone: its unsaved edits with it.
      this.leave(() =>
        this.router.navigate(type.kind === 'singleType' ? ['/'] : ['/content', type.uid]),
      );
    } catch (error) {
      this.fail(error, this.t('content.edit.error.delete'));
    }
  }

  /** A fresh preview URL of the draft (a new token each time); `null` after a toast. */
  private async previewLink(): Promise<string | null> {
    const id = this.documentId();
    if (!id) return null;
    try {
      const preview = await this.documents.preview(this.type().uid, id, this.locale());
      const url = frameableUrl(preview.url);
      if (!url)
        toast.error(this.t('content.preview.error'), {
          description: this.t('content.preview.notHttp'),
        });
      return url;
    } catch (error) {
      const failure = ApiFailure.from(error);
      toast.error(this.t('content.preview.error'), {
        description:
          failure.status === 404 ? this.t('content.preview.notConfigured') : failure.message,
      });
      return null;
    }
  }

  /** Opens the draft on the site, with a fresh preview token, in a new tab. */
  protected async openPreview(): Promise<void> {
    if (this.previewing()) return;
    this.previewing.set(true);
    try {
      const url = await this.previewLink();
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    } finally {
      this.previewing.set(false);
    }
  }

  protected async toggleSideBySide(): Promise<void> {
    if (this.sideBySide()) {
      this.sideBySide.set(false);
      return;
    }
    if (await this.refreshPreview()) this.sideBySide.set(true);
  }

  /** Loads the preview frame again, with a fresh URL. */
  protected async refreshPreview(): Promise<boolean> {
    if (this.previewLoading()) return false;
    this.previewLoading.set(true);
    try {
      const url = await this.previewLink();
      if (!url) return false;
      this.previewUrl.set(url);
      this.previewVersion.update((version) => version + 1);
      return true;
    } finally {
      this.previewLoading.set(false);
    }
  }

  protected configureView(): void {
    void this.router.navigate(['/content', this.type().uid, 'configure-view'], {
      queryParams: { from: this.router.url },
    });
  }

  protected async duplicate(): Promise<void> {
    const id = this.documentId();
    if (!id || this.busy()) return;
    this.busy.set(true);
    try {
      await this.duplicates.duplicate(this.type().uid, id, this.locale(), humanize);
    } finally {
      this.busy.set(false);
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
