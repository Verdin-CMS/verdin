import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCheckboxImports } from '@spartan-ng/helm/checkbox';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { HlmTableImports } from '@spartan-ng/helm/table';

import { Api, ApiFailure, toQuery } from '../../core/api';
import { I18n } from '../../core/i18n/i18n';
import { MessageKey } from '../../core/i18n/keys';
import { ContentType } from '../../core/types';
import { humanize } from './fields/fields';
import {
  ColumnMapping,
  DOCUMENT_ID,
  FileProblem,
  ImportReport,
  ImportRequest,
  MAX_IMPORT_BYTES,
  TransferFileError,
  TransferFormat,
  defaultMapping,
  duplicateTargets,
  fileColumns,
  formatOf,
  importableAttributes,
  mapsSomething,
  reportLines,
  requestBytes,
  unlistedFailures,
} from './transfer';

const PROBLEMS = {
  format: 'transfer.import.problem.format',
  tooLarge: 'transfer.import.problem.tooLarge',
  empty: 'transfer.import.problem.empty',
  csv: 'transfer.import.problem.csv',
  json: 'transfer.import.problem.json',
  notList: 'transfer.import.problem.notList',
} as const satisfies Record<FileProblem, MessageKey>;

/** The picked file, read. */
interface PickedFile {
  name: string;
  format: TransferFormat;
  text: string;
  columns: string[];
  rows: number;
}

