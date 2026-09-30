import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';

import { Api, ApiFailure } from '../../../core/api';
import { Auth } from '../../../core/auth';
import {
  CommentsApi,
  NewComment,
  NewTask,
  Person,
  Task,
  TaskChange,
  Thread,
  mentionNames,
  openCountsByField,
  personName,
} from '../../../core/comments';
import { Features } from '../../../core/features';
import { EntryKey, Realtime, Viewer } from '../../../core/realtime';
import { ReviewWorkflows } from '../../../core/review';
import { AdminUser } from '../../../core/types';

export type CollabTab = 'comments' | 'tasks';

/** Changes to an entry's comments and tasks are refetched after this pause (bursts). */
const REFRESH_DELAY = 300;

/**
 * The comments and tasks of the entry an editor has open, shared by its panel and the
 * comment buttons next to field labels. Provided by the entry editor; refetched when the
 * realtime stream announces `comment.*` and `task.*` events for the entry.
 */
@Injectable()
export class EntryCollab {
  private readonly comments = inject(CommentsApi);
  private readonly api = inject(Api);
  private readonly auth = inject(Auth);
  private readonly features = inject(Features);
  private readonly review = inject(ReviewWorkflows);
  private readonly realtime = inject(Realtime);

  /** The `comments` feature is on. */
  readonly on = computed(() => this.features.enabled('comments'));
  readonly entry = signal<EntryKey | null>(null);
  /** `null` until loaded. */
  readonly threads = signal<Thread[] | null>(null);
  readonly tasks = signal<Task[] | null>(null);
  readonly error = signal<string | null>(null);

  /** The panel: open, its tab, and the field it is narrowed to (`null`: whole entry). */
  readonly panelOpen = signal(false);
  readonly tab = signal<CollabTab>('comments');
  readonly field = signal<string | null>(null);
  /** The caller's id. */
  readonly me = computed(() => this.auth.user()?.id ?? null);
  /** How field paths read (set by the editor, which knows the edit view's labels). */
  readonly labeler = signal<(path: string) => string>((path) => path);

  /** Bumped to move focus to the composer (after opening on a field). */
  readonly focusRequest = signal(0);
  /** Changes other admins made, for screen readers (`aria-live`); `seq` tells them apart. */
  readonly incoming = signal<{ comments: boolean; tasks: boolean; seq: number } | null>(null);

  readonly counts = computed(() => openCountsByField(this.threads() ?? []));
  readonly openThreads = computed(
    () => (this.threads() ?? []).filter((thread) => !thread.resolvedAt).length,
  );
  readonly openTasks = computed(
    () => (this.tasks() ?? []).filter((task) => task.status === 'open').length,
  );

  /** Admins listed for mentions and assignment (when the caller may list them). */
  private readonly directory = signal<Person[]>([]);
  private readonly viewers = signal<Viewer[]>([]);
  private directoryLoaded = false;
  /** Everyone the panel can name: listed admins, presence, mentions, and the caller. */
  readonly people = computed<Person[]>(() => {
    const byId = new Map<number, Person>();
    const bodies = (this.threads() ?? []).flatMap((thread) => [
      thread.body,
      ...thread.replies.map((reply) => reply.body),
    ]);
    for (const [id, name] of mentionNames(bodies)) byId.set(id, { id, name });
    for (const viewer of this.viewers())
      byId.set(viewer.userId, { id: viewer.userId, name: viewer.name });
    for (const person of this.directory()) byId.set(person.id, person);
    const me = this.auth.user();
    if (me) byId.set(me.id, { id: me.id, name: personName(me), email: me.email });
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  });
  /** Whether the caller could list admins (otherwise only known ones are offered). */
  readonly listed = signal(false);

