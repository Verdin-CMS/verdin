import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { Api, ApiFailure, ListResponse } from './api';
import { Attributes } from './types';

// ------------------------------------------------------------------ redirects

export const REDIRECT_STATUSES = [301, 302, 307, 308] as const;
export type RedirectStatus = (typeof REDIRECT_STATUSES)[number];

export interface Redirect {
  id: number;
  source: string;
  destination: string;
  status: RedirectStatus;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface RedirectInput {
  source: string;
  destination: string;
  status: RedirectStatus;
}

export type RedirectProblem = 'source' | 'destination' | 'status' | 'same' | 'duplicate';

/** Checks a redirect as the server does (except loops, which need the whole list). */
export function redirectProblems(
  input: RedirectInput,
  others: readonly Pick<Redirect, 'id' | 'source'>[] = [],
  id: number | null = null,
): RedirectProblem[] {
  const problems: RedirectProblem[] = [];
  const source = input.source.trim();
  const destination = input.destination.trim();
  if (!source.startsWith('/') || source.length > 2048) problems.push('source');
  if (!(destination.startsWith('/') || isHttpUrl(destination)) || destination.length > 4096) {
    problems.push('destination');
  }
  if (!REDIRECT_STATUSES.includes(input.status)) problems.push('status');
  if (source && source === destination) problems.push('same');
  if (others.some((other) => other.source === source && other.id !== id)) {
    problems.push('duplicate');
  }
  return problems;
}

function isHttpUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Redirects whose source or destination contains `term` (case-insensitive). */
export function filterRedirects(list: readonly Redirect[], term: string): Redirect[] {
  const needle = term.trim().toLowerCase();
  if (!needle) return [...list];
  return list.filter(
    (redirect) =>
      redirect.source.toLowerCase().includes(needle) ||
      redirect.destination.toLowerCase().includes(needle),
  );
}

/** One CSV field, quoted when needed. */
function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** `source,destination,status` rows with a header. */
export function redirectsToCsv(list: readonly RedirectInput[]): string {
  const rows = [['source', 'destination', 'status']];
  for (const redirect of list) {
    rows.push([redirect.source, redirect.destination, String(redirect.status)]);
  }
  return rows.map((row) => row.map(csvField).join(',')).join('\r\n') + '\r\n';
}

/** Parses CSV (RFC 4180: quotes, doubled quotes, CRLF or LF) into rows of fields. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field === '') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''));
}

/**
 * Redirects from a CSV file: `source,destination[,status]`, with an optional header row
 * (status 301 when missing). Rows that cannot be read are reported by line number.
 */
export function redirectsFromCsv(text: string): { redirects: RedirectInput[]; invalid: number[] } {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  const redirects: RedirectInput[] = [];
  const invalid: number[] = [];
  rows.forEach((cells, index) => {
    const [source = '', destination = '', status = ''] = cells.map((cell) => cell.trim());
    if (index === 0 && source.toLowerCase() === 'source') return;
    const code = status ? Number(status) : 301;
    const input = { source, destination, status: code as RedirectStatus };
    if (redirectProblems(input).some((problem) => problem !== 'duplicate')) {
      invalid.push(index + 1);
    } else {
      redirects.push(input);
    }
  });
  return { redirects, invalid };
}

// ---------------------------------------------------------------------- menus

/** A menu item as stored: a label and a `url` or an `entry` link. */
export interface MenuItem {
  label: string;
  url?: string;
  entry?: { uid: string; documentId: string };
  target?: '_self' | '_blank';
  children?: MenuItem[];
}

export interface Menu {
  id: number;
  slug: string;
  name: string;
  items: MenuItem[];
  createdAt: string | null;
  updatedAt: string | null;
}

export interface MenuInput {
  slug: string;
  name: string;
  items: MenuItem[];
}

// ---------------------------------------------------------------------- forms

export const FORM_FIELD_TYPES = [
  'text',
  'email',
  'textarea',
  'number',
  'select',
  'checkbox',
  'date',
  'url',
  'tel',
] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

export interface FormField {
  name: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  options?: string[];
  maxLength?: number;
  placeholder?: string;
}

export interface FormSettings {
  notifyEmails: string[];
  successMessage: string | null;
  honeypot: boolean;
}

export interface Form {
  id: number;
  slug: string;
  name: string;
  fields: FormField[];
  settings: FormSettings;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface FormInput {
  slug: string;
  name: string;
  fields: FormField[];
  settings: FormSettings;
}

export interface Submission {
  id: number;
  formId: number;
  data: Record<string, unknown>;
  createdAt: string | null;
}

/** The component `GET /site/seo/component` suggests. */
export interface SeoComponent {
  category: string;
  name: string;
  schema: { displayName: string; icon?: string; attributes: Attributes };
}

/** Kebab-case, as the server wants slugs (`a-z`, `0-9`, `-`, up to 128). */
export function validSlug(slug: string): boolean {
  return /^[a-z0-9-]{1,128}$/.test(slug);
}

/** A slug from a name: `Main menu` → `main-menu`. */
export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 128);
}

