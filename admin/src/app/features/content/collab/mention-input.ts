import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { HlmTextareaImports } from '@spartan-ng/helm/textarea';

import {
  MAX_COMMENT,
  Person,
  insertMention,
  matchPeople,
  mentionQuery,
  mentionToken,
} from '../../../core/comments';
import { I18n } from '../../../core/i18n/i18n';

let nextId = 0;

/**
 * A comment textarea with an `@` autocomplete of admins: typing `@` lists them, arrows
 * move, Enter or Tab picks one (written `@[Name](user:12)`), Escape closes the list.
 * Ctrl/⌘ + Enter submits.
 */
@Component({
  selector: 'vd-mention-input',
  imports: [HlmTextareaImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'relative block' },
  template: `
    <textarea
      #area
      hlmTextarea
      rows="2"
      role="combobox"
      aria-autocomplete="list"
      [id]="inputId()"
      [attr.aria-label]="label()"
      [attr.aria-describedby]="hintId"
      [attr.aria-expanded]="suggestions().length > 0"
      [attr.aria-controls]="listId"
      [attr.aria-activedescendant]="suggestions().length ? optionId(active()) : null"
      [attr.maxlength]="max"
      [placeholder]="placeholder()"
      [disabled]="disabled()"
      [value]="value()"
      (input)="onInput($event)"
      (keydown)="onKeydown($event)"
      (click)="track()"
      (blur)="close()"
    ></textarea>
    <span class="sr-only" [id]="hintId">{{ t('comments.composer.hint') }}</span>
    <ul
      role="listbox"
      class="bg-popover text-popover-foreground absolute inset-x-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-md border p-1 shadow-md"
      [id]="listId"
      [attr.aria-label]="t('comments.mention.list')"
      [hidden]="!suggestions().length"
    >
      @for (person of suggestions(); track person.id; let index = $index) {
        <li
          role="option"
          class="flex cursor-pointer flex-col rounded-sm px-2 py-1.5 text-sm"
          [id]="optionId(index)"
          [class.bg-accent]="index === active()"
          [attr.aria-selected]="index === active()"
          (mousedown)="$event.preventDefault(); pick(person)"
          (mouseenter)="active.set(index)"
        >
          <span class="font-medium">{{ person.name }}</span>
          @if (person.email && person.email !== person.name) {
            <span class="text-muted-foreground text-xs">{{ person.email }}</span>
          }
        </li>
      }
    </ul>
  `,
})
export class MentionInput {
  protected readonly t = inject(I18n).t;

  readonly value = model('');
  readonly people = input<readonly Person[]>([]);
  readonly label = input.required<string>();
  readonly placeholder = input('');
  readonly disabled = input(false);
  readonly inputId = input(`mention-input-${nextId}`);
  readonly submitted = output<void>();

  protected readonly max = MAX_COMMENT;
  private readonly uid = nextId++;
  protected readonly hintId = `mention-hint-${this.uid}`;
  protected readonly listId = `mention-list-${this.uid}`;
  private readonly area = viewChild.required<ElementRef<HTMLTextAreaElement>>('area');

  /** The `@query` being typed. */
  private readonly query = signal<{ start: number; query: string } | null>(null);
  protected readonly active = signal(0);
  protected readonly suggestions = computed(() => {
    const query = this.query();
    return query ? matchPeople(this.people(), query.query) : [];
  });

  focus(): void {
    this.area().nativeElement.focus();
  }

  protected optionId(index: number): string {
    return `${this.listId}-${index}`;
  }

  protected onInput(event: Event): void {
    this.value.set((event.target as HTMLTextAreaElement).value);
    this.track();
  }

  /** Looks for an `@query` before the caret. */
  protected track(): void {
    const area = this.area().nativeElement;
    const query =
      area.selectionStart === area.selectionEnd
        ? mentionQuery(area.value, area.selectionStart)
        : null;
    const previous = this.query();
    this.query.set(query);
    if (query?.start !== previous?.start) this.active.set(0);
  }

  protected close(): void {
    this.query.set(null);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      this.close();
      this.submitted.emit();
      return;
    }
    const options = this.suggestions();
    if (!options.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      this.active.set((this.active() + step + options.length) % options.length);
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      this.pick(options[Math.min(this.active(), options.length - 1)]);
    } else if (event.key === 'Escape') {
      // The list closes; the dialog or sheet around it stays open.
      event.preventDefault();
      event.stopPropagation();
      this.close();
    }
  }

  protected pick(person: Person): void {
    const query = this.query();
    if (!query) return;
    const area = this.area().nativeElement;
    const next = insertMention(
      area.value,
      query.start,
      area.selectionStart,
      mentionToken(person.name, person.id),
    );
    area.value = next.text;
    area.setSelectionRange(next.caret, next.caret);
    this.value.set(next.text);
    this.close();
    area.focus();
  }
}