/** The counts, ignored columns and row errors of an import (or of its dry run). */
@Component({
  selector: 'vd-import-report',
  imports: [NgIcon, HlmTableImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let data = report();
    <section class="flex flex-col gap-3" aria-labelledby="import-report-title">
      <h3 id="import-report-title" tabindex="-1" class="text-sm font-semibold outline-none">
        {{ data.dryRun ? t('transfer.report.checkTitle') : t('transfer.report.doneTitle') }}
      </h3>
      <ul class="grid grid-cols-3 gap-2 text-center">
        <li class="bg-muted/40 rounded-lg border p-2">
          <span class="block text-lg font-semibold tabular-nums">{{ data.created }}</span>
          <span class="text-muted-foreground text-xs">
            {{ data.dryRun ? t('transfer.report.toCreate') : t('transfer.report.created') }}
          </span>
        </li>
        <li class="bg-muted/40 rounded-lg border p-2">
          <span class="block text-lg font-semibold tabular-nums">{{ data.updated }}</span>
          <span class="text-muted-foreground text-xs">
            {{ data.dryRun ? t('transfer.report.toUpdate') : t('transfer.report.updated') }}
          </span>
        </li>
        <li
          class="rounded-lg border p-2"
          [class.bg-muted/40]="!data.failed"
          [class.border-destructive/40]="data.failed"
          [class.text-destructive]="data.failed"
        >
          <span class="block text-lg font-semibold tabular-nums">{{ data.failed }}</span>
          <span class="text-xs" [class.text-muted-foreground]="!data.failed">
            {{ t('transfer.report.failed') }}
          </span>
        </li>
      </ul>
      @if (data.ignoredColumns.length) {
        <p class="text-muted-foreground text-sm">
          {{ t('transfer.report.ignored', { columns: i18n.formatList(data.ignoredColumns) }) }}
        </p>
      }
      @if (lines().length) {
        <div hlmTableContainer class="max-h-64 rounded-lg border">
          <table hlmTable>
            <caption class="sr-only">
              {{
                t('transfer.report.errors')
              }}
            </caption>
            <thead hlmTHead class="bg-muted/40">
              <tr hlmTr class="hover:bg-transparent">
                <th hlmTh scope="col" class="px-3">{{ t('transfer.report.row') }}</th>
                <th hlmTh scope="col" class="px-3">{{ t('transfer.report.field') }}</th>
                <th hlmTh scope="col" class="px-3">{{ t('transfer.report.problem') }}</th>
              </tr>
            </thead>
            <tbody hlmTBody>
              @for (line of lines(); track $index) {
                <tr hlmTr class="hover:bg-transparent" [class.border-t-0]="!line.first">
                  <td hlmTd class="px-3 py-2 align-top tabular-nums">
                    @if (line.first) {
                      {{ line.row }}
                      @if (line.documentId) {
                        <span class="text-muted-foreground block font-mono text-xs">{{
                          line.documentId
                        }}</span>
                      }
                    }
                  </td>
                  <td hlmTd class="px-3 py-2 align-top font-mono text-xs">
                    {{ line.path || '—' }}
                  </td>
                  <td hlmTd class="px-3 py-2 align-top whitespace-normal">
                    {{ line.message || t('transfer.report.unknown') }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
      @if (unlisted()) {
        <p class="text-muted-foreground text-xs">
          {{ t('transfer.report.unlisted', { count: unlisted() }) }}
        </p>
      }
      @if (data.dryRun && !data.failed && (data.created || data.updated)) {
        <p class="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
          <ng-icon name="lucideCircleCheck" aria-hidden="true" /> {{ t('transfer.report.ready') }}
        </p>
      }
    </section>
  `,
})
export class ImportReportView {
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;

  readonly report = input.required<ImportReport>();
  protected readonly lines = computed(() => reportLines(this.report()));
  protected readonly unlisted = computed(() => unlistedFailures(this.report()));
}

/**
 * Imports a CSV or JSON file into a content type: the file is read here for its columns,
 * each column is mapped to an attribute, a dry run checks every row, then the real run
 * writes them (`POST /content/{uid}/import`).
 */
@Component({
  selector: 'vd-content-import',
  imports: [
    NgIcon,
    ImportReportView,
    HlmAlertImports,
    HlmButtonImports,
    HlmCheckboxImports,
    HlmDialogImports,
    HlmFieldImports,
    HlmInputImports,
    HlmNativeSelectImports,
    HlmSpinnerImports,
    HlmTableImports,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-dialog [state]="open() ? 'open' : 'closed'" (closed)="closed.emit()">
      <hlm-dialog-content
        *hlmDialogPortal="let ctx"
        class="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"
        [closeLabel]="t('common.close')"
      >
        <hlm-dialog-header>
          <h2 hlmDialogTitle>{{ t('transfer.import.title', { type: type().displayName }) }}</h2>
          <p hlmDialogDescription>{{ t('transfer.import.description') }}</p>
        </hlm-dialog-header>

        @if (final(); as report) {
          <vd-import-report [report]="report" />
          <hlm-dialog-footer>
            <button hlmBtn type="button" (click)="closed.emit()">{{ t('common.close') }}</button>
          </hlm-dialog-footer>
        } @else {
          <div class="flex flex-col gap-5">
            <div hlmField [attr.data-invalid]="problem() ? true : null">
              <label hlmFieldLabel for="content-import-file">{{ t('transfer.import.file') }}</label>
              <input
                hlmInput
                id="content-import-file"
                type="file"
                accept=".csv,.json,text/csv,application/json"
                aria-describedby="content-import-file-hint"
                [attr.aria-invalid]="problem() ? true : null"
                [disabled]="!!busy()"
                (change)="pick($event)"
              />
              @if (problem(); as problem) {
                <hlm-field-error>{{ t(PROBLEMS[problem], { size: maxSize }) }}</hlm-field-error>
              }
              <p hlmFieldDescription id="content-import-file-hint">
                {{ t('transfer.import.fileHint', { size: maxSize }) }}
              </p>
            </div>

            @if (reading()) {
              <p class="text-muted-foreground flex items-center gap-2 text-sm" role="status">
                <hlm-spinner class="size-4" /> {{ t('transfer.import.reading') }}
              </p>
            }

            @if (file(); as file) {
              <p class="text-muted-foreground text-sm" role="status">
                {{
                  t('transfer.import.detected', {
                    name: file.name,
                    rows: file.rows,
                    columns: file.columns.length,
                  })
                }}
              </p>

              <fieldset class="flex flex-col gap-2">
                <legend class="mb-1 text-sm font-medium">{{ t('transfer.import.mapping') }}</legend>
                <p class="text-muted-foreground text-xs">{{ t('transfer.import.mappingHint') }}</p>
                <div hlmTableContainer class="max-h-72 rounded-lg border">
                  <table hlmTable>
                    <thead hlmTHead class="bg-muted/40">
                      <tr hlmTr class="hover:bg-transparent">
                        <th hlmTh scope="col" class="px-3">{{ t('transfer.import.column') }}</th>
                        <th hlmTh scope="col" class="px-3">{{ t('transfer.import.target') }}</th>
                      </tr>
                    </thead>
                    <tbody hlmTBody>
                      @for (column of file.columns; track column; let index = $index) {
                        <tr hlmTr class="hover:bg-transparent">
                          <td hlmTd class="max-w-48 truncate px-3 py-1.5">
                            <label
                              class="font-mono text-xs"
                              [for]="'content-import-map-' + index"
                              [title]="column"
                              >{{ column || t('transfer.import.unnamed') }}</label
                            >
                          </td>
                          <td hlmTd class="px-3 py-1.5">
                            <hlm-native-select
                              size="sm"
                              class="w-full min-w-44"
                              [selectId]="'content-import-map-' + index"
                              [value]="mapping()[column] ?? ''"
                              [disabled]="!!busy()"
                              (valueChange)="setTarget(column, $event)"
                            >
                              <option hlmNativeSelectOption value="">
                                {{ t('transfer.import.skip') }}
                              </option>
                              <option hlmNativeSelectOption [value]="DOCUMENT_ID">
                                {{ t('transfer.import.documentId') }}
                              </option>
                              @for (name of attributes(); track name) {
                                <option hlmNativeSelectOption [value]="name">
                                  {{ humanize(name) }} ({{ name }})
                                </option>
                              }
                            </hlm-native-select>
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
                @if (duplicates().length) {
                  <p class="text-destructive text-sm" role="alert">
                    {{
                      t('transfer.import.duplicates', {
                        attributes: i18n.formatList(duplicates()),
                      })
                    }}
                  </p>
                } @else if (!mapsSomething(mapping())) {
                  <p class="text-muted-foreground text-sm">{{ t('transfer.import.nothing') }}</p>
                }
              </fieldset>

              @if (canPublish()) {
                <div hlmField orientation="horizontal">
                  <hlm-checkbox
                    inputId="content-import-publish"
                    [checked]="publish()"
                    [disabled]="!!busy()"
                    (checkedChange)="setPublish($event === true)"
                  />
                  <div hlmFieldContent>
                    <label hlmFieldLabel for="content-import-publish">{{
                      t('transfer.import.publish')
                    }}</label>
                    <p hlmFieldDescription>{{ t('transfer.import.publishHint') }}</p>
                  </div>
                </div>
              }

              @if (checked(); as report) {
                <vd-import-report [report]="report" />
              }
            }

            @if (error()) {
              <div hlmAlert variant="destructive" role="alert">
                <ng-icon hlmAlertIcon name="lucideCircleAlert" />
                <p hlmAlertDescription>{{ error() }}</p>
              </div>
            }
          </div>

          <hlm-dialog-footer>
            <button hlmBtn variant="outline" type="button" (click)="closed.emit()">
              {{ t('common.cancel') }}
            </button>
            <button
              hlmBtn
              variant="outline"
              type="button"
              [disabled]="!ready() || !!busy()"
              (click)="run(true)"
            >
              @if (busy() === 'check') {
                <hlm-spinner class="size-4" />
              } @else {
                <ng-icon name="lucideListChecks" />
              }
              {{ t('transfer.import.check') }}
            </button>
            <button
              hlmBtn
              type="button"
              [disabled]="!importable() || !!busy()"
              [title]="checked() ? '' : t('transfer.import.checkFirst')"
              (click)="run(false)"
            >
              @if (busy() === 'import') {
                <hlm-spinner class="size-4" />
              } @else {
                <ng-icon name="lucideImport" />
              }
              {{ t('transfer.import.run') }}
            </button>
          </hlm-dialog-footer>
        }
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class ContentImport {
  private readonly api = inject(Api);
  private readonly injector = inject(Injector);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  protected readonly humanize = humanize;
  protected readonly mapsSomething = mapsSomething;
  protected readonly PROBLEMS = PROBLEMS;
  protected readonly DOCUMENT_ID = DOCUMENT_ID;
  protected readonly maxSize = `${MAX_IMPORT_BYTES / (1024 * 1024)} MB`;

  readonly type = input.required<ContentType>();
  /** The listed locale (localized types): rows are written in it. */
  readonly locale = input<string | null>(null);
  readonly open = input(false);
  /** Draft & publish types, with the right to publish: offer publishing each row. */
  readonly canPublish = input(false);
  readonly closed = output<void>();
  /** A real import ran (whatever its outcome): the list reloads. */
  readonly imported = output<ImportReport>();

  protected readonly attributes = computed(() => importableAttributes(this.type()));
  protected readonly file = signal<PickedFile | null>(null);
  protected readonly problem = signal<FileProblem | null>(null);
  protected readonly reading = signal(false);
  protected readonly mapping = signal<ColumnMapping>({});
  protected readonly publish = signal(false);
  protected readonly busy = signal<'check' | 'import' | null>(null);
  protected readonly error = signal<string | null>(null);
  /** The dry run of the current file, mapping and options. */
  protected readonly checked = signal<ImportReport | null>(null);
  protected readonly final = signal<ImportReport | null>(null);

  protected readonly duplicates = computed(() => duplicateTargets(this.mapping()));
  protected readonly ready = computed(
    () => !!this.file() && !this.duplicates().length && mapsSomething(this.mapping()),
  );
  /** Importing follows a dry run in which some row passed. */
  protected readonly importable = computed(() => {
    const report = this.checked();
    return this.ready() && !!report && report.created + report.updated > 0;
  });

  constructor() {
    // Each opening starts over.
    effect(() => {
      if (this.open()) untracked(() => this.reset());
    });
  }

  private reset(): void {
    this.file.set(null);
    this.problem.set(null);
    this.reading.set(false);
    this.mapping.set({});
    this.publish.set(false);
    this.busy.set(null);
    this.error.set(null);
    this.checked.set(null);
    this.final.set(null);
  }

  protected async pick(event: Event): Promise<void> {
    const picked = (event.target as HTMLInputElement).files?.[0];
    this.file.set(null);
    this.checked.set(null);
    this.error.set(null);
    this.problem.set(null);
    if (!picked) return;
    const format = formatOf(picked.name);
    if (!format) return this.problem.set('format');
    if (picked.size > MAX_IMPORT_BYTES) return this.problem.set('tooLarge');
    this.reading.set(true);
    try {
      const text = await picked.text();
      const { columns, rows } = fileColumns(text, format);
      const mapping = defaultMapping(columns, this.attributes());
      // The request carries the file as JSON text: its escaping must fit too.
      const body: ImportRequest = { format, data: text, mapping, dryRun: true, publish: false };
      if (requestBytes(body) > MAX_IMPORT_BYTES) return this.problem.set('tooLarge');
      this.mapping.set(mapping);
      this.file.set({ name: picked.name, format, text, columns, rows });
    } catch (error) {
      this.problem.set(error instanceof TransferFileError ? error.problem : 'format');
    } finally {
      this.reading.set(false);
    }
  }

  protected setTarget(column: string, target: string | null | undefined): void {
    this.mapping.update((mapping) => ({ ...mapping, [column]: target || null }));
    this.checked.set(null);
  }

  protected setPublish(publish: boolean): void {
    this.publish.set(publish);
    this.checked.set(null);
  }

  protected async run(dryRun: boolean): Promise<void> {
    const file = this.file();
    if (!file || this.busy() || !this.ready()) return;
    if (!dryRun && !this.importable()) return;
    this.busy.set(dryRun ? 'check' : 'import');
    this.error.set(null);
    const body: ImportRequest = {
      format: file.format,
      data: file.text,
      mapping: this.mapping(),
      dryRun,
      publish: this.canPublish() && this.publish(),
    };
    try {
      const report = await this.api.post<ImportReport>(
        `/content/${this.type().uid}/import`,
        body,
        toQuery({ locale: this.locale() }) || undefined,
      );
      if (dryRun) {
        this.checked.set(report);
      } else {
        this.final.set(report);
        this.imported.emit(report);
      }
      afterNextRender(() => document.getElementById('import-report-title')?.focus(), {
        injector: this.injector,
      });
    } catch (error) {
      const failure = ApiFailure.from(error);
      this.error.set(
        failure.status === 413
          ? this.t(PROBLEMS.tooLarge, { size: this.maxSize })
          : failure.message,
      );
    } finally {
      this.busy.set(null);
    }
  }
}
