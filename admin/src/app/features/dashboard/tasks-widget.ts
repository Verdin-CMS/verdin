import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';

import { Api, ApiFailure, toQuery } from '../../core/api';
import { ContentDocuments } from '../../core/documents';
import { CommentsApi, Task, isOverdue, localToday, sortTasks } from '../../core/comments';
import { WidgetConfig } from '../../core/dashboard';
import { Features } from '../../core/features';
import { I18n } from '../../core/i18n/i18n';
import { Realtime } from '../../core/realtime';
import { Schema } from '../../core/schema';
import { ContentType, Document } from '../../core/types';
import { documentLabel } from '../content/fields/model';

/** Tasks shown when the widget sets no limit. */
const DEFAULT_LIMIT = 8;

interface Row {
  task: Task;
  type: ContentType;
  entry: string;
  link: unknown[];
  query: Record<string, string>;
}

/** Tasks grouped by type and locale: each group needs one lookup of entry titles. */
export function groupTasks(tasks: readonly Task[]): Map<string, Task[]> {
  const groups = new Map<string, Task[]>();
  for (const task of tasks) {
    const key = `${task.uid}|${task.locale}`;
    groups.set(key, [...(groups.get(key) ?? []), task]);
  }
  return groups;
}

/** "My tasks": open tasks assigned to the viewer (the `comments` feature), due first. */
@Component({
  selector: 'vd-tasks-widget',
  imports: [RouterLink, NgIcon, HlmBadgeImports, HlmButtonImports, HlmSkeletonImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!on()) {
      <p class="text-muted-foreground py-6 text-center text-sm">{{ t('tasks.widget.off') }}</p>
    } @else if (rows() === null) {
      <div class="flex flex-col gap-2">
        @for (row of [1, 2, 3]; track row) {
          <hlm-skeleton class="h-8 w-full" />
        }
      </div>
    } @else if (rows()!.length === 0) {
      <p class="text-muted-foreground py-6 text-center text-sm">{{ t('tasks.widget.empty') }}</p>
    } @else {
      <ul class="-mx-2 flex flex-col" [attr.aria-label]="t('tasks.widget.title')">
        @for (row of rows(); track row.task.id) {
          <li class="flex items-center gap-1">
            <a
              class="hover:bg-accent flex min-w-0 flex-1 flex-col rounded-md px-2 py-1.5 text-sm transition-colors"
              [routerLink]="row.link"
              [queryParams]="row.query"
            >
              <span class="truncate font-medium">{{ row.task.title }}</span>
              <span class="text-muted-foreground flex min-w-0 items-center gap-2 text-xs">
                <span class="truncate">{{ row.entry }}</span>
                <span hlmBadge variant="secondary" class="shrink-0 font-normal">{{
                  row.type.displayName
                }}</span>
                @if (row.task.locale) {
                  <span class="shrink-0 font-mono">{{ row.task.locale }}</span>
                }
                @if (row.task.dueDate) {
                  <span
                    class="ms-auto shrink-0"
                    [class.text-destructive]="overdue(row.task)"
                    [class.font-medium]="overdue(row.task)"
                    >{{
                      t(overdue(row.task) ? 'tasks.overdue' : 'tasks.due', {
                        date: i18n.formatDate(row.task.dueDate, 'date'),
                      })
                    }}</span
                  >
                }
              </span>
            </a>
            <button
              hlmBtn
              variant="ghost"
              size="icon-sm"
              type="button"
              class="shrink-0"
              [disabled]="busy() === row.task.id"
              [attr.aria-label]="t('tasks.markDone', { title: row.task.title })"
              [title]="t('tasks.markDone', { title: row.task.title })"
              (click)="done(row.task)"
            >
              <ng-icon name="lucideCheck" />
            </button>
          </li>
        }
      </ul>
      @if (total() > rows()!.length) {
        <p class="text-muted-foreground text-xs">
          {{ t('tasks.widget.more', { count: total() - rows()!.length }) }}
        </p>
      }
    }
  `,
})
export class TasksWidget {
  private readonly api = inject(Api);
  private readonly documents = inject(ContentDocuments);
  private readonly comments = inject(CommentsApi);
  private readonly schema = inject(Schema);
  private readonly features = inject(Features);
  private readonly realtime = inject(Realtime);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;

  readonly config = input<WidgetConfig>({});

  protected readonly on = computed(() => this.features.enabled('comments'));
  private readonly limit = computed(() =>
    Math.min(Math.max(this.config().limit ?? DEFAULT_LIMIT, 1), 20),
  );
  /** `null` while loading. */
  protected readonly rows = signal<Row[] | null>(null);
  protected readonly total = signal(0);
  protected readonly busy = signal<number | null>(null);
  private readonly today = localToday();
  private requests = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    effect(() => {
      if (!this.on()) return;
      const limit = this.limit();
      untracked(() => void this.load(limit));
    });
    // Tasks assigned, changed or done elsewhere show up without a reload.
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(this.realtime.retain());
    destroyRef.onDestroy(() => clearTimeout(this.timer));
    this.realtime.messages.pipe(takeUntilDestroyed(destroyRef)).subscribe((message) => {
      if (message.event.startsWith('task.')) this.reloadSoon();
    });
    this.realtime.resync.pipe(takeUntilDestroyed(destroyRef)).subscribe(() => this.reloadSoon());
  }

  protected overdue(task: Task): boolean {
    return isOverdue(task, this.today);
  }

  private reloadSoon(): void {
    if (!this.on()) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.load(this.limit(), true), 500);
  }

  protected async done(task: Task): Promise<void> {
    this.busy.set(task.id);
    try {
      await this.comments.updateTask(task.id, { status: 'done' });
      toast.success(this.t('tasks.toast.done', { title: task.title }));
      await this.load(this.limit(), true);
    } catch (error) {
      toast.error(this.t('tasks.toast.updateError'), {
        description: ApiFailure.from(error).message,
      });
    } finally {
      this.busy.set(null);
    }
  }

  private async load(limit: number, quiet = false): Promise<void> {
    const request = ++this.requests;
    if (!quiet) this.rows.set(null);
    try {
      const tasks = (await this.comments.mine('open')).filter((task) => this.schema.type(task.uid));
      const shown = sortTasks(tasks).slice(0, limit);
      const groups = await Promise.all(
        [...groupTasks(shown).values()].map((group) => this.describe(group)),
      );
      if (request !== this.requests) return;
      const order = new Map(shown.map((task, index) => [task.id, index]));
      this.rows.set(
        groups.flat().sort((a, b) => (order.get(a.task.id) ?? 0) - (order.get(b.task.id) ?? 0)),
      );
      this.total.set(tasks.length);
    } catch {
      if (request === this.requests) this.rows.set([]);
    }
  }

  /** Titles of one type's (and locale's) entries. */
  private async describe(tasks: Task[]): Promise<Row[]> {
    const type = this.schema.type(tasks[0].uid)!;
    const locale = tasks[0].locale || null;
    const ids = [...new Set(tasks.map((task) => task.documentId))];
    const documents = await this.documents
      .list(
        type.uid,
        toQuery({
          filters: { documentId: { $in: Object.fromEntries(ids.map((id, i) => [i, id])) } },
          pagination: { pageSize: ids.length },
          status: type.draftAndPublish ? 'draft' : undefined,
          locale,
        }),
      )
      .then((response) => response.data)
      .catch(() => [] as Document[]);
    const byId = new Map(documents.map((document) => [document.documentId, document]));
    const titleField = this.schema.titleField(type);
    return tasks.map((task) => {
      const document = byId.get(task.documentId);
      return {
        task,
        type,
        entry: document ? documentLabel(document, titleField) : task.documentId,
        link:
          type.kind === 'singleType'
            ? ['/single', type.uid]
            : ['/content', type.uid, task.documentId],
        query: task.locale ? { locale: task.locale } : ({} as Record<string, string>),
      };
    });
  }
}
