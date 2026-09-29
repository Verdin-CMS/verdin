import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList } from '@angular/cdk/drag-drop';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  resource,
  signal,
  untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCheckboxImports } from '@spartan-ng/helm/checkbox';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { HlmSwitchImports } from '@spartan-ng/helm/switch';
import { HlmTableImports } from '@spartan-ng/helm/table';
import { HlmTabsImports } from '@spartan-ng/helm/tabs';
import { HlmTextareaImports } from '@spartan-ng/helm/textarea';

import { ApiFailure, RUNTIME_CONFIG } from '../../core/api';
import {
  FieldDraft,
  FieldProblem,
  FormProblem,
  MAX_FORM_FIELDS,
  TEXT_TYPES,
  cellText,
  emailList,
  fieldName,
  fieldProblems,
  formInput,
  formProblems,
  invalidEmails,
  newField,
  optionList,
  reorder,
  submissionSnippet,
  toDraft,
} from '../../core/form-builder';
import { I18n } from '../../core/i18n/i18n';
import { MessageKey } from '../../core/i18n/keys';
import { loadErrorOf } from '../../core/loading';
import {
  FORM_FIELD_TYPES,
  FormField,
  FormFieldType,
  Site,
  Submission,
  saveBlob,
  slugify,
} from '../../core/site';
import { PageTitle } from '../../core/title';
import { PageMeta } from '../../core/types';
import { PageHeader } from '../../shared/components/page-header';
import { SiteAccessNotice, siteAccess } from './site-access';

type Tab = 'fields' | 'settings' | 'submissions' | 'integration';

const TYPE_LABELS: Record<FormFieldType, MessageKey> = {
  text: 'forms.type.text',
  email: 'forms.type.email',
  textarea: 'forms.type.textarea',
  number: 'forms.type.number',
  select: 'forms.type.select',
  checkbox: 'forms.type.checkbox',
  date: 'forms.type.date',
  url: 'forms.type.url',
  tel: 'forms.type.tel',
};

const FIELD_PROBLEMS: Record<FieldProblem, MessageKey> = {
  name: 'forms.problem.name',
  nameReserved: 'forms.problem.nameReserved',
  nameDuplicate: 'forms.problem.nameDuplicate',
  label: 'forms.problem.label',
  options: 'forms.problem.options',
  maxLength: 'forms.problem.maxLength',
};

const FORM_PROBLEMS: Record<FormProblem, MessageKey> = {
  name: 'forms.problem.formName',
  slug: 'forms.problem.slug',
  noFields: 'forms.problem.noFields',
  tooManyFields: 'forms.problem.tooManyFields',
  emails: 'forms.problem.emails',
};

const PAGE_SIZE = 25;

