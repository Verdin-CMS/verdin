import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCheckboxImports } from '@spartan-ng/helm/checkbox';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { HlmTextareaImports } from '@spartan-ng/helm/textarea';

import { ApiFailure } from '../../../core/api';
import { Task, isOverdue, localToday, sortTasks } from '../../../core/comments';
import { MessageKey } from '../../../core/i18n/keys';
import { I18n } from '../../../core/i18n/i18n';
import { DateControl } from '../fields/controls';
import { EntryCollab } from './entry-collab';

/** The tasks tab of the collaboration panel: the entry's tasks and a form to add one. */
@Component({
  selector: 'vd-tasks-tab',
  imports: [
    NgIcon,
    DateControl,
    HlmButtonImports,
    HlmCheckboxImports,
    HlmFieldImports,
    HlmInputImports,
    HlmNativeSelectImports,
    HlmSpinnerImports,
    HlmTextareaImports,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-4' },
  template: `
    @if (adding()) {
      <form
        class="bg-muted/30 flex flex-col gap-3 rounded-lg border p-3"
        [attr.aria-label]="t('tasks.new')"
        (submit)="$event.preventDefault(); create()"
      >
        <div hlmField>
          <label hlmFieldLabel for="task-title">{{ t('tasks.field.title') }}</label>
          <input
            hlmInput
            id="task-title"
            maxlength="255"
            autocomplete="off"
            [value]="title()"
            (input)="title.set($any($event.target).value)"
          />
        </div>
        <div hlmField>
          <label hlmFieldLabel for="task-description">{{ t('tasks.field.description') }}</label>
          <textarea
            hlmTextarea
            id="task-description"
            rows="2"
            [value]="description()"
            (input)="description.set($any($event.target).value)"
          ></textarea>
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <div hlmField>
            <label hlmFieldLabel for="task-assignee">{{ t('tasks.field.assignee') }}</label>
            <hlm-native-select
              selectId="task-assignee"
              [value]="assignee()"
              (valueChange)="assignee.set($event ?? '')"
            >
              <option hlmNativeSelectOption value="">{{ t('tasks.unassigned') }}</option>
              @for (person of collab.people(); track person.id) {
                <option hlmNativeSelectOption [value]="'' + person.id">
                  {{ collab.isMe(person.id) ? t('tasks.me', { name: person.name }) : person.name }}
                </option>
              }
            </hlm-native-select>
          </div>
          <div hlmField>
            <label hlmFieldLabel for="task-due">{{ t('tasks.field.dueDate') }}</label>
            <vd-date-control inputId="task-due" [(value)]="dueDate" />
          </div>
        </div>
        @if (!collab.listed()) {
          <p class="text-muted-foreground text-xs">{{ t('tasks.assigneeHint') }}</p>
        }
        <div class="flex justify-end gap-2">
          <button hlmBtn variant="ghost" size="sm" type="button" (click)="adding.set(false)">
            {{ t('common.cancel') }}
          </button>
          <button hlmBtn size="sm" type="submit" [disabled]="busy() || !title().trim()">
            @if (busy()) {
              <hlm-spinner />
            }
            {{ t('tasks.create') }}
          </button>
        </div>
      </form>
    } @else {
      <button
        hlmBtn
        variant="outline"
        size="sm"
        type="button"
        class="self-start"
        (click)="startAdding()"
      >
        <ng-icon name="lucidePlus" /> {{ t('tasks.new') }}
      </button>
    }

    @if (collab.tasks() === null) {
      <div class="text-muted-foreground flex items-center gap-2 py-6 text-sm" role="status">
        <hlm-spinner /> {{ t('common.loading') }}
      </div>
    } @else if (!tasks().length) {
      <p class="text-muted-foreground py-6 text-center text-sm">{{ t('tasks.empty') }}</p>
    } @else {
      <ul class="flex flex-col gap-2" [attr.aria-label]="t('tasks.list')">
        @for (task of tasks(); track task.id) {
          @let checkboxId = 'task-done-' + task.id;
          <li class="bg-card flex items-start gap-3 rounded-lg border p-3">
            <hlm-checkbox
              class="mt-0.5"
              [inputId]="checkboxId"
              [checked]="task.status === 'done'"
              [disabled]="busy() || !canUpdate(task)"
              (checkedChange)="setDone(task, $event)"
            />
            <div class="flex min-w-0 flex-1 flex-col gap-1">
              <label
                class="text-sm font-medium"
                [for]="checkboxId"
                [class.line-through]="task.status === 'done'"
                [class.text-muted-foreground]="task.status === 'done'"
                >{{ task.title }}</label
              >
              @if (task.description) {
                <p class="text-muted-foreground text-sm whitespace-pre-wrap">
                  {{ task.description }}
                </p>
              }
              <p class="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span class="inline-flex items-center gap-1">
                  <ng-icon name="lucideUserRound" size="12" aria-hidden="true" />
                  {{
                    task.assigneeId
                      ? t('tasks.assignedTo', { name: collab.nameOf(task.assigneeId) })
                      : t('tasks.unassigned')
                  }}
                </span>
                @if (task.dueDate) {
                  <span
                    class="inline-flex items-center gap-1"
                    [class.text-destructive]="overdue(task)"
                    [class.font-medium]="overdue(task)"
                  >
                    <ng-icon name="lucideCalendar" size="12" aria-hidden="true" />
                    {{
                      t(overdue(task) ? 'tasks.overdue' : 'tasks.due', {
                        date: i18n.formatDate(task.dueDate, 'date'),
                      })
                    }}
                  </span>
                }
                @if (task.createdBy) {
                  <span>{{ t('tasks.createdBy', { name: collab.nameOf(task.createdBy) }) }}</span>
                }
              </p>
            </div>
            @if (canDelete(task)) {
              <button
                hlmBtn
                variant="ghost"
                size="icon-xs"
                type="button"
                class="hover:text-destructive"
                [disabled]="busy()"
                [attr.aria-label]="t('tasks.delete', { title: task.title })"
                [title]="t('tasks.delete', { title: task.title })"
                (click)="remove(task)"
              >
                <ng-icon name="lucideTrash2" />
              </button>
            }
          </li>
        }
      </ul>
    }
  `,
})
export class TasksTab {
  protected readonly collab = inject(EntryCollab);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;

  protected readonly adding = signal(false);
  protected readonly title = signal('');
  protected readonly description = signal('');
  /** Select value: an admin id, or `''` for nobody. */
  protected readonly assignee = signal('');
  protected readonly dueDate = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected readonly tasks = computed(() => sortTasks(this.collab.tasks() ?? []));
  private readonly today = localToday();

  protected overdue(task: Task): boolean {
    return isOverdue(task, this.today);
  }

  /** The creator or the assignee (or a Super Admin). */
  protected canUpdate(task: Task): boolean {
    return (
      this.collab.superAdmin ||
      this.collab.isMe(task.createdBy) ||
      this.collab.isMe(task.assigneeId)
    );
  }

  protected canDelete(task: Task): boolean {
    return this.collab.superAdmin || this.collab.isMe(task.createdBy);
  }

  protected startAdding(): void {
    this.title.set('');
    this.description.set('');
    this.assignee.set('');
    this.dueDate.set(null);
    this.adding.set(true);
    setTimeout(() => document.getElementById('task-title')?.focus());
  }

  protected async create(): Promise<void> {
    const title = this.title().trim();
    if (!title || this.busy()) return;
    await this.run(async () => {
      await this.collab.addTask({
        title,
        description: this.description().trim() || null,
        assigneeId: this.assignee() ? Number(this.assignee()) : null,
        dueDate: this.dueDate(),
      });
      this.adding.set(false);
      toast.success(this.t('tasks.toast.created'));
    }, 'tasks.toast.createError');
  }

  protected async setDone(task: Task, done: boolean): Promise<void> {
    const status = done ? 'done' : 'open';
    if (status === task.status) return;
    await this.run(() => this.collab.updateTask(task.id, { status }), 'tasks.toast.updateError');
  }

  protected async remove(task: Task): Promise<void> {
    await this.run(async () => {
      await this.collab.removeTask(task.id);
      toast.success(this.t('tasks.toast.deleted'));
    }, 'tasks.toast.deleteError');
  }

  private async run(action: () => Promise<void>, failure: MessageKey): Promise<void> {
    this.busy.set(true);
    try {
      await action();
    } catch (error) {
      toast.error(this.t(failure), { description: ApiFailure.from(error).message });
    } finally {
      this.busy.set(false);
    }
  }
}