/** Redirects, menus, forms and their submissions (`/site`, `site.manage`). */
@Injectable({ providedIn: 'root' })
export class Site {
  private readonly api = inject(Api);
  private readonly http = inject(HttpClient);

  redirects(): Promise<Redirect[]> {
    return this.api.get<Redirect[]>('/site/redirects');
  }

  createRedirect(input: RedirectInput): Promise<Redirect> {
    return this.api.post<Redirect>('/site/redirects', input);
  }

  updateRedirect(id: number, input: RedirectInput): Promise<Redirect> {
    return this.api.put<Redirect>(`/site/redirects/${id}`, input);
  }

  deleteRedirect(id: number): Promise<void> {
    return this.api.delete(`/site/redirects/${id}`);
  }

  menus(): Promise<Menu[]> {
    return this.api.get<Menu[]>('/site/menus');
  }

  menu(id: number): Promise<Menu> {
    return this.api.get<Menu>(`/site/menus/${id}`);
  }

  createMenu(input: MenuInput): Promise<Menu> {
    return this.api.post<Menu>('/site/menus', input);
  }

  updateMenu(id: number, input: MenuInput): Promise<Menu> {
    return this.api.put<Menu>(`/site/menus/${id}`, input);
  }

  deleteMenu(id: number): Promise<void> {
    return this.api.delete(`/site/menus/${id}`);
  }

  forms(): Promise<Form[]> {
    return this.api.get<Form[]>('/site/forms');
  }

  form(id: number): Promise<Form> {
    return this.api.get<Form>(`/site/forms/${id}`);
  }

  createForm(input: FormInput): Promise<Form> {
    return this.api.post<Form>('/site/forms', input);
  }

  updateForm(id: number, input: FormInput): Promise<Form> {
    return this.api.put<Form>(`/site/forms/${id}`, input);
  }

  deleteForm(id: number): Promise<void> {
    return this.api.delete(`/site/forms/${id}`);
  }

  submissions(formId: number, page: number, pageSize: number): Promise<ListResponse<Submission>> {
    return this.api.list<Submission>(
      `/site/forms/${formId}/submissions`,
      `page=${page}&pageSize=${pageSize}`,
    );
  }

  deleteSubmission(formId: number, id: number): Promise<void> {
    return this.api.delete(`/site/forms/${formId}/submissions/${id}`);
  }

  /** The submissions as a CSV file (the token is added by the auth interceptor). */
  async exportSubmissions(formId: number): Promise<Blob> {
    try {
      return await firstValueFrom(
        this.http.get(`${this.api.base}/site/forms/${formId}/submissions/export`, {
          responseType: 'blob',
          withCredentials: true,
        }),
      );
    } catch (error) {
      throw ApiFailure.from(error);
    }
  }

  seoComponent(): Promise<SeoComponent> {
    return this.api.get<SeoComponent>('/site/seo/component');
  }
}

/** Saves `blob` as `name` through a temporary link. */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
