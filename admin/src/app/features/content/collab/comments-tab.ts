import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';

import { ApiFailure } from '../../../core/api';
import { Comment, Thread, groupThreads } from '../../../core/comments';
import { I18n } from '../../../core/i18n/i18n';
import { initialsOf } from '../../../core/presence';
import { EntryCollab } from './entry-collab';
import { MentionInput } from './mention-input';
import { MentionText } from './mention-text';

/** The comments tab of the collaboration panel: threads, replies and the composer. */
@Component({
  selector: 'vd-comments-tab',
  imports: [
    NgTemplateOutlet,
    NgIcon,
    MentionInput,
    MentionText,
    HlmAlertDialogImports,
    HlmBadgeImports,
    HlmButtonImports,
    HlmSpinnerImports,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-4' },
  template: `
    @if (collab.field(); as field) {
      <div class="bg-muted/50 flex items-center gap-2 rounded-md px-3 py-2 text-sm">
        <ng-icon name="lucideMessageSquare" class="text-muted-foreground shrink-0" />
        <span class="min-w-0 flex-1 truncate">
          {{ t('comments.field.about', { field: collab.label(field) }) }}
        </span>
        <button hlmBtn variant="ghost" size="sm" type="button" (click)="collab.field.set(null)">
          {{ t('comments.field.showAll') }}
        </button>
      </div>
    }

    <form
      class="flex flex-col gap-2"
      [attr.aria-label]="t('comments.composer.label')"
      (submit)="$event.preventDefault(); post()"
    >
      <vd-mention-input
        #composer
        inputId="comment-composer"
        [label]="
          collab.field()
            ? t('comments.composer.fieldLabel', { field: collab.label(collab.field()!) })
            : t('comments.composer.label')
        "
        [placeholder]="t('comments.composer.placeholder')"
        [people]="collab.people()"
        [disabled]="busy()"
        [(value)]="draft"
        (submitted)="post()"
      />
      <div class="flex items-center justify-between gap-2">
        <span class="text-muted-foreground text-xs">
          {{ collab.listed() ? t('comments.mention.hint') : t('comments.mention.hintKnown') }}
        </span>
        <button hlmBtn size="sm" type="submit" [disabled]="busy() || !draft().trim()">
          @if (busy()) {
            <hlm-spinner />
          } @else {
            <ng-icon name="lucideSend" />
          }
          {{ t('comments.composer.send') }}
        </button>
      </div>
    </form>

    @if (collab.error(); as error) {
      <p class="text-destructive text-sm" role="alert">{{ error }}</p>
    }

    @if (collab.threads() === null) {
      <div class="text-muted-foreground flex items-center gap-2 py-6 text-sm" role="status">
        <hlm-spinner /> {{ t('common.loading') }}
      </div>
    } @else {
      @let groups = grouped();
      @if (!groups.open.length && !groups.resolved.length) {
        <p class="text-muted-foreground py-6 text-center text-sm">
          {{ collab.field() ? t('comments.emptyField') : t('comments.empty') }}
        </p>
      }
      <ul class="flex flex-col gap-3" [attr.aria-label]="t('comments.openThreads')">
        @for (thread of groups.open; track thread.id) {
          <li>
            <ng-container
              *ngTemplateOutlet="threadCard; context: { $implicit: thread }"
            ></ng-container>
          </li>
        }
      </ul>
      @if (groups.resolved.length) {
        <div class="flex flex-col gap-3 border-t pt-3">
          <button
            hlmBtn
            variant="ghost"
            size="sm"
            type="button"
            class="self-start"
            aria-controls="resolved-threads"
            [attr.aria-expanded]="showResolved()"
            (click)="showResolved.set(!showResolved())"
          >
            <ng-icon
              [name]="showResolved() ? 'lucideChevronDown' : 'lucideChevronRight'"
              class="rtl:-scale-x-100"
            />
            {{ t('comments.resolvedCount', { count: groups.resolved.length }) }}
          </button>
          <ul
            id="resolved-threads"
            class="flex flex-col gap-3"
            [hidden]="!showResolved()"
            [attr.aria-label]="t('comments.resolvedThreads')"
          >
            @if (showResolved()) {
              @for (thread of groups.resolved; track thread.id) {
                <li>
                  <ng-container
                    *ngTemplateOutlet="threadCard; context: { $implicit: thread }"
                  ></ng-container>
                </li>
              }
            }
          </ul>
        </div>
      }
    }

    <ng-template #threadCard let-thread>
      <article
        class="bg-card flex flex-col gap-3 rounded-lg border p-3"
        [class.opacity-80]="thread.resolvedAt"
        [attr.aria-label]="t('comments.threadBy', { name: collab.nameOf(thread.authorId) })"
      >
        @if (thread.field && !collab.field()) {
          <button
            type="button"
            class="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 self-start text-xs"
            [attr.aria-label]="t('comments.field.filter', { field: collab.label(thread.field) })"
            (click)="collab.field.set(thread.field)"
          >
            <ng-icon name="lucideAtSign" size="12" /> {{ collab.label(thread.field) }}
          </button>
        }
        <ng-container
          *ngTemplateOutlet="commentBody; context: { $implicit: thread, root: true }"
        ></ng-container>
        @if (thread.replies.length) {
          <ul class="flex flex-col gap-3 border-s ps-3" [attr.aria-label]="t('comments.replies')">
            @for (reply of thread.replies; track reply.id) {
              <li>
                <ng-container
                  *ngTemplateOutlet="commentBody; context: { $implicit: reply, root: false }"
                ></ng-container>
              </li>
            }
          </ul>
        }
        @if (thread.resolvedAt) {
          <p class="text-muted-foreground flex items-center gap-1.5 text-xs">
            <ng-icon name="lucideCircleCheck" size="14" class="text-emerald-600" />
            {{
              t('comments.resolvedBy', {
                name: collab.nameOf(thread.resolvedBy),
                when: i18n.formatRelative(thread.resolvedAt),
              })
            }}
          </p>
        }
        @if (replying() === thread.id) {
          <form
            class="flex flex-col gap-2"
            (submit)="$event.preventDefault(); reply(thread)"
            [attr.aria-label]="t('comments.reply')"
          >
            <vd-mention-input
              #replyInput
              [inputId]="'reply-' + thread.id"
              [label]="t('comments.replyLabel', { name: collab.nameOf(thread.authorId) })"
              [placeholder]="t('comments.replyPlaceholder')"
              [people]="collab.people()"
              [disabled]="busy()"
              [(value)]="replyDraft"
              (submitted)="reply(thread)"
            />
            <div class="flex justify-end gap-2">
              <button hlmBtn variant="ghost" size="sm" type="button" (click)="replying.set(null)">
                {{ t('common.cancel') }}
              </button>
              <button hlmBtn size="sm" type="submit" [disabled]="busy() || !replyDraft().trim()">
                {{ t('comments.reply') }}
              </button>
            </div>
          </form>
        } @else {
          <div class="flex flex-wrap items-center gap-1">
            @if (!thread.resolvedAt) {
              <button hlmBtn variant="ghost" size="sm" type="button" (click)="startReply(thread)">
                <ng-icon name="lucideMessageSquareReply" /> {{ t('comments.reply') }}
              </button>
            }
            <button
              hlmBtn
              variant="ghost"
              size="sm"
              type="button"
              [disabled]="busy()"
              (click)="toggleResolved(thread)"
            >
              @if (thread.resolvedAt) {
                <ng-icon name="lucideRotateCcw" /> {{ t('comments.reopen') }}
              } @else {
                <ng-icon name="lucideCheck" /> {{ t('comments.resolve') }}
              }
            </button>
          </div>
        }
      </article>
    </ng-template>

    <ng-template #commentBody let-comment let-root="root">
      <div class="flex gap-2.5">
        <span
          class="bg-primary/10 text-primary inline-flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-medium"
          aria-hidden="true"
          >{{ initials(collab.nameOf(comment.authorId)) }}</span
        >
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <div class="flex flex-wrap items-baseline gap-x-2">
            <span class="text-sm font-medium">{{
              comment.authorId === null
                ? t('comments.deletedAuthor')
                : collab.nameOf(comment.authorId)
            }}</span>
            <span
              class="text-muted-foreground text-xs"
              [title]="i18n.formatDate(comment.createdAt, 'long')"
              >{{ i18n.formatRelative(comment.createdAt) }}</span
            >
            @if (collab.isMe(comment.authorId) || collab.superAdmin) {
              <span class="ms-auto flex items-center">
                @if (collab.isMe(comment.authorId)) {
                  <button
                    hlmBtn
                    variant="ghost"
                    size="icon-xs"
                    type="button"
                    [attr.aria-label]="t('comments.edit')"
                    [title]="t('comments.edit')"
                    (click)="startEdit(comment)"
                  >
                    <ng-icon name="lucidePencil" />
                  </button>
                }
                <button
                  hlmBtn
                  variant="ghost"
                  size="icon-xs"
                  type="button"
                  class="hover:text-destructive"
                  [attr.aria-label]="root ? t('comments.deleteThread') : t('comments.delete')"
                  [title]="root ? t('comments.deleteThread') : t('comments.delete')"
                  (click)="deleting.set(comment)"
                >
                  <ng-icon name="lucideTrash2" />
                </button>
              </span>
            }
          </div>
          @if (editing() === comment.id) {
            <form
              class="flex flex-col gap-2"
              (submit)="$event.preventDefault(); saveEdit(comment)"
              [attr.aria-label]="t('comments.edit')"
            >
              <vd-mention-input
                #editInput
                [inputId]="'edit-' + comment.id"
                [label]="t('comments.editLabel')"
                [people]="collab.people()"
                [disabled]="busy()"
                [(value)]="editDraft"
                (submitted)="saveEdit(comment)"
              />
              <div class="flex justify-end gap-2">
                <button hlmBtn variant="ghost" size="sm" type="button" (click)="editing.set(null)">
                  {{ t('common.cancel') }}
                </button>
                <button hlmBtn size="sm" type="submit" [disabled]="busy() || !editDraft().trim()">
                  {{ t('common.save') }}
                </button>
              </div>
            </form>
          } @else {
            <vd-mention-text [body]="comment.body" [me]="me()" />
          }
        </div>
      </div>
    </ng-template>

    <hlm-alert-dialog [state]="deleting() ? 'open' : 'closed'" (closed)="deleting.set(null)">
      <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx">
        @if (deleting(); as comment) {
          <hlm-alert-dialog-header>
            <h2 hlmAlertDialogTitle>
              {{ comment.parentId ? t('comments.deleteTitle') : t('comments.deleteThreadTitle') }}
            </h2>
            <p hlmAlertDialogDescription>
              {{ comment.parentId ? t('comments.deleteHint') : t('comments.deleteThreadHint') }}
            </p>
          </hlm-alert-dialog-header>
          <hlm-alert-dialog-footer>
            <button hlmAlertDialogCancel (click)="ctx.close()">{{ t('common.cancel') }}</button>
            <button
              hlmAlertDialogAction
              variant="destructive"
              (click)="ctx.close(); remove(comment)"
            >
              {{ t('common.delete') }}
            </button>
          </hlm-alert-dialog-footer>
        }
      </hlm-alert-dialog-content>
    </hlm-alert-dialog>
  `,
})
export class CommentsTab {
  protected readonly collab = inject(EntryCollab);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  protected readonly initials = initialsOf;

  protected readonly draft = signal('');
  protected readonly replyDraft = signal('');
  protected readonly editDraft = signal('');
  protected readonly replying = signal<number | null>(null);
  protected readonly editing = signal<number | null>(null);
  protected readonly deleting = signal<Comment | null>(null);
  protected readonly showResolved = signal(false);
  protected readonly busy = signal(false);

  private readonly composer = viewChild<MentionInput>('composer');
  private readonly replyInput = viewChild<MentionInput>('replyInput');
  private readonly editInput = viewChild<MentionInput>('editInput');

  protected readonly me = this.collab.me;
  protected readonly grouped = computed(() => {
    const threads = this.collab.threads() ?? [];
    const field = this.collab.field();
    return groupThreads(threads, field === null ? undefined : field);
  });

  constructor() {
    // Opening the panel on a field puts the caret in the composer.
    effect(() => {
      if (!this.collab.focusRequest()) return;
      untracked(() => setTimeout(() => this.composer()?.focus()));
    });
  }

  protected startReply(thread: Thread): void {
    this.replyDraft.set('');
    this.replying.set(thread.id);
    setTimeout(() => this.replyInput()?.focus());
  }

  protected startEdit(comment: Comment): void {
    this.editDraft.set(comment.body);
    this.editing.set(comment.id);
    setTimeout(() => this.editInput()?.focus());
  }

  protected async post(): Promise<void> {
    const body = this.draft().trim();
    if (!body || this.busy()) return;
    await this.run(async () => {
      await this.collab.addComment({ body, field: this.collab.field() });
      this.draft.set('');
    }, 'comments.toast.postError');
  }

  protected async reply(thread: Thread): Promise<void> {
    const body = this.replyDraft().trim();
    if (!body || this.busy()) return;
    await this.run(async () => {
      await this.collab.addComment({ body, parentId: thread.id });
      this.replyDraft.set('');
      this.replying.set(null);
    }, 'comments.toast.postError');
  }

  protected async saveEdit(comment: Comment): Promise<void> {
    const body = this.editDraft().trim();
    if (!body || this.busy()) return;
    await this.run(async () => {
      await this.collab.editComment(comment.id, body);
      this.editing.set(null);
    }, 'comments.toast.editError');
  }

  protected async remove(comment: Comment): Promise<void> {
    await this.run(async () => {
      await this.collab.removeComment(comment.id);
      toast.success(
        this.t(comment.parentId ? 'comments.toast.deleted' : 'comments.toast.threadDeleted'),
      );
    }, 'comments.toast.deleteError');
    setTimeout(() => this.composer()?.focus());
  }

  protected async toggleResolved(thread: Thread): Promise<void> {
    const resolve = !thread.resolvedAt;
    await this.run(async () => {
      await this.collab.setResolved(thread.id, resolve);
      toast.success(this.t(resolve ? 'comments.toast.resolved' : 'comments.toast.reopened'));
    }, 'comments.toast.resolveError');
  }

  private async run(
    action: () => Promise<void>,
    failure:
      | 'comments.toast.postError'
      | 'comments.toast.editError'
      | 'comments.toast.deleteError'
      | 'comments.toast.resolveError',
  ): Promise<void> {
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