/** Settings → Forms → one form: its fields, settings, submissions and endpoint. */
@Component({
  selector: 'vd-form-edit',
  imports: [
    NgIcon,
    RouterLink,
    CdkDropList,
    CdkDrag,
    CdkDragHandle,
    SiteAccessNotice,
    HlmAlertImports,
    HlmAlertDialogImports,
    HlmButtonImports,
    HlmCheckboxImports,
    HlmEmptyImports,
    HlmFieldImports,
    HlmInputImports,
    HlmNativeSelectImports,
    HlmSkeletonImports,
    HlmSpinnerImports,
    HlmSwitchImports,
    HlmTableImports,
    HlmTabsImports,
    HlmTextareaImports,
    PageHeader,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-6">
      <a
        routerLink="/settings/forms"
        class="text-muted-foreground hover:text-foreground flex w-fit items-center gap-1.5 text-sm"
      >
        <ng-icon name="lucideArrowLeft" class="rtl:-scale-x-100" /> {{ t('forms.back') }}
      </a>
      <vd-page-header
        [title]="isNew() ? t('forms.newTitle') : name() || t('forms.untitled')"
        [description]="t('forms.editorHint')"
      >
        @if (access() === 'ok' && loaded()) {
          <div actions>
            <button hlmBtn data-form-save [disabled]="saving()" (click)="save()">
              @if (saving()) {
                <hlm-spinner class="size-4" />
              } @else {
                <ng-icon name="lucideSave" />
              }
              {{ t('common.save') }}
            </button>
          </div>
        }
      </vd-page-header>

      @if (access() !== 'ok') {
        <vd-site-access [access]="access()" feature="forms" />
      } @else if (loadError()) {
        <p class="text-destructive text-sm" role="alert">{{ loadError() }}</p>
      } @else if (!loaded()) {
        <hlm-skeleton class="h-64 rounded-xl" />
      } @else {
        <div class="grid gap-4 sm:grid-cols-2">
          <div hlmField [attr.data-invalid]="showErrors() && hasFormProblem('name') ? true : null">
            <label hlmFieldLabel for="form-name">{{ t('common.name') }}</label>
            <input
              hlmInput
              id="form-name"
              autocomplete="off"
              maxlength="255"
              [placeholder]="t('forms.namePlaceholder')"
              [value]="name()"
              (input)="setName($any($event.target).value)"
            />
          </div>
          <div hlmField [attr.data-invalid]="showErrors() && hasFormProblem('slug') ? true : null">
            <label hlmFieldLabel for="form-slug">{{ t('forms.slug') }}</label>
            <input
              hlmInput
              dir="ltr"
              id="form-slug"
              autocomplete="off"
              spellcheck="false"
              class="font-mono text-xs"
              placeholder="contact"
              aria-describedby="form-slug-hint"
              [value]="slug()"
              (input)="setSlug($any($event.target).value)"
            />
            <p id="form-slug-hint" class="text-muted-foreground text-xs">
              {{ t('forms.slugHint') }}
            </p>
          </div>
        </div>

        @if (showErrors() && (formErrors().length || fieldErrorCount())) {
          <div hlmAlert variant="destructive" role="alert">
            <ng-icon hlmAlertIcon name="lucideCircleAlert" />
            <p hlmAlertTitle>{{ t('forms.fixProblems') }}</p>
            <ul hlmAlertDescription class="list-disc ps-4">
              @for (problem of formErrors(); track problem) {
                <li>{{ t(formProblemLabels[problem], { max: maxFields }) }}</li>
              }
              @if (fieldErrorCount()) {
                <li>{{ t('forms.problem.fields', { count: fieldErrorCount() }) }}</li>
              }
            </ul>
          </div>
        }
        @if (saveError()) {
          <div hlmAlert variant="destructive" role="alert">
            <ng-icon hlmAlertIcon name="lucideCircleAlert" />
            <p hlmAlertTitle>{{ t('forms.saveFailed') }}</p>
            <p hlmAlertDescription>{{ saveError() }}</p>
          </div>
        }

        <hlm-tabs [tab]="tab()" (tabActivated)="setTab($any($event))">
          <hlm-tabs-list [attr.aria-label]="t('forms.sections')">
            <button hlmTabsTrigger="fields">
              <ng-icon name="lucideList" /> {{ t('forms.tab.fields') }}
            </button>
            <button hlmTabsTrigger="settings">
              <ng-icon name="lucideSettings2" /> {{ t('forms.tab.settings') }}
            </button>
            <button hlmTabsTrigger="submissions" [disabled]="isNew()">
              <ng-icon name="lucideInbox" /> {{ t('forms.tab.submissions') }}
            </button>
            <button hlmTabsTrigger="integration" [disabled]="isNew()">
              <ng-icon name="lucideCode" /> {{ t('forms.tab.integration') }}
            </button>
          </hlm-tabs-list>

          <div hlmTabsContent="fields" class="pt-4">
            <div class="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <section class="flex flex-col gap-3" aria-labelledby="form-fields-title">
                <div class="flex items-center gap-2">
                  <h2 id="form-fields-title" class="font-medium">{{ t('forms.fieldsTitle') }}</h2>
                  <span class="text-muted-foreground text-xs">{{
                    t('forms.fieldStats', { count: fields().length, max: maxFields })
                  }}</span>
                  <button
                    hlmBtn
                    size="sm"
                    variant="outline"
                    class="ms-auto"
                    [disabled]="fields().length >= maxFields"
                    (click)="addField()"
                  >
                    <ng-icon name="lucidePlus" /> {{ t('forms.addField') }}
                  </button>
                </div>
                @if (fields().length === 0) {
                  <div hlmEmpty class="rounded-xl border border-dashed py-10">
                    <div hlmEmptyHeader>
                      <div hlmEmptyMedia variant="icon"><ng-icon name="lucideClipboardList" /></div>
                      <h3 hlmEmptyTitle>{{ t('forms.noFields') }}</h3>
                      <p hlmEmptyDescription>{{ t('forms.noFieldsHint') }}</p>
                    </div>
                  </div>
                } @else {
                  <ol
                    class="flex flex-col gap-3"
                    cdkDropList
                    cdkDropListLockAxis="y"
                    [attr.aria-label]="t('forms.fieldsTitle')"
                    (cdkDropListDropped)="drop($event)"
                  >
                    @for (field of fields(); track field.key; let index = $index) {
                      @let id = 'field-' + field.key;
                      @let problems = showErrors() ? (fieldIssues().get(field.key) ?? []) : [];
                      @let title = field.label || t('forms.untitledField');
                      <li
                        cdkDrag
                        class="bg-card flex flex-col gap-3 rounded-xl border p-4"
                        [class.border-destructive]="problems.length"
                        data-form-field
                      >
                        <div class="flex items-center gap-1">
                          <button
                            cdkDragHandle
                            type="button"
                            class="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex cursor-grab items-center rounded-sm p-1 outline-none focus-visible:ring-[3px]"
                            [attr.data-field-handle]="field.key"
                            [attr.aria-label]="t('forms.handle', { label: title })"
                            (keydown.alt.arrowUp)="$event.preventDefault(); moveField(index, -1)"
                            (keydown.alt.arrowDown)="$event.preventDefault(); moveField(index, 1)"
                          >
                            <ng-icon name="lucideGripVertical" size="14" />
                          </button>
                          <span class="min-w-0 flex-1 truncate text-sm font-medium">{{
                            title
                          }}</span>
                          <button
                            hlmBtn
                            size="icon-xs"
                            variant="ghost"
                            type="button"
                            [disabled]="index === 0"
                            [attr.aria-label]="t('forms.moveUp', { label: title })"
                            (click)="moveField(index, -1)"
                          >
                            <ng-icon name="lucideArrowUp" />
                          </button>
                          <button
                            hlmBtn
                            size="icon-xs"
                            variant="ghost"
                            type="button"
                            [disabled]="index === fields().length - 1"
                            [attr.aria-label]="t('forms.moveDown', { label: title })"
                            (click)="moveField(index, 1)"
                          >
                            <ng-icon name="lucideArrowDown" />
                          </button>
                          <button
                            hlmBtn
                            size="icon-xs"
                            variant="ghost"
                            type="button"
                            class="hover:text-destructive"
                            [attr.aria-label]="t('forms.removeField', { label: title })"
                            (click)="removeField(index)"
                          >
                            <ng-icon name="lucideTrash2" />
                          </button>
                        </div>
                        <div class="grid gap-3 sm:grid-cols-2">
                          <div
                            hlmField
                            [attr.data-invalid]="problems.includes('label') ? true : null"
                          >
                            <label hlmFieldLabel [for]="id + '-label'">{{
                              t('forms.label')
                            }}</label>
                            <input
                              hlmInput
                              autocomplete="off"
                              [id]="id + '-label'"
                              [attr.aria-invalid]="problems.includes('label') ? true : null"
                              [value]="field.label"
                              (input)="setLabel(field.key, $any($event.target).value)"
                            />
                          </div>
                          <div hlmField [attr.data-invalid]="nameProblem(problems) ? true : null">
                            <label hlmFieldLabel [for]="id + '-name'">{{
                              t('forms.fieldName')
                            }}</label>
                            <input
                              hlmInput
                              dir="ltr"
                              autocomplete="off"
                              spellcheck="false"
                              class="font-mono text-xs"
                              maxlength="64"
                              [id]="id + '-name'"
                              [attr.aria-invalid]="nameProblem(problems) ? true : null"
                              [value]="field.name"
                              (input)="
                                patchField(field.key, {
                                  name: $any($event.target).value,
                                  nameTouched: true,
                                })
                              "
                            />
                          </div>
                          <div hlmField>
                            <label hlmFieldLabel [for]="id + '-type'">{{
                              t('forms.fieldType')
                            }}</label>
                            <hlm-native-select
                              [selectId]="id + '-type'"
                              [value]="field.type"
                              (valueChange)="patchField(field.key, { type: $any($event) })"
                            >
                              @for (type of types; track type) {
                                <option hlmNativeSelectOption [value]="type">
                                  {{ t(typeLabels[type]) }}
                                </option>
                              }
                            </hlm-native-select>
                          </div>
                          <div class="flex items-end pb-2">
                            <label class="flex items-center gap-2 text-sm">
                              <hlm-checkbox
                                [inputId]="id + '-required'"
                                [checked]="field.required"
                                (checkedChange)="
                                  patchField(field.key, { required: $event === true })
                                "
                              />
                              {{ t('forms.required') }}
                            </label>
                          </div>
                          @if (isText(field.type)) {
                            <div hlmField>
                              <label hlmFieldLabel [for]="id + '-placeholder'">{{
                                t('forms.placeholder')
                              }}</label>
                              <input
                                hlmInput
                                autocomplete="off"
                                [id]="id + '-placeholder'"
                                [value]="field.placeholder"
                                (input)="
                                  patchField(field.key, { placeholder: $any($event.target).value })
                                "
                              />
                            </div>
                            <div
                              hlmField
                              [attr.data-invalid]="problems.includes('maxLength') ? true : null"
                            >
                              <label hlmFieldLabel [for]="id + '-max'">{{
                                t('forms.maxLength')
                              }}</label>
                              <input
                                hlmInput
                                type="number"
                                inputmode="numeric"
                                min="1"
                                max="20000"
                                [id]="id + '-max'"
                                [attr.aria-invalid]="problems.includes('maxLength') ? true : null"
                                [value]="field.maxLength"
                                (input)="
                                  patchField(field.key, { maxLength: $any($event.target).value })
                                "
                              />
                            </div>
                          }
                          @if (field.type === 'select') {
                            <div
                              hlmField
                              class="sm:col-span-2"
                              [attr.data-invalid]="problems.includes('options') ? true : null"
                            >
                              <label hlmFieldLabel [for]="id + '-options'">{{
                                t('forms.options')
                              }}</label>
                              <textarea
                                hlmTextarea
                                rows="3"
                                [id]="id + '-options'"
                                [attr.aria-describedby]="id + '-options-hint'"
                                [attr.aria-invalid]="problems.includes('options') ? true : null"
                                [value]="field.options"
                                (input)="
                                  patchField(field.key, { options: $any($event.target).value })
                                "
                              ></textarea>
                              <p class="text-muted-foreground text-xs" [id]="id + '-options-hint'">
                                {{ t('forms.optionsHint') }}
                              </p>
                            </div>
                          }
                        </div>
                        @if (problems.length) {
                          <ul class="text-destructive text-xs" role="alert">
                            @for (problem of problems; track problem) {
                              <li>{{ t(fieldProblemLabels[problem]) }}</li>
                            }
                          </ul>
                        }
                      </li>
                    }
                  </ol>
                }
                <p class="sr-only" aria-live="polite">{{ announcement() }}</p>
              </section>

              <section
                class="bg-muted/30 flex h-fit flex-col gap-4 rounded-xl border p-4 lg:sticky lg:top-20"
                aria-labelledby="form-preview-title"
              >
                <div class="flex flex-col gap-0.5">
                  <h2 id="form-preview-title" class="font-medium">{{ t('forms.preview') }}</h2>
                  <p class="text-muted-foreground text-xs">{{ t('forms.previewHint') }}</p>
                </div>
                <form class="flex flex-col gap-3" inert aria-hidden="true">
                  @for (field of fields(); track field.key) {
                    @let pid = 'preview-' + field.key;
                    @if (field.type === 'checkbox') {
                      <label class="flex items-center gap-2 text-sm">
                        <input type="checkbox" class="size-4" />
                        {{ field.label || t('forms.untitledField') }}
                        @if (field.required) {
                          <span class="text-destructive">*</span>
                        }
                      </label>
                    } @else {
                      <div class="flex flex-col gap-1.5">
                        <span class="text-sm font-medium">
                          {{ field.label || t('forms.untitledField') }}
                          @if (field.required) {
                            <span class="text-destructive">*</span>
                          }
                        </span>
                        @if (field.type === 'textarea') {
                          <textarea
                            hlmTextarea
                            rows="3"
                            [placeholder]="field.placeholder"
                          ></textarea>
                        } @else if (field.type === 'select') {
                          <hlm-native-select [selectId]="pid">
                            @for (option of options(field.options); track option) {
                              <option hlmNativeSelectOption [value]="option">{{ option }}</option>
                            }
                          </hlm-native-select>
                        } @else {
                          <input hlmInput [type]="field.type" [placeholder]="field.placeholder" />
                        }
                      </div>
                    }
                  } @empty {
                    <p class="text-muted-foreground text-sm">{{ t('forms.noFields') }}</p>
                  }
                  @if (fields().length) {
                    <button hlmBtn type="button" class="self-start">{{ t('forms.submit') }}</button>
                  }
                </form>
              </section>
            </div>
          </div>

          <div hlmTabsContent="settings" class="pt-4">
            <div class="flex max-w-2xl flex-col gap-5">
              <div hlmField [attr.data-invalid]="badEmails().length ? true : null">
                <label hlmFieldLabel for="form-notify">{{ t('forms.notifyEmails') }}</label>
                <textarea
                  hlmTextarea
                  dir="ltr"
                  id="form-notify"
                  rows="2"
                  placeholder="team@example.com"
                  aria-describedby="form-notify-hint"
                  [attr.aria-invalid]="badEmails().length ? true : null"
                  [value]="notifyEmails()"
                  (input)="notifyEmails.set($any($event.target).value)"
                ></textarea>
                <p id="form-notify-hint" class="text-muted-foreground text-xs">
                  {{ t('forms.notifyHint') }}
                </p>
                @if (badEmails().length) {
                  <hlm-field-error forceShow>{{
                    t('forms.problem.badEmails', { emails: badEmails().join(', ') })
                  }}</hlm-field-error>
                }
              </div>
              <div hlmField>
                <label hlmFieldLabel for="form-success">{{ t('forms.successMessage') }}</label>
                <textarea
                  hlmTextarea
                  id="form-success"
                  rows="2"
                  aria-describedby="form-success-hint"
                  [placeholder]="t('forms.successPlaceholder')"
                  [value]="successMessage()"
                  (input)="successMessage.set($any($event.target).value)"
                ></textarea>
                <p id="form-success-hint" class="text-muted-foreground text-xs">
                  {{ t('forms.successHint') }}
                </p>
              </div>
              <label class="flex items-start gap-3">
                <hlm-switch
                  [aria-label]="t('forms.honeypot')"
                  [checked]="honeypot()"
                  (checkedChange)="honeypot.set($event)"
                />
                <span class="flex flex-col">
                  <span class="text-sm font-medium">{{ t('forms.honeypot') }}</span>
                  <span class="text-muted-foreground text-xs">{{ t('forms.honeypotHint') }}</span>
                </span>
              </label>
            </div>
          </div>

          <div hlmTabsContent="submissions" class="pt-4">
            <section class="bg-card overflow-hidden rounded-xl border">
              <header class="flex flex-wrap items-center gap-2 border-b px-4 py-3">
                <h2 class="font-medium">{{ t('forms.submissions') }}</h2>
                <span class="text-muted-foreground text-xs">{{
                  t('forms.submissionCount', { count: meta().total ?? 0 })
                }}</span>
                <div class="ms-auto flex gap-2">
                  <button
                    hlmBtn
                    size="sm"
                    variant="outline"
                    [disabled]="submissionsLoading()"
                    (click)="loadSubmissions()"
                  >
                    <ng-icon name="lucideRefreshCw" /> {{ t('forms.refresh') }}
                  </button>
                  <button
                    hlmBtn
                    size="sm"
                    variant="outline"
                    [disabled]="exporting() || !(meta().total ?? 0)"
                    (click)="exportCsv()"
                  >
                    @if (exporting()) {
                      <hlm-spinner class="size-4" />
                    } @else {
                      <ng-icon name="lucideDownload" />
                    }
                    {{ t('forms.exportCsv') }}
                  </button>
                </div>
              </header>
              @if (submissions().length === 0) {
                <p class="text-muted-foreground px-4 py-10 text-center text-sm">
                  @if (submissionsLoading()) {
                    {{ t('common.loading') }}
                  } @else {
                    {{ t('forms.noSubmissions') }}
                  }
                </p>
              } @else {
                <div hlmTableContainer>
                  <table hlmTable>
                    <thead hlmTHead class="bg-muted/50">
                      <tr hlmTr class="hover:bg-transparent">
                        <th hlmTh class="ps-4">{{ t('forms.received') }}</th>
                        @for (column of savedFields(); track column.name) {
                          <th hlmTh>{{ column.label }}</th>
                        }
                        <th hlmTh class="pe-4">
                          <span class="sr-only">{{ t('common.actions') }}</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody hlmTBody>
                      @for (submission of submissions(); track submission.id) {
                        <tr hlmTr data-submission>
                          <td hlmTd class="ps-4 whitespace-nowrap">
                            <span [attr.title]="i18n.formatDate(submission.createdAt, 'long')">{{
                              i18n.formatDate(submission.createdAt)
                            }}</span>
                          </td>
                          @for (column of savedFields(); track column.name) {
                            <td hlmTd>
                              <span class="line-clamp-2 max-w-xs text-sm break-words">{{
                                cell(submission, column)
                              }}</span>
                            </td>
                          }
                          <td hlmTd class="pe-4">
                            <div class="flex justify-end">
                              <hlm-alert-dialog>
                                <button
                                  hlmAlertDialogTrigger
                                  hlmBtn
                                  size="icon-sm"
                                  variant="ghost"
                                  class="text-muted-foreground hover:text-destructive"
                                  [attr.aria-label]="
                                    t('forms.deleteSubmission', { id: submission.id })
                                  "
                                  [attr.title]="t('common.delete')"
                                >
                                  <ng-icon name="lucideTrash2" />
                                </button>
                                <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx">
                                  <hlm-alert-dialog-header>
                                    <h2 hlmAlertDialogTitle>
                                      {{ t('forms.deleteSubmissionTitle') }}
                                    </h2>
                                    <p hlmAlertDialogDescription>
                                      {{ t('forms.deleteSubmissionHint') }}
                                    </p>
                                  </hlm-alert-dialog-header>
                                  <hlm-alert-dialog-footer>
                                    <button hlmAlertDialogCancel (click)="ctx.close()">
                                      {{ t('common.cancel') }}
                                    </button>
                                    <button
                                      hlmAlertDialogAction
                                      variant="destructive"
                                      (click)="ctx.close(); removeSubmission(submission)"
                                    >
                                      {{ t('common.delete') }}
                                    </button>
                                  </hlm-alert-dialog-footer>
                                </hlm-alert-dialog-content>
                              </hlm-alert-dialog>
                            </div>
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
                @if (pageCount() > 1) {
                  <nav
                    class="flex flex-wrap items-center justify-end gap-2 border-t px-4 py-3"
                    [attr.aria-label]="t('forms.pagination')"
                  >
                    <span class="text-muted-foreground me-auto text-sm tabular-nums">
                      {{ t('common.page', { page: page(), count: pageCount() }) }}
                    </span>
                    <button
                      hlmBtn
                      variant="outline"
                      size="sm"
                      [disabled]="page() <= 1 || submissionsLoading()"
                      (click)="goTo(page() - 1)"
                    >
                      <ng-icon name="lucideArrowLeft" class="rtl:-scale-x-100" />
                      {{ t('common.previous') }}
                    </button>
                    <button
                      hlmBtn
                      variant="outline"
                      size="sm"
                      [disabled]="page() >= pageCount() || submissionsLoading()"
                      (click)="goTo(page() + 1)"
                    >
                      {{ t('common.next') }}
                      <ng-icon name="lucideChevronRight" class="rtl:-scale-x-100" />
                    </button>
                  </nav>
                }
              }
            </section>
          </div>

          <div hlmTabsContent="integration" class="pt-4">
            <div class="flex max-w-3xl flex-col gap-4">
              <div class="flex flex-col gap-1.5">
                <span class="text-sm font-medium" id="form-endpoint-label">{{
                  t('forms.endpoint')
                }}</span>
                <div class="flex items-center gap-1">
                  <code
                    dir="ltr"
                    class="bg-muted min-w-0 flex-1 truncate rounded px-2 py-1.5 font-mono text-xs"
                    aria-labelledby="form-endpoint-label"
                    data-form-endpoint
                    >POST {{ endpoint() }}</code
                  >
                  <button
                    hlmBtn
                    size="icon-sm"
                    variant="ghost"
                    type="button"
                    [attr.aria-label]="t('forms.copyEndpoint')"
                    [title]="t('forms.copyEndpoint')"
                    (click)="copy(endpoint())"
                  >
                    <ng-icon name="lucideCopy" />
                  </button>
                </div>
                <p class="text-muted-foreground text-xs">{{ t('forms.endpointHint') }}</p>
              </div>
              <div class="relative">
                <pre
                  dir="ltr"
                  class="bg-muted overflow-x-auto rounded-md p-3 pe-10 font-mono text-xs"
                  >{{ snippet() }}</pre>
                <button
                  hlmBtn
                  size="icon-xs"
                  variant="ghost"
                  type="button"
                  class="absolute end-1.5 top-1.5"
                  [attr.aria-label]="t('forms.copySnippet')"
                  [title]="t('forms.copySnippet')"
                  (click)="copy(snippet())"
                >
                  <ng-icon name="lucideCopy" />
                </button>
              </div>
              <p class="text-muted-foreground text-xs">{{ t('forms.integrationHint') }}</p>
            </div>
          </div>
        </hlm-tabs>
      }
    </div>
  `,
})
export class FormEditPage {
  private readonly site = inject(Site);
  private readonly router = inject(Router);
  private readonly config = inject(RUNTIME_CONFIG);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  private readonly pageTitle = inject(PageTitle);
  protected readonly access = siteAccess('forms');

  /** The route's `:id` (`new` for a new form). */
  readonly id = input.required<string>();
  protected readonly isNew = computed(() => this.id() === 'new');

  protected readonly types = FORM_FIELD_TYPES;
  protected readonly typeLabels = TYPE_LABELS;
  protected readonly fieldProblemLabels = FIELD_PROBLEMS;
  protected readonly formProblemLabels = FORM_PROBLEMS;
  protected readonly maxFields = MAX_FORM_FIELDS;

  protected readonly tab = signal<Tab>('fields');
  protected readonly name = signal('');
  protected readonly slug = signal('');
  private slugTouched = false;
  protected readonly fields = signal<FieldDraft[]>([]);
  /** The fields as saved: the submissions' columns. */
  protected readonly savedFields = signal<FormField[]>([]);
  protected readonly savedSlug = signal('');
  protected readonly notifyEmails = signal('');
  protected readonly successMessage = signal('');
  protected readonly honeypot = signal(true);
  /** The form, fetched once the site feature is on and when `id` changes (`null` if new). */
  private readonly form = resource({
    params: () => (this.access() === 'ok' ? this.id() : undefined),
    loader: async ({ params: id }) => {
      if (id === 'new') return null;
      try {
        return await this.site.form(Number(id));
      } catch (error) {
        const failure = ApiFailure.from(error);
        throw failure.status === 404 ? new Error(this.t('forms.notFound')) : failure;
      }
    },
  });
  /** The editor's signals hold the loaded form. */
  protected readonly loaded = signal(false);
  protected readonly loadError = loadErrorOf(this.form);
  protected readonly saveError = signal<string | null>(null);
  protected readonly showErrors = signal(false);
  protected readonly saving = signal(false);
  protected readonly announcement = signal('');

  protected readonly submissions = signal<Submission[]>([]);
  protected readonly meta = signal<PageMeta>({});
  protected readonly page = signal(1);
  protected readonly pageCount = computed(() => this.meta().pageCount ?? 1);
  protected readonly submissionsLoading = signal(false);
  protected readonly exporting = signal(false);

  protected readonly fieldIssues = computed(() => fieldProblems(this.fields()));
  protected readonly fieldErrorCount = computed(() => this.fieldIssues().size);
  protected readonly formErrors = computed(() =>
    formProblems(this.name(), this.slug(), this.fields(), this.notifyEmails()),
  );
  protected readonly badEmails = computed(() => invalidEmails(emailList(this.notifyEmails())));
  protected readonly endpoint = computed(
    () => `${location.origin}${this.config.contentApiBase}/_forms/${this.savedSlug()}`,
  );
  protected readonly snippet = computed(() =>
    submissionSnippet(this.endpoint(), this.savedFields()),
  );

  private submissionsLoaded = false;

  constructor() {
    // The editor is filled from each load (plain signals: they are edited in place and a
    // save keeps them without a refetch). Submissions stay imperative: they load lazily,
    // when their tab opens, and page on demand.
    effect(() => {
      if (!this.form.hasValue()) {
        this.loaded.set(false);
        return;
      }
      const form = this.form.value();
      untracked(() => {
        this.saveError.set(null);
        this.showErrors.set(false);
        this.submissionsLoaded = false;
        this.submissions.set([]);
        this.meta.set({});
        this.page.set(1);
        if (!form) {
          this.name.set('');
          this.slug.set('');
          this.slugTouched = false;
          const first = {
            ...newField([], 'email'),
            name: 'email',
            label: this.t('forms.defaultEmail'),
          };
          this.fields.set([first]);
          this.savedFields.set([]);
          this.savedSlug.set('');
          this.notifyEmails.set('');
          this.successMessage.set('');
          this.honeypot.set(true);
          this.tab.set('fields');
        } else {
          this.name.set(form.name);
          this.slug.set(form.slug);
          this.slugTouched = true;
          this.fields.set(form.fields.map(toDraft));
          this.savedFields.set(form.fields);
          this.savedSlug.set(form.slug);
          this.notifyEmails.set(form.settings.notifyEmails.join(', '));
          this.successMessage.set(form.settings.successMessage ?? '');
          this.honeypot.set(form.settings.honeypot);
          this.pageTitle.setDetail(form.name);
          if (this.tab() === 'submissions') void this.loadSubmissions();
        }
        this.loaded.set(true);
      });
    });
  }

  protected setTab(tab: Tab): void {
    this.tab.set(tab);
    if (tab === 'submissions' && !this.submissionsLoaded) void this.loadSubmissions();
  }

  protected hasFormProblem(problem: FormProblem): boolean {
    return this.formErrors().includes(problem);
  }

  protected nameProblem(problems: FieldProblem[]): boolean {
    return problems.some((p) => p === 'name' || p === 'nameReserved' || p === 'nameDuplicate');
  }

  protected isText(type: FormFieldType): boolean {
    return TEXT_TYPES.includes(type);
  }

  protected options(text: string): string[] {
    return optionList(text);
  }

  protected setName(name: string): void {
    this.name.set(name);
    if (!this.slugTouched) this.slug.set(slugify(name));
  }

  protected setSlug(slug: string): void {
    this.slugTouched = true;
    this.slug.set(slug.trim());
  }

  protected patchField(key: string, change: Partial<FieldDraft>): void {
    this.fields.update((list) =>
      list.map((field) => (field.key === key ? { ...field, ...change } : field)),
    );
  }

  /** The name follows the label until it is edited by hand. */
  protected setLabel(key: string, label: string): void {
    const field = this.fields().find((item) => item.key === key);
    const change: Partial<FieldDraft> = { label };
    if (field && !field.nameTouched) {
      const name = fieldName(label);
      if (name) change.name = name;
    }
    this.patchField(key, change);
  }

  protected addField(): void {
    const field = newField(this.fields());
    this.fields.update((list) => [...list, field]);
    setTimeout(() => document.getElementById(`field-${field.key}-label`)?.focus());
  }

  protected removeField(index: number): void {
    const field = this.fields()[index];
    this.fields.update((list) => list.filter((_, i) => i !== index));
    this.announce(
      this.t('forms.fieldRemoved', { label: field.label || this.t('forms.untitledField') }),
    );
    const next = this.fields()[Math.min(index, this.fields().length - 1)];
    if (next) this.focusHandle(next.key);
  }

  protected moveField(index: number, delta: -1 | 1): void {
    const to = index + delta;
    if (to < 0 || to >= this.fields().length) return;
    this.reorderTo(index, to);
  }

  protected drop(event: CdkDragDrop<unknown>): void {
    if (event.previousIndex !== event.currentIndex) {
      this.reorderTo(event.previousIndex, event.currentIndex);
    }
  }

  private reorderTo(from: number, to: number): void {
    const field = this.fields()[from];
    this.fields.set(reorder(this.fields(), from, to));
    this.announce(
      this.t('forms.fieldMoved', {
        label: field.label || this.t('forms.untitledField'),
        position: to + 1,
        count: this.fields().length,
      }),
    );
    this.focusHandle(field.key);
  }

  private focusHandle(key: string): void {
    setTimeout(() => document.querySelector<HTMLElement>(`[data-field-handle="${key}"]`)?.focus());
  }

  private announce(message: string): void {
    this.announcement.set('');
    setTimeout(() => this.announcement.set(message));
  }

  protected async save(): Promise<void> {
    if (this.saving()) return;
    this.showErrors.set(true);
    this.saveError.set(null);
    if (this.formErrors().length || this.fieldErrorCount()) {
      if (this.fieldErrorCount()) this.tab.set('fields');
      else if (this.badEmails().length) this.tab.set('settings');
      return;
    }
    this.saving.set(true);
    const input = formInput(this.name(), this.slug(), this.fields(), {
      notifyEmails: this.notifyEmails(),
      successMessage: this.successMessage(),
      honeypot: this.honeypot(),
    });
    try {
      if (this.isNew()) {
        const form = await this.site.createForm(input);
        toast.success(this.t('forms.created', { name: form.name }));
        await this.router.navigate(['/settings/forms', form.id], { replaceUrl: true });
      } else {
        const form = await this.site.updateForm(Number(this.id()), input);
        this.savedFields.set(form.fields);
        this.savedSlug.set(form.slug);
        this.pageTitle.setDetail(form.name);
        toast.success(this.t('forms.saved', { name: form.name }));
      }
      this.showErrors.set(false);
    } catch (error) {
      const failure = ApiFailure.from(error);
      this.saveError.set(
        failure.status === 409 ? this.t('forms.slugTaken', { slug: input.slug }) : failure.message,
      );
    } finally {
      this.saving.set(false);
    }
  }

  protected async loadSubmissions(): Promise<void> {
    if (this.isNew()) return;
    this.submissionsLoading.set(true);
    try {
      const response = await this.site.submissions(Number(this.id()), this.page(), PAGE_SIZE);
      this.submissions.set(response.data);
      this.meta.set(response.meta?.pagination ?? {});
      this.submissionsLoaded = true;
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    } finally {
      this.submissionsLoading.set(false);
    }
  }

  protected goTo(page: number): void {
    this.page.set(page);
    void this.loadSubmissions();
  }

  protected cell(submission: Submission, field: FormField): string {
    const value = submission.data?.[field.name];
    if (field.type === 'checkbox' && typeof value === 'boolean') {
      return value ? this.t('common.yes') : this.t('common.no');
    }
    return cellText(value);
  }

  protected async removeSubmission(submission: Submission): Promise<void> {
    try {
      await this.site.deleteSubmission(Number(this.id()), submission.id);
      toast.success(this.t('forms.submissionDeleted'));
      if (this.submissions().length === 1 && this.page() > 1) this.page.update((page) => page - 1);
      await this.loadSubmissions();
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    }
  }

  protected async exportCsv(): Promise<void> {
    this.exporting.set(true);
    try {
      const blob = await this.site.exportSubmissions(Number(this.id()));
      saveBlob(blob, `${this.savedSlug() || 'form'}-submissions.csv`);
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    } finally {
      this.exporting.set(false);
    }
  }

  protected async copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(this.t('common.copied'));
    } catch {
      toast.error(this.t('forms.copyFailed'));
    }
  }
}
