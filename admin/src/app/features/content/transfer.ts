/**
 * CSV / JSON import and export of one content type (`/content/{uid}/export|import`, see
 * docs/architecture.md §13): reading the picked file for its columns, the default mapping
 * of columns to attributes, and the import report.
 */
import { Issue } from '../../core/api';
import { ContentType } from '../../core/types';

export type TransferFormat = 'csv' | 'json';

/**
 * The largest file an import takes: the request body (the file's text in JSON, whose
 * escaping adds a little) is bounded by the server's `server.body_limit`, 1 MB by default.
 */
export const MAX_IMPORT_BYTES = 1024 * 1024;

/** Why a picked file cannot be imported. */
export type FileProblem = 'format' | 'tooLarge' | 'empty' | 'csv' | 'json' | 'notList';

export class TransferFileError extends Error {
  constructor(readonly problem: FileProblem) {
    super(problem);
  }
}

/** The format of a file, by its extension. */
export function formatOf(name: string): TransferFormat | null {
  const extension = /\.([^.]+)$/.exec(name.trim())?.[1]?.toLowerCase();
  return extension === 'csv' ? 'csv' : extension === 'json' ? 'json' : null;
}

/**
 * RFC 4180 records, as the server reads them: quoted cells (with doubled quotes, commas
 * and line breaks inside), CRLF or LF, a leading BOM skipped, blank lines dropped.
 */
export function parseCsv(text: string): string[][] {
  const source = text.startsWith('\uFEFF') ? text.slice(1) : text;
  const records: string[][] = [];
  let record: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"' && cell === '') {
      quoted = true;
    } else if (char === ',') {
      record.push(cell);
      cell = '';
    } else if (char === '\r' && source[index + 1] === '\n') {
      // The `\n` ends the record.
    } else if (char === '\n' || char === '\r') {
      record.push(cell);
      records.push(record);
      record = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (quoted) throw new TransferFileError('csv');
  if (cell !== '' || record.length) {
    record.push(cell);
    records.push(record);
  }
  return records.filter((row) => !(row.length === 1 && row[0] === ''));
}

/** What an import file holds: its columns (in order) and how many rows. */
export interface FileColumns {
  columns: string[];
  rows: number;
}

/**
 * The columns of a CSV file (its header, trimmed as the server does; a repeated name once)
 * and its row count. A file without data rows is `empty`.
 */
export function csvColumns(text: string): FileColumns {
  const [header, ...rows] = parseCsv(text);
  if (!header || !rows.length) throw new TransferFileError('empty');
  const columns = header.map((column) => column.trim());
  return {
    columns: columns.filter((column, index) => columns.indexOf(column) === index),
    rows: rows.length,
  };
}

/** The keys of a JSON list of objects, in first-seen order, and its length. */
export function jsonColumns(text: string): FileColumns {
  let value: unknown;
  try {
    value = JSON.parse(text.startsWith('\uFEFF') ? text.slice(1) : text);
  } catch {
    throw new TransferFileError('json');
  }
  if (
    !Array.isArray(value) ||
    value.some((item) => !item || typeof item !== 'object' || Array.isArray(item))
  ) {
    throw new TransferFileError('notList');
  }
  if (!value.length) throw new TransferFileError('empty');
  const columns: string[] = [];
  for (const item of value as Record<string, unknown>[]) {
    for (const key of Object.keys(item)) if (!columns.includes(key)) columns.push(key);
  }
  return { columns, rows: value.length };
}

export function fileColumns(text: string, format: TransferFormat): FileColumns {
  return format === 'csv' ? csvColumns(text) : jsonColumns(text);
}

/** The column naming the document to update. */
export const DOCUMENT_ID = 'documentId';

/**
 * The attributes an import can write, in schema order: not passwords, and not the inverse
 * sides of relations (read-only; the server leaves them out too).
 */
export function importableAttributes(type: ContentType): string[] {
  return Object.entries(type.attributes)
    .filter(([, attribute]) => {
      if (attribute.type === 'password') return false;
      if (attribute.type !== 'relation') return true;
      return (
        !attribute.mappedBy &&
        attribute.relation !== 'morphOne' &&
        attribute.relation !== 'morphMany'
      );
    })
    .map(([name]) => name);
}

/** Column → attribute (`null`: skipped), as the import request takes it. */
export type ColumnMapping = Record<string, string | null>;

const fold = (name: string) => name.toLowerCase().replace(/[\s_-]+/g, '');

/**
 * Each column mapped to the attribute of the same name (exactly, else ignoring case,
 * spaces, `_` and `-`), or `documentId`; others are skipped. An attribute is only
 * pre-selected for its first column.
 */
export function defaultMapping(
  columns: readonly string[],
  attributes: readonly string[],
): ColumnMapping {
  const targets = [DOCUMENT_ID, ...attributes];
  const mapping: ColumnMapping = Object.fromEntries(columns.map((column) => [column, null]));
  // Exact names first, so that a loose match never takes an attribute from its own column.
  const taken = new Set(columns.filter((column) => targets.includes(column)));
  for (const column of columns) {
    if (taken.has(column)) {
      mapping[column] = column;
      continue;
    }
    const target = targets.find((name) => fold(name) === fold(column) && !taken.has(name));
    if (target) {
      taken.add(target);
      mapping[column] = target;
    }
  }
  return mapping;
}

/** Attributes chosen for more than one column (the later columns would overwrite). */
export function duplicateTargets(mapping: ColumnMapping): string[] {
  const counts = new Map<string, number>();
  for (const target of Object.values(mapping)) {
    if (target) counts.set(target, (counts.get(target) ?? 0) + 1);
  }
  return [...counts].filter(([, count]) => count > 1).map(([target]) => target);
}

/** Whether any column is imported (a mapping skipping everything writes empty rows). */
export function mapsSomething(mapping: ColumnMapping): boolean {
  return Object.values(mapping).some((target) => target && target !== DOCUMENT_ID);
}

/** The import request body. */
export interface ImportRequest {
  format: TransferFormat;
  data: string;
  mapping: ColumnMapping;
  dryRun: boolean;
  publish: boolean;
}

/** The size of the request body, in bytes (what the server's body limit counts). */
export function requestBytes(request: ImportRequest): number {
  return new Blob([JSON.stringify(request)]).size;
}

export interface RowError {
  /** 1-based data row (after a CSV's header). */
  row: number;
  documentId: string | null;
  errors: Issue[];
}

/** The answer of an import (`dryRun`: nothing was written). */
export interface ImportReport {
  dryRun: boolean;
  created: number;
  updated: number;
  failed: number;
  ignoredColumns: string[];
  /** The first failing rows (at most 100). */
  errors: RowError[];
}

/** One line of the report's error table. */
export interface ReportLine {
  row: number;
  documentId: string | null;
  /** Attribute path (`seo.title`), empty for the row as a whole. */
  path: string;
  message: string;
  /** The first line of its row (the table shows the row number once). */
  first: boolean;
}

/** The row errors as table lines, a row's problems together, rows in order. */
export function reportLines(report: ImportReport): ReportLine[] {
  return [...report.errors]
    .sort((a, b) => a.row - b.row)
    .flatMap((row) => {
      const issues = row.errors.length ? row.errors : [{ path: [], message: '' }];
      return issues.map((issue, index) => ({
        row: row.row,
        documentId: row.documentId ?? null,
        path: issue.path.join('.'),
        message: issue.message,
        first: index === 0,
      }));
    });
}

/** Failing rows the report does not detail (the server lists at most 100). */
export function unlistedFailures(report: ImportReport): number {
  return Math.max(0, report.failed - report.errors.length);
}
