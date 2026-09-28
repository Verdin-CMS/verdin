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
import { FieldTree, FormRoot, form, submit } from '@angular/forms/signals';
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

import { AiActions, aiErrorMessage } from '../../core/ai';
import { Api, ApiFailure, Issue, toQuery } from '../../core/api';
import { Auth } from '../../core/auth';
import { allowedLocale } from '../../core/permissions';
import { EntryDuplicates } from '../../core/duplicate';
import { EditView, EditViews } from '../../core/edit-view';
import {
  ContentLocales,
  LocaleState,
  LocaleVersion,
  isLocalized,
  localeState,
} from '../../core/content-locales';
import { Engagement } from '../../core/engagement';
import { Unseen } from '../../core/unseen';
import { previewTemplate } from '../../core/feature-settings';
import { EntryReview as EntryReviewState, pendingPublishStage } from '../../core/review';
import { fieldLabel } from '../../core/comments';
import { Features } from '../../core/features';
import { EntryPresence } from '../../core/presence';
import { Realtime } from '../../core/realtime';
import { I18n } from '../../core/i18n/i18n';
import { isMorphOwner } from '../../core/morph';
import { Schema } from '../../core/schema';
import { ContentType, Document, MediaFile } from '../../core/types';
import { UsageProbe, Usages } from '../../core/usage';
import { PageHeader } from '../../shared/components/page-header';
import { UsageWarning } from '../../shared/components/usage';
import { VoteControl } from '../../shared/components/vote-control';
import { CollabSheet } from './collab/collab-sheet';
import { EntryCollab } from './collab/entry-collab';
import { PresenceAvatars } from './collab/presence-avatars';
import { EntryReleases } from './entry-releases';
import { EntryUsage } from './entry-usage';
import { EntryReview } from './entry-review';
import { FieldsComponent, humanize } from './fields/fields';
import {
  FormModel,
  References,
  MorphEntry,
  mediaFilesOf,
  mergeMorphEntries,
  morphEntriesOf,
  referencesOf,
  relationLabelsOf,
  toModel,
  toPayload,
  withoutPasswords,
} from './fields/model';
import { RelatedEditor } from './fields/related-editor';
import { applyRules } from './fields/rules';
import { fillFromLocale, prefillShared, sharedFields } from './locale-model';
import { PreviewPane, SPLIT_DEFAULT, frameableUrl, splitAfterKey, splitAt } from './preview-pane';
import { RelatedEntrySheet } from './related-entry-sheet';
import { mergeTranslation, translatableFields } from './ai-model';
import {
  EditTarget,
  findFieldElement,
  resolveFieldPath,
  revealField,
  validFieldPath,
} from './visual-editing';

type Tree = FieldTree<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

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

