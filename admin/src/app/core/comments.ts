import { Injectable, inject } from '@angular/core';

import { Api, toQuery } from './api';
import { EntryKey } from './realtime';

/** A comment on an entry (a thread's first comment, or a reply). */
export interface Comment {
  id: number;
  uid: string;
  documentId: string;
  /** Empty for types that are not localized. */
  locale: string;
  /** Attribute path the thread is about (`seo.metaTitle`), if any. */
  field: string | null;
  parentId: number | null;
  /** Plain text with mentions written `@[Name](user:12)`. */
  body: string;
  authorId: number | null;
  /** Admins mentioned in the body. */
  mentions: number[];
  resolvedAt: string | null;
  resolvedBy: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/** A root comment and its replies, oldest first. */
export interface Thread extends Comment {
  replies: Comment[];
}

export type TaskStatus = 'open' | 'done';

export interface Task {
  id: number;
  uid: string;
  documentId: string;
  locale: string;
  title: string;
  description: string | null;
  assigneeId: number | null;
  /** `YYYY-MM-DD`. */
  dueDate: string | null;
  status: TaskStatus;
  createdBy: number | null;
  completedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface NewComment {
  body: string;
  field?: string | null;
  parentId?: number | null;
}

export interface NewTask {
  title: string;
  description?: string | null;
  assigneeId?: number | null;
  dueDate?: string | null;
}

/** `null` clears a field. */
export interface TaskChange {
  title?: string;
  description?: string | null;
  assigneeId?: number | null;
  dueDate?: string | null;
  status?: TaskStatus;
}

/** Longest comment the server accepts, in characters. */
export const MAX_COMMENT = 10_000;

// ---------------------------------------------------------------------------------------
// Mentions

/** A piece of a comment body: text, or a mention of an admin. */
export type BodySegment =
  { kind: 'text'; text: string } | { kind: 'mention'; name: string; userId: number };

const MENTION = /@\[([^\]\n]*)\]\(user:(\d+)\)/g;

/** Splits a body into text and mentions (`@[Ada](user:12)`), in order. */
export function parseBody(body: string): BodySegment[] {
  const segments: BodySegment[] = [];
  let last = 0;
  for (const match of body.matchAll(MENTION)) {
    const index = match.index ?? 0;
    if (index > last) segments.push({ kind: 'text', text: body.slice(last, index) });
    segments.push({ kind: 'mention', name: match[1].trim(), userId: Number(match[2]) });
    last = index + match[0].length;
  }
  if (last < body.length) segments.push({ kind: 'text', text: body.slice(last) });
  return segments;
}

/** The admins a body mentions, once each, in order (as the server reads them). */
export function mentionedIds(body: string): number[] {
  const ids: number[] = [];
  for (const segment of parseBody(body))
    if (segment.kind === 'mention' && !ids.includes(segment.userId)) ids.push(segment.userId);
  return ids;
}

/** Names mentions give to admins (`userId` → name), for people the panel cannot list. */
export function mentionNames(bodies: Iterable<string>): Map<number, string> {
  const names = new Map<number, string>();
  for (const body of bodies)
    for (const segment of parseBody(body))
      if (segment.kind === 'mention' && segment.name) names.set(segment.userId, segment.name);
  return names;
}

/** The token that mentions an admin; brackets and parentheses are dropped from the name. */
export function mentionToken(name: string, userId: number): string {
  const clean = name.replace(/[[\]()\n\r]/g, '').trim() || `#${userId}`;
  return `@[${clean}](user:${userId})`;
}

/** A body as plain text, mentions as `@Name` (previews, notifications). */
export function plainBody(body: string): string {
  return parseBody(body)
    .map((segment) => (segment.kind === 'text' ? segment.text : `@${segment.name}`))
    .join('');
}

/**
 * The `@word` being typed at `caret`, if any: `@` at the start or after a space or an
 * opening bracket, followed by up to 30 letters, digits or `.`, `_`, `-`.
 */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(^|[\s([{])@([\p{L}\p{N}._-]{0,30})$/u.exec(before);
  if (!match) return null;
  return { start: caret - match[2].length - 1, query: match[2] };
}

/** Replaces the `@query` from `start` to `caret` with a mention token and a space. */
export function insertMention(
  text: string,
  start: number,
  caret: number,
  token: string,
): { text: string; caret: number } {
  const after = text.slice(caret);
  const spacer = after.startsWith(' ') ? '' : ' ';
  const next = `${text.slice(0, start)}${token}${spacer}${after}`;
  return { text: next, caret: start + token.length + 1 };
}

/** An admin comments can mention, tasks be assigned to, and authors be named after. */
export interface Person {
  id: number;
  name: string;
  email?: string | null;
}

/** `firstname lastname`, else the email (as the server names admins). */
export function personName(user: {
  email?: string | null;
  firstname?: string | null;
  lastname?: string | null;
}): string {
  const full = [user.firstname, user.lastname].filter(Boolean).join(' ').trim();
  return full || user.email || '';
}

/** People whose name or email starts a word with `query` (case and accents ignored). */
export function matchPeople(people: readonly Person[], query: string, limit = 8): Person[] {
  const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const wanted = fold(query.trim());
  const scored = people
    .map((person) => {
      const name = fold(person.name);
      const email = fold(person.email ?? '');
      if (!wanted) return { person, score: 1 };
      if (name.startsWith(wanted) || email.startsWith(wanted)) return { person, score: 3 };
      if (name.split(/\s+/).some((word) => word.startsWith(wanted))) return { person, score: 2 };
      if (name.includes(wanted) || email.includes(wanted)) return { person, score: 1 };
      return { person, score: 0 };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.person.name.localeCompare(b.person.name));
  return scored.slice(0, limit).map((item) => item.person);
}

// ---------------------------------------------------------------------------------------
// Threads and tasks

/** When a thread last saw activity (its last reply, else its first comment). */
export function lastActivity(thread: Thread): string {
  const times = [thread.createdAt, thread.updatedAt, ...thread.replies.map((r) => r.createdAt)];
  return (
    times
      .filter((time): time is string => !!time)
      .sort()
      .at(-1) ?? ''
  );
}

/** Open threads (latest activity first) and resolved ones (latest resolution first). */
export function groupThreads(
  threads: readonly Thread[],
  field?: string | null,
): { open: Thread[]; resolved: Thread[] } {
  const shown = field === undefined ? threads : threads.filter((t) => t.field === field);
  const open = shown
    .filter((thread) => !thread.resolvedAt)
    .sort((a, b) => lastActivity(b).localeCompare(lastActivity(a)) || b.id - a.id);
  const resolved = shown
    .filter((thread) => !!thread.resolvedAt)
    .sort((a, b) => (b.resolvedAt ?? '').localeCompare(a.resolvedAt ?? '') || b.id - a.id);
  return { open, resolved };
}

/** Open threads per field path (threads about the whole entry are left out). */
export function openCountsByField(threads: readonly Thread[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const thread of threads)
    if (!thread.resolvedAt && thread.field)
      counts.set(thread.field, (counts.get(thread.field) ?? 0) + 1);
  return counts;
}

/**
 * A field path for people: `seo.metaTitle` → `Seo › Meta title`, items of repeatable
 * components and dynamic zones by position (`blocks.0.title` → `Blocks › #1 › Title`).
 */
export function fieldLabel(path: string, label: (name: string, depth: number) => string): string {
  return path
    .split('.')
    .map((part, depth) => (/^\d+$/.test(part) ? `#${Number(part) + 1}` : label(part, depth)))
    .join(' › ');
}

/** Open tasks first (earliest due date first, undated last), then done ones (latest first). */
export function sortTasks(tasks: readonly Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
    if (a.status === 'done')
      return (b.completedAt ?? '').localeCompare(a.completedAt ?? '') || b.id - a.id;
    if (a.dueDate !== b.dueDate) {
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    }
    return a.id - b.id;
  });
}

/** Whether an open task is past its due date (`today` as `YYYY-MM-DD`). */
export function isOverdue(task: Task, today: string): boolean {
  return task.status === 'open' && !!task.dueDate && task.dueDate < today;
}

/** Today in the browser's time zone, as `YYYY-MM-DD`. */
export function localToday(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function entryQuery(entry: EntryKey): string {
  return toQuery({ uid: entry.uid, documentId: entry.documentId, locale: entry.locale || null });
}

function entryBody(entry: EntryKey) {
  return {
    uid: entry.uid,
    documentId: entry.documentId,
    ...(entry.locale ? { locale: entry.locale } : {}),
  };
}

/** Comments and tasks API (the `comments` feature; 404 while it is off). */
@Injectable({ providedIn: 'root' })
export class CommentsApi {
  private readonly api = inject(Api);

  threads(entry: EntryKey): Promise<Thread[]> {
    return this.api.get<Thread[]>('/comments', entryQuery(entry));
  }

  add(entry: EntryKey, comment: NewComment): Promise<Comment> {
    return this.api.post<Comment>('/comments', {
      ...entryBody(entry),
      body: comment.body,
      ...(comment.field ? { field: comment.field } : {}),
      ...(comment.parentId ? { parentId: comment.parentId } : {}),
    });
  }

  /** Author only. */
  edit(id: number, body: string): Promise<Comment> {
    return this.api.put<Comment>(`/comments/${id}`, { body });
  }

  /** Author (or a Super Admin); deleting a thread's first comment deletes the thread. */
  remove(id: number): Promise<void> {
    return this.api.delete(`/comments/${id}`);
  }

  resolve(id: number): Promise<Comment> {
    return this.api.post<Comment>(`/comments/${id}/resolve`);
  }

  reopen(id: number): Promise<Comment> {
    return this.api.post<Comment>(`/comments/${id}/reopen`);
  }

  tasks(entry: EntryKey): Promise<Task[]> {
    return this.api.get<Task[]>('/tasks', entryQuery(entry));
  }

  /** Tasks assigned to the caller, across entries. */
  mine(status: TaskStatus | null = 'open'): Promise<Task[]> {
    return this.api.get<Task[]>('/tasks', toQuery({ mine: 'true', status }));
  }

  addTask(entry: EntryKey, task: NewTask): Promise<Task> {
    const body: Record<string, unknown> = { ...entryBody(entry), title: task.title };
    if (task.description) body['description'] = task.description;
    if (task.assigneeId) body['assigneeId'] = task.assigneeId;
    if (task.dueDate) body['dueDate'] = task.dueDate;
    return this.api.post<Task>('/tasks', body);
  }

  /** Creator or assignee. */
  updateTask(id: number, change: TaskChange): Promise<Task> {
    return this.api.put<Task>(`/tasks/${id}`, change);
  }

  /** Creator only. */
  removeTask(id: number): Promise<void> {
    return this.api.delete(`/tasks/${id}`);
  }
}