  private subscription: Subscription | null = null;
  private release: (() => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private requests = 0;
  private readonly pending = new Set<'comments' | 'tasks'>();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.bind(null));
  }

  /** Follows `entry` (`null`: none, e.g. a new entry). */
  bind(entry: EntryKey | null): void {
    const current = this.entry();
    const same =
      !!entry &&
      !!current &&
      entry.uid === current.uid &&
      entry.documentId === current.documentId &&
      (entry.locale ?? '') === (current.locale ?? '');
    if (same) return;
    this.subscription?.unsubscribe();
    this.subscription = null;
    this.release?.();
    this.release = null;
    clearTimeout(this.timer);
    this.entry.set(entry);
    this.threads.set(null);
    this.tasks.set(null);
    this.error.set(null);
    if (!entry || !this.on()) return;
    this.release = this.realtime.retain();
    this.subscription = this.realtime.entry(entry).subscribe((message) => {
      if (message.event.startsWith('comment.') || message.event.startsWith('task.'))
        this.scheduleRefresh(message.event.startsWith('task.') ? 'tasks' : 'comments');
    });
    this.subscription.add(this.realtime.resync.subscribe(() => this.scheduleRefresh()));
    void this.refresh();
  }

  /** Who else is on the entry (their names help name comment authors). */
  setViewers(viewers: Viewer[]): void {
    this.viewers.set(viewers);
  }

  /** The name of an admin (`#12` when unknown to this admin). */
  nameOf(id: number | null | undefined): string {
    if (id === null || id === undefined) return '';
    return this.people().find((person) => person.id === id)?.name ?? `#${id}`;
  }

  /** A field path for people (`seo.metaTitle` → `SEO › Meta title`). */
  label(path: string): string {
    return this.labeler()(path);
  }

  isMe(id: number | null | undefined): boolean {
    return id !== null && id !== undefined && id === this.auth.user()?.id;
  }

  get superAdmin(): boolean {
    return this.auth.permissions().superAdmin;
  }

  /** Opens the panel, on a field's threads when given (a new thread is then about it). */
  open(tab: CollabTab = 'comments', field: string | null = null): void {
    this.tab.set(tab);
    this.field.set(field);
    this.panelOpen.set(true);
    void this.loadDirectory();
    if (field !== null) this.focusRequest.update((count) => count + 1);
  }

  close(): void {
    this.panelOpen.set(false);
  }

  private scheduleRefresh(what?: 'comments' | 'tasks'): void {
    if (what) this.pending.add(what);
    else {
      this.pending.add('comments');
      this.pending.add('tasks');
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const wanted = [...this.pending];
      this.pending.clear();
      void this.refresh(wanted, true);
    }, REFRESH_DELAY);
  }

  /** Reloads threads and tasks (or some of them). */
  async refresh(
    what: ('comments' | 'tasks')[] = ['comments', 'tasks'],
    remote = false,
  ): Promise<void> {
    const entry = this.entry();
    if (!entry || !this.on()) return;
    const request = ++this.requests;
    try {
      const [threads, tasks] = await Promise.all([
        what.includes('comments') ? this.comments.threads(entry) : Promise.resolve(null),
        what.includes('tasks') ? this.comments.tasks(entry) : Promise.resolve(null),
      ]);
      if (request !== this.requests || this.entry() !== entry) return;
      if (threads) this.threads.set(threads);
      if (tasks) this.tasks.set(tasks);
      this.error.set(null);
      if (remote)
        this.incoming.update((last) => ({
          comments: what.includes('comments'),
          tasks: what.includes('tasks'),
          seq: (last?.seq ?? 0) + 1,
        }));
    } catch (error) {
      if (request === this.requests) this.error.set(ApiFailure.from(error).message);
    }
  }

  async addComment(comment: NewComment): Promise<void> {
    const entry = this.entry();
    if (!entry) return;
    await this.comments.add(entry, comment);
    await this.refresh(['comments']);
  }

  async editComment(id: number, body: string): Promise<void> {
    await this.comments.edit(id, body);
    await this.refresh(['comments']);
  }

  async removeComment(id: number): Promise<void> {
    await this.comments.remove(id);
    await this.refresh(['comments']);
  }

  async setResolved(id: number, resolved: boolean): Promise<void> {
    await (resolved ? this.comments.resolve(id) : this.comments.reopen(id));
    await this.refresh(['comments']);
  }

  async addTask(task: NewTask): Promise<void> {
    const entry = this.entry();
    if (!entry) return;
    await this.comments.addTask(entry, task);
    await this.refresh(['tasks']);
  }

  async updateTask(id: number, change: TaskChange): Promise<void> {
    const updated = await this.comments.updateTask(id, change);
    this.tasks.update((tasks) => tasks?.map((task) => (task.id === id ? updated : task)) ?? null);
  }

  async removeTask(id: number): Promise<void> {
    await this.comments.removeTask(id);
    this.tasks.update((tasks) => tasks?.filter((task) => task.id !== id) ?? null);
  }

  /**
   * Admins to mention and assign: every admin with `users.manage`, else those who may
   * edit the type (review workflows), else only the known ones.
   */
  private async loadDirectory(): Promise<void> {
    const entry = this.entry();
    if (this.directoryLoaded || !entry) return;
    this.directoryLoaded = true;
    try {
      if (this.auth.can('users.manage')) {
        const users = await this.api.listAll<AdminUser>('/users');
        this.directory.set(
          users
            .filter((user) => user.isActive)
            .map((user) => ({ id: user.id, name: personName(user), email: user.email })),
        );
        this.listed.set(true);
      } else if (
        this.features.enabled('review') &&
        this.auth.canInLocale('content.update', entry.uid, entry.locale || null)
      ) {
        const users = await this.review.assignees(entry.uid);
        this.directory.set(
          users.map((user) => ({ id: user.id, name: personName(user), email: user.email })),
        );
        this.listed.set(true);
      }
    } catch {
      // Only the known admins are offered.
    }
  }
}