/** The editable form of one document; recreated per document by `ContentEdit`. */
@Component({
  selector: 'vd-document-form',
  imports: [
    VoteControl,
    EntryReleases,
    EntryReview,
    EntryUsage,
    UsageWarning,
    FormRoot,
    RouterLink,
    NgIcon,
    FieldsComponent,
    PageHeader,
    PreviewPane,
    RelatedEntrySheet,
    CollabSheet,
    PresenceAvatars,
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
  // Relation pickers open related entries in this editor's side sheet; comments, tasks and
  // presence follow the open entry.
  providers: [RelatedEditor, EntryCollab, EntryPresence],
  changeDetection: ChangeDetectionStrategy.OnPush,
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
                    @let readable = auth.canInLocale('content.read', type().uid, option.code);
                    <button
                      hlmDropdownMenuRadio
                      [checked]="option.code === current"
                      [disabled]="!readable"
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
          @if (documentId() && previewOn() && !missing()) {
            <button
              hlmBtn
              variant="ghost"
              type="button"
              [disabled]="previewing()"
              [attr.title]="t('content.preview.hint')"
              (click)="openPreview()"
            >
              @if (previewing()) {
                <hlm-spinner />
              } @else {
                <ng-icon name="lucideExternalLink" />
              }
              {{ t('content.preview.open') }}
            </button>
            <button
              hlmBtn
              variant="ghost"
              type="button"
              class="max-lg:hidden"
              [attr.aria-pressed]="sideBySide()"
              [disabled]="previewLoading()"
              (click)="toggleSideBySide()"
            >
              <ng-icon name="lucideColumns2" />
              {{ t('content.preview.sideBySide') }}
            </button>
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
          @if (collabOn()) {
            <button
              hlmBtn
              variant="ghost"
              type="button"
              [attr.aria-label]="
                collab.openThreads()
                  ? t('comments.openButtonCount', { count: collab.openThreads() })
                  : t('comments.openButton')
              "
              (click)="collab.open()"
            >
              <ng-icon name="lucideMessageSquare" />
              {{ t('comments.openButton') }}
              @if (collab.openThreads()) {
                <span hlmBadge variant="secondary" class="tabular-nums">{{
                  i18n.formatNumber(collab.openThreads())
                }}</span>
              }
            </button>
          }
          @if (canDuplicate() || canConfigure() || (canTranslate() && !missing())) {
            <button
              hlmBtn
              variant="ghost"
              size="icon"
              type="button"
              [disabled]="busy()"
              [attr.aria-label]="t('content.edit.moreActions')"
              [title]="t('content.edit.moreActions')"
              [hlmDropdownMenuTrigger]="moreMenu"
              align="end"
            >
              <ng-icon name="lucideEllipsis" />
            </button>
            <ng-template #moreMenu>
              <hlm-dropdown-menu class="w-64">
                @if (canTranslate() && !missing()) {
                  <button hlmDropdownMenuItem (triggered)="openTranslate()">
                    <ng-icon name="lucideSparkles" />
                    {{ t('ai.translate.action', { locale: locales.name(translateDefault()) }) }}
                  </button>
                }
                @if (canDuplicate()) {
                  <button hlmDropdownMenuItem (triggered)="duplicate()">
                    <ng-icon name="lucideCopyPlus" /> {{ t('content.duplicate.action') }}
                  </button>
                }
                @if (canConfigure()) {
                  <button hlmDropdownMenuItem (triggered)="configureView()">
                    <ng-icon name="lucideLayoutDashboard" /> {{ t('content.view.configure') }}
                  </button>
                }
              </hlm-dropdown-menu>
            </ng-template>
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
            <button
              hlmBtn
              type="button"
              [disabled]="busy() || !canSave()"
              [attr.title]="
                publishHold()
                  ? t('review.entry.publishRequires', { stage: publishHold()!.name })
                  : null
              "
              (click)="save(true)"
            >
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
            <div class="col-start-2 mt-2 flex flex-wrap gap-2">
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
              @if (canTranslate()) {
                <button
                  hlmBtn
                  variant="outline"
                  size="sm"
                  type="button"
                  [disabled]="busy() || translating()"
                  (click)="openTranslate()"
                >
                  <ng-icon name="lucideSparkles" />
                  {{ t('ai.translate.action', { locale: locales.name(translateDefault()) }) }}
                </button>
              }
            </div>
          }
        </div>
      }

      @if (aiChanges(); as changes) {
        <div hlmAlert role="status">
          <ng-icon hlmAlertIcon name="lucideSparkles" />
          <p hlmAlertTitle>
            {{
              t('ai.translate.reviewTitle', {
                count: changes.fields.length,
                locale: locales.name(changes.source),
              })
            }}
          </p>
          <div hlmAlertDescription class="flex flex-col gap-2">
            <p>{{ t('ai.translate.reviewHint') }}</p>
            <ul class="flex flex-wrap gap-1" [attr.aria-label]="t('ai.translate.changedFields')">
              @for (name of changes.fields; track name) {
                <li>
                  <button
                    hlmBtn
                    variant="secondary"
                    size="xs"
                    type="button"
                    (click)="focusField(name)"
                  >
                    {{ fieldLabel(name) }}
                  </button>
                </li>
              }
            </ul>
          </div>
          <div class="col-start-2 mt-2 flex flex-wrap gap-2">
            <button hlmBtn variant="outline" size="sm" type="button" (click)="undoTranslation()">
              <ng-icon name="lucideUndo2" /> {{ t('ai.translate.undo') }}
            </button>
            <button hlmBtn variant="ghost" size="sm" type="button" (click)="aiChanges.set(null)">
              <ng-icon name="lucideCheck" /> {{ t('ai.translate.keep') }}
            </button>
          </div>
        </div>
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
          <div hlmAlert>
            <ng-icon hlmAlertIcon name="lucideRefreshCw" />
            <p hlmAlertTitle>
              {{
                change === 'entry.delete'
                  ? t('presence.remote.deleted')
                  : change === 'entry.publish'
                    ? t('presence.remote.published')
                    : change === 'entry.unpublish'
                      ? t('presence.remote.unpublished')
                      : t('presence.remote.updated')
              }}
            </p>
            <p hlmAlertDescription>
              {{
                change === 'entry.delete'
                  ? t('presence.remote.deletedHint')
                  : t('presence.remote.hint')
              }}
            </p>
            <div class="col-start-2 mt-2 flex flex-wrap gap-2">
              @if (change !== 'entry.delete') {
                <button hlmBtn variant="outline" size="sm" type="button" (click)="reload.emit()">
                  <ng-icon name="lucideRefreshCw" /> {{ t('presence.remote.reload') }}
                </button>
              }
              <button
                hlmBtn
                variant="ghost"
                size="sm"
                type="button"
                (click)="remoteChange.set(null)"
              >
                {{ t('presence.remote.dismiss') }}
              </button>
            </div>
          </div>
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

      <div
        #splitBox
        class="flex flex-col gap-6"
        [class.lg:grid]="sideBySide()"
        [class.lg:gap-0]="sideBySide()"
        [class.lg:items-start]="sideBySide()"
        [style.grid-template-columns]="sideBySide() ? splitColumns() : null"
      >
        <div class="grid min-w-0 items-start gap-6" [class.lg:grid-cols-3]="!sideBySide()">
          <form
            class="min-w-0"
            [class.lg:col-span-2]="!sideBySide()"
            [formRoot]="documentForm"
            (submit)="$event.preventDefault(); save(false)"
          >
            <section hlmCard>
              <div hlmCardContent>
                <vd-fields
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
                  prefix="doc"
                />
              </div>
            </section>
          </form>

          <aside
            class="flex flex-col gap-6"
            [class.lg:sticky]="!sideBySide()"
            [class.lg:top-6]="!sideBySide()"
          >
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

            @if (documentId() && !missing() && canDelete()) {
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
                      (click)="checkUsage()"
                    >
                      <ng-icon name="lucideTrash2" /> {{ t('common.delete') }}
                    </button>
                    <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx">
                      <hlm-alert-dialog-header>
                        <h2 hlmAlertDialogTitle>{{ t('content.edit.deleteTitle') }}</h2>
                        <p hlmAlertDialogDescription>{{ t('content.edit.deleteHint') }}</p>
                      </hlm-alert-dialog-header>
                      <vd-usage-warning [state]="deleteUsage.state()" />
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
        @if (sideBySide()) {
          <div
            role="separator"
            tabindex="0"
            aria-orientation="vertical"
            aria-controls="document-preview"
            [attr.aria-label]="t('content.preview.resize')"
            [attr.aria-valuenow]="split()"
            aria-valuemin="30"
            aria-valuemax="70"
            class="group hidden cursor-col-resize touch-none justify-center px-1.5 outline-none lg:sticky lg:top-6 lg:flex lg:h-[calc(100dvh-8rem)]"
            (pointerdown)="startResize($event, splitBox)"
            (pointermove)="resize($event, splitBox)"
            (pointerup)="stopResize($event)"
            (pointercancel)="stopResize($event)"
            (keydown)="resizeKey($event)"
          >
            <span
              class="bg-border group-hover:bg-primary/60 group-focus-visible:bg-primary group-focus-visible:ring-ring/50 h-full w-1 rounded-full transition-colors group-focus-visible:ring-3"
            ></span>
          </div>
          <vd-preview-pane
            id="document-preview"
            class="h-[70dvh] lg:sticky lg:top-6 lg:h-[calc(100dvh-8rem)]"
            [url]="previewUrl()"
            [version]="previewVersion()"
            [title]="heading()"
            [loading]="previewLoading()"
            (reload)="refreshPreview()"
            (openTab)="openPreview()"
            (closed)="sideBySide.set(false)"
            (edit)="openFromPreview($event)"
          />
        }
      </div>
    </div>

    <vd-related-entry-sheet />
    @if (collabOn()) {
      <vd-collab-sheet [heading]="heading()" />
    }

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

    <hlm-dialog [state]="translateOpen() ? 'open' : 'closed'" (closed)="translateOpen.set(false)">
      <hlm-dialog-content
        *hlmDialogPortal="let ctx"
        class="sm:max-w-md"
        [closeLabel]="t('common.close')"
      >
        <hlm-dialog-header>
          <h2 hlmDialogTitle>{{ t('ai.translate.title') }}</h2>
          <p hlmDialogDescription>
            {{ t('ai.translate.description', { locale: locales.name(locale()) }) }}
          </p>
        </hlm-dialog-header>
        <div hlmField>
          <label hlmFieldLabel for="translate-source">{{ t('ai.translate.source') }}</label>
          <hlm-native-select
            selectId="translate-source"
            [value]="translateSource()"
            (valueChange)="translateSource.set($event ?? '')"
          >
            @for (code of fillSources(); track code) {
              <option hlmNativeSelectOption [value]="code">
                {{ locales.name(code) }} ({{ code }})
              </option>
            }
          </hlm-native-select>
          <p hlmFieldDescription>{{ t('ai.translate.sourceHint') }}</p>
        </div>
        @if (ai.status(); as status) {
          @if (status.model) {
            <p class="text-muted-foreground text-xs">
              {{ t('ai.poweredBy', { provider: status.provider ?? '', model: status.model }) }}
            </p>
          }
        }
        <hlm-dialog-footer>
          <button hlmBtn variant="outline" type="button" (click)="translateOpen.set(false)">
            {{ t('common.cancel') }}
          </button>
          <button
            hlmBtn
            type="button"
            [disabled]="!translateSource() || translating()"
            (click)="translate()"
          >
            @if (translating()) {
              <hlm-spinner />
            } @else {
              <ng-icon name="lucideLanguages" />
            }
            {{ translating() ? t('ai.translate.running') : t('ai.translate.run') }}
          </button>
        </hlm-dialog-footer>
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class DocumentForm implements OnInit {
  private readonly api = inject(Api);
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
  /** The form column's share, in percent. */
  protected readonly split = signal(SPLIT_DEFAULT);
  protected readonly splitColumns = computed(
    () => `minmax(0, ${this.split()}fr) auto minmax(0, ${100 - this.split()}fr)`,
  );
  private resizing = false;

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
        await this.api.get<LocaleVersion[]>(
          `/content/${this.type().uid}/${id}/locales`,
          withLocale('', this.locale()) || undefined,
        ),
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
      void this.router.navigate(
        other.kind === 'singleType'
          ? ['/single', other.uid]
          : ['/content', other.uid, target.documentId],
        {
          queryParams: {
            ...(target.locale ? { locale: target.locale } : {}),
            ...(target.field ? { field: target.field } : {}),
          },
        },
      );
    if (this.documentForm().dirty() || this.aiChanges()) {
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
        // Saved links, as populated: their current labels.
        this.morphs.update((current) =>
          mergeMorphEntries(current, this.morphEntries(document, true)),
        );
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
        this.showMorphs(draft);
        this.aiChanges.set(null);
        this.draftUpdatedAt.set(this.publishedUpdatedAt());
        toast.success(this.t('content.edit.toast.discarded'));
      }
    } catch (error) {
      this.fail(error, this.t('content.edit.error.action'));
    } finally {
      this.busy.set(false);
    }
  }

  /** Where the entry is used, for the delete confirmation. */
  protected readonly deleteUsage = new UsageProbe();
  private readonly usages = inject(Usages);

  protected checkUsage(): void {
    const uid = this.type().uid;
    const documentId = this.documentId();
    if (!documentId) return;
    // References from the entry itself go with it.
    void this.deleteUsage.start(async () => {
      const result = await this.usages.forEntry(uid, documentId, this.locale());
      return {
        ...result,
        data: result.data.filter((usage) => usage.uid !== uid || usage.documentId !== documentId),
      };
    });
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

  /** A fresh preview URL of the draft (a new token each time); `null` after a toast. */
  private async previewLink(): Promise<string | null> {
    const id = this.documentId();
    if (!id) return null;
    try {
      const preview = await this.api.get<{ url: string }>(
        `/content/${this.type().uid}/${id}/preview`,
        withLocale('', this.locale()) || undefined,
      );
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

  protected startResize(event: PointerEvent, container: HTMLElement): void {
    if (event.button !== 0) return;
    this.resizing = true;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    event.preventDefault();
    this.resize(event, container);
  }

  protected resize(event: PointerEvent, container: HTMLElement): void {
    if (!this.resizing) return;
    const rect = container.getBoundingClientRect();
    this.split.set(splitAt(event.clientX, rect.left, rect.right, this.i18n.direction() === 'rtl'));
  }

  protected stopResize(event: PointerEvent): void {
    this.resizing = false;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
  }

  protected resizeKey(event: KeyboardEvent): void {
    const next = splitAfterKey(this.split(), event.key, this.i18n.direction() === 'rtl');
    if (next === null) return;
    event.preventDefault();
    this.split.set(next);
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
          [view]="view()"
          [focus]="field() ?? null"
          (reload)="reload()"
        />
      }
    }
  `,
})
export class ContentEdit {
  private readonly api = inject(Api);
  private readonly engagement = inject(Engagement);
  private readonly unseen = inject(Unseen);
  private readonly schema = inject(Schema);
  private readonly locales = inject(ContentLocales);
  private readonly auth = inject(Auth);
  private readonly views = inject(EditViews);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;

  readonly uid = input.required<string>();
  readonly documentId = input<string>();
  /** `?locale=` (localized types; the default locale otherwise). */
  readonly locale = input<string>();
  /** `?field=`: a field to scroll to (links from the visual editing overlay). */
  readonly field = input<string>();

  protected readonly type = computed(() => this.schema.type(this.uid()));
  protected readonly document = signal<Document | null>(null);
  protected readonly publishedAt = signal<string | null>(null);
  protected readonly activeLocale = signal<string | null>(null);
  protected readonly versions = signal<LocaleVersion[]>([]);
  protected readonly existingId = signal<string | null>(null);
  protected readonly sharedSource = signal<Document | null>(null);
  protected readonly view = signal<EditView | null>(null);
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

  /** Loads the entry again, with a fresh form (another admin changed it). */
  protected reload(): void {
    const key = `${this.uid()}|${this.documentId() ?? ''}|${this.locale() ?? ''}`;
    void this.load(`${key}|${++this.reloads}`);
  }

  private reloads = 0;

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
    // The edit view loads alongside; the default layout shows when there is none.
    const view = this.views.get(uid).catch(() => null);
    try {
      let locale: string | null = null;
      if (isLocalized(type)) {
        await this.locales.load();
        locale = this.locales.resolve(this.locale());
        // Without `?locale=`, an admin limited to some locales opens one of them.
        if (!this.locale()) {
          const codes = (this.locales.list() ?? []).map((item) => item.code);
          locale = allowedLocale(this.auth.permissions(), 'content.read', uid, codes, locale);
        }
      }
      if (request !== this.requests) return;
      this.activeLocale.set(locale);
      let documentId = this.documentId() ?? null;
      if (type.kind === 'singleType') documentId = await this.singleDocument(uid, locale);
      if (documentId && locale) {
        // An admin limited to some locales may not list the versions: the document is then
        // loaded in `locale` directly (a 404 there means it has no such version).
        const versions = await this.api
          .get<LocaleVersion[]>(
            `/content/${uid}/${documentId}/locales`,
            withLocale('', locale) || undefined,
          )
          .catch((error: unknown) => {
            if (ApiFailure.from(error).status === 403) return null;
            throw error;
          });
        this.versions.set(versions ?? []);
        if (versions && localeState(versions, locale) === 'missing') {
          // A new locale of an existing document: its shared fields come from another one.
          if (!versions.length) throw new ApiFailure(404, 'NotFoundError', 'Not Found');
          // Only versions the admin may read (permissions may be limited to some locales).
          const readable = versions.filter((version) =>
            this.auth.canInLocale('content.read', uid, version.locale),
          );
          const source =
            readable.find((version) => version.locale === this.locales.defaultCode()) ??
            readable[0];
          if (source) {
            this.sharedSource.set(
              await this.api.get<Document>(
                `/content/${uid}/${documentId}`,
                withLocale(source.draft ? 'populate=*&status=draft' : 'populate=*', source.locale),
              ),
            );
          }
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
        this.engagement
          .view(uid, documentId)
          .then(() => this.unseen.refresh())
          .catch(() => undefined);
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
      this.view.set(await view);
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
      if (other.code === locale || !this.auth.canInLocale('content.read', uid, other.code))
        continue;
      const id = await first(other.code);
      if (id) return id;
    }
    return null;
  }
}
