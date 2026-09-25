import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  ViewEncapsulation,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { FormValueControl } from '@angular/forms/signals';
import { NgIcon } from '@ng-icons/core';
import type { BrnOverlayState } from '@spartan-ng/brain/overlay';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { HlmPopoverImports } from '@spartan-ng/helm/popover';
import { Editor } from '@tiptap/core';

import { Auth } from '../../../core/auth';
import { I18n } from '../../../core/i18n/i18n';
import { MessageKey } from '../../../core/i18n/keys';
import { MediaFile } from '../../../core/types';
import { MediaPicker } from '../../media/picker';
import { Block, PmNode, blocksToTiptap, isSafeUrl, tiptapToBlocks } from './blocks-convert';
import { blocksExtensions } from './blocks-extensions';

type Mark = 'bold' | 'italic' | 'underline' | 'strike' | 'code';

/** State of the selection, for the toolbar. */
interface Active {
  style: string;
  marks: Record<Mark, boolean>;
  link: boolean;
  bulletList: boolean;
  orderedList: boolean;
  blockquote: boolean;
  codeBlock: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

const IDLE: Active = {
  style: 'paragraph',
  marks: { bold: false, italic: false, underline: false, strike: false, code: false },
  link: false,
  bulletList: false,
  orderedList: false,
  blockquote: false,
  codeBlock: false,
  canUndo: false,
  canRedo: false,
};

/**
 * Strapi-compatible `blocks` rich text, edited with TipTap. The value is the blocks JSON array
 * (`null` when empty).
 */
@Component({
  selector: 'vd-blocks-control',
  imports: [
    NgIcon,
    HlmButtonImports,
    HlmInputImports,
    HlmNativeSelectImports,
    HlmPopoverImports,
    MediaPicker,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrl: './prose.css',
  template: `
    <div
      class="bg-background dark:bg-input/30 focus-within:border-ring focus-within:ring-ring/50 overflow-hidden rounded-md border shadow-xs transition-[color,box-shadow] focus-within:ring-3"
      [class.border-destructive]="invalid()"
      [class.opacity-60]="disabled()"
    >
      <div
        role="toolbar"
        class="bg-muted/40 flex flex-wrap items-center gap-0.5 border-b p-1"
        [attr.aria-label]="t('content.blocks.toolbar')"
        [attr.aria-controls]="inputId()"
      >
        <hlm-native-select
          size="sm"
          class="w-36"
          [value]="active().style"
          [disabled]="disabled()"
          [attr.aria-label]="t('content.blocks.style')"
          (valueChange)="setStyle($event ?? 'paragraph')"
        >
          <option hlmNativeSelectOption value="paragraph">
            {{ t('content.blocks.paragraph') }}
          </option>
          @for (level of headingLevels(); track level) {
            <option hlmNativeSelectOption [value]="'h' + level">
              {{ t('content.blocks.heading', { level }) }}
            </option>
          }
        </hlm-native-select>
        <span class="bg-border mx-1 h-5 w-px" aria-hidden="true"></span>
        @for (button of markButtons; track button.mark) {
          <button
            hlmBtn
            size="icon-sm"
            variant="ghost"
            type="button"
            class="aria-pressed:bg-accent aria-pressed:text-accent-foreground"
            [attr.aria-pressed]="active().marks[button.mark]"
            [attr.aria-label]="t(button.label)"
            [title]="t(button.label) + button.shortcut"
            [disabled]="disabled()"
            (mousedown)="$event.preventDefault()"
            (click)="toggleMark(button.mark)"
          >
            <ng-icon [name]="button.icon" />
          </button>
        }
        <hlm-popover
          sideOffset="4"
          align="start"
          [state]="linkState()"
          (stateChanged)="onLinkState($event)"
        >
          <button
            hlmBtn
            hlmPopoverTrigger
            size="icon-sm"
            variant="ghost"
            type="button"
            class="aria-pressed:bg-accent aria-pressed:text-accent-foreground"
            [attr.aria-pressed]="active().link"
            [attr.aria-label]="t('content.blocks.link')"
            [title]="t('content.blocks.link') + ' (' + mod + '+K)'"
            [disabled]="disabled()"
            (mousedown)="$event.preventDefault()"
          >
            <ng-icon name="lucideLink" />
          </button>
          <hlm-popover-content class="flex w-80 flex-col gap-2 p-3" *hlmPopoverPortal="let ctx">
            <form class="flex flex-col gap-2" (submit)="$event.preventDefault(); applyLink()">
              <label class="text-sm font-medium" [for]="inputId() + '-link'">{{
                t('content.blocks.linkUrl')
              }}</label>
              <input
                hlmInput
                autocomplete="off"
                placeholder="https://"
                [id]="inputId() + '-link'"
                [value]="linkUrl()"
                [attr.aria-invalid]="linkError() || null"
                (input)="linkUrl.set($any($event.target).value); linkError.set(false)"
              />
              @if (linkError()) {
                <p class="text-destructive text-xs">{{ t('content.blocks.linkInvalid') }}</p>
              }
              <div class="flex items-center justify-end gap-2">
                @if (active().link) {
                  <button hlmBtn size="sm" variant="ghost" type="button" (click)="removeLink()">
                    <ng-icon name="lucideUnlink" /> {{ t('content.blocks.linkRemove') }}
                  </button>
                }
                <button hlmBtn size="sm" type="submit">{{ t('content.blocks.linkApply') }}</button>
              </div>
            </form>
          </hlm-popover-content>
        </hlm-popover>
        <span class="bg-border mx-1 h-5 w-px" aria-hidden="true"></span>
        @for (button of blockButtons; track button.node) {
          <button
            hlmBtn
            size="icon-sm"
            variant="ghost"
            type="button"
            class="aria-pressed:bg-accent aria-pressed:text-accent-foreground"
            [attr.aria-pressed]="active()[button.node]"
            [attr.aria-label]="t(button.label)"
            [title]="t(button.label) + button.shortcut"
            [disabled]="disabled()"
            (mousedown)="$event.preventDefault()"
            (click)="toggleBlock(button.node)"
          >
            <ng-icon [name]="button.icon" />
          </button>
        }
        <button
          hlmBtn
          size="icon-sm"
          variant="ghost"
          type="button"
          [attr.aria-label]="t('content.blocks.image')"
          [title]="t('content.blocks.image')"
          [disabled]="disabled() || !canReadMedia()"
          (mousedown)="$event.preventDefault()"
          (click)="pickerOpen.set(true)"
        >
          <ng-icon name="lucideImagePlus" />
        </button>
        <span class="ms-auto"></span>
        <button
          hlmBtn
          size="icon-sm"
          variant="ghost"
          type="button"
          [attr.aria-label]="t('content.blocks.undo')"
          [title]="t('content.blocks.undo') + ' (' + mod + '+Z)'"
          [disabled]="disabled() || !active().canUndo"
          (mousedown)="$event.preventDefault()"
          (click)="run((chain) => chain.undo())"
        >
          <ng-icon name="lucideUndo2" />
        </button>
        <button
          hlmBtn
          size="icon-sm"
          variant="ghost"
          type="button"
          [attr.aria-label]="t('content.blocks.redo')"
          [title]="t('content.blocks.redo') + ' (' + mod + '+Shift+Z)'"
          [disabled]="disabled() || !active().canRedo"
          (mousedown)="$event.preventDefault()"
          (click)="run((chain) => chain.redo())"
        >
          <ng-icon name="lucideRedo2" />
        </button>
      </div>
      <div #surface class="max-h-[36rem] overflow-y-auto px-3 py-2"></div>
    </div>

    <vd-media-picker
      [open]="pickerOpen()"
      [multiple]="false"
      [allowedTypes]="['images']"
      [selected]="[]"
      (picked)="insertImage($event)"
      (closed)="pickerOpen.set(false)"
    />
  `,
})
export class BlocksControl implements FormValueControl<Block[] | null> {
  private readonly auth = inject(Auth);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;

  readonly value = model<Block[] | null>(null);
  readonly disabled = input(false);
  readonly invalid = input(false);
  readonly touch = output<void>();
  readonly inputId = input<string>('');

  private readonly surface = viewChild.required<ElementRef<HTMLElement>>('surface');
  private editor: Editor | null = null;
  /** The last value this control emitted (JSON), to tell outside changes from echoes. */
  private emitted = 'null';

  protected readonly active = signal<Active>(IDLE);
  protected readonly pickerOpen = signal(false);
  protected readonly linkState = signal<BrnOverlayState | null>(null);
  protected readonly linkUrl = signal('');
  protected readonly linkError = signal(false);
  protected readonly canReadMedia = computed(() => this.auth.can('media.read'));
  /** Headings 1-3, plus the current level when a loaded document uses a deeper one. */
  protected readonly headingLevels = computed(() => {
    const current = Number(this.active().style.slice(1));
    return current > 3 ? [1, 2, 3, current] : [1, 2, 3];
  });

  protected readonly mod =
    typeof navigator !== 'undefined' && /Mac|iP(hone|ad)/.test(navigator.platform) ? '⌘' : 'Ctrl';

  protected readonly markButtons: {
    mark: Mark;
    icon: string;
    label: MessageKey;
    shortcut: string;
  }[] = [
    { mark: 'bold', icon: 'lucideBold', label: 'content.blocks.bold', shortcut: this.keys('B') },
    {
      mark: 'italic',
      icon: 'lucideItalic',
      label: 'content.blocks.italic',
      shortcut: this.keys('I'),
    },
    {
      mark: 'underline',
      icon: 'lucideUnderline',
      label: 'content.blocks.underline',
      shortcut: this.keys('U'),
    },
    {
      mark: 'strike',
      icon: 'lucideStrikethrough',
      label: 'content.blocks.strikethrough',
      shortcut: this.keys('Shift+S'),
    },
    { mark: 'code', icon: 'lucideCode', label: 'content.blocks.code', shortcut: this.keys('E') },
  ];

  protected readonly blockButtons: {
    node: 'bulletList' | 'orderedList' | 'blockquote' | 'codeBlock';
    icon: string;
    label: MessageKey;
    shortcut: string;
  }[] = [
    {
      node: 'bulletList',
      icon: 'lucideList',
      label: 'content.blocks.bulletList',
      shortcut: this.keys('Shift+8'),
    },
    {
      node: 'orderedList',
      icon: 'lucideListOrdered',
      label: 'content.blocks.orderedList',
      shortcut: this.keys('Shift+7'),
    },
    {
      node: 'blockquote',
      icon: 'lucideQuote',
      label: 'content.blocks.quote',
      shortcut: this.keys('Shift+B'),
    },
    {
      node: 'codeBlock',
      icon: 'lucideSquareCode',
      label: 'content.blocks.codeBlock',
      shortcut: this.keys('Alt+C'),
    },
  ];

  constructor() {
    afterNextRender(() => this.create());
    inject(DestroyRef).onDestroy(() => this.editor?.destroy());

    // Outside changes (discarding a draft, reordering components) replace the content.
    effect(() => {
      const value = this.value();
      untracked(() => {
        const json = JSON.stringify(value ?? null);
        if (!this.editor || json === this.emitted) return;
        this.emitted = json;
        this.editor.commands.setContent(blocksToTiptap(value), { emitUpdate: false });
        this.refresh();
      });
    });
    effect(() => {
      const editable = !this.disabled();
      untracked(() => this.editor?.setEditable(editable, false));
    });
    effect(() => {
      const invalid = this.invalid();
      const dom = untracked(() => this.editor?.view.dom);
      if (invalid) dom?.setAttribute('aria-invalid', 'true');
      else dom?.removeAttribute('aria-invalid');
    });
  }

  private keys(combo: string): string {
    return ` (${this.mod}+${combo})`;
  }

  private create(): void {
    const value = this.value();
    this.emitted = JSON.stringify(value ?? null);
    this.editor = new Editor({
      element: this.surface().nativeElement,
      extensions: blocksExtensions(),
      content: blocksToTiptap(value),
      editable: !this.disabled(),
      editorProps: {
        attributes: {
          id: this.inputId(),
          class: 'vd-prose',
          role: 'textbox',
          'aria-multiline': 'true',
        },
        handleKeyDown: (_view, event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
            event.preventDefault();
            this.openLink();
            return true;
          }
          return false;
        },
      },
      onUpdate: ({ editor }) => {
        const blocks = tiptapToBlocks(editor.getJSON() as PmNode);
        this.emitted = JSON.stringify(blocks);
        this.value.set(blocks);
      },
      onTransaction: () => this.refresh(),
      onBlur: () => this.touch.emit(),
    });
    if (this.invalid()) this.editor.view.dom.setAttribute('aria-invalid', 'true');
    this.refresh();
  }

  /** Recomputes the toolbar state from the selection. */
  private refresh(): void {
    const editor = this.editor;
    if (!editor) return;
    let style = 'paragraph';
    for (const level of [1, 2, 3, 4, 5, 6]) {
      if (editor.isActive('heading', { level })) style = `h${level}`;
    }
    this.active.set({
      style,
      marks: {
        bold: editor.isActive('bold'),
        italic: editor.isActive('italic'),
        underline: editor.isActive('underline'),
        strike: editor.isActive('strike'),
        code: editor.isActive('code'),
      },
      link: editor.isActive('link'),
      bulletList: editor.isActive('bulletList'),
      orderedList: editor.isActive('orderedList'),
      blockquote: editor.isActive('blockquote'),
      codeBlock: editor.isActive('codeBlock'),
      canUndo: editor.can().undo(),
      canRedo: editor.can().redo(),
    });
  }

  protected run(command: (chain: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) {
    if (this.editor) command(this.editor.chain().focus()).run();
  }

  protected setStyle(style: string): void {
    const level = Number(style.slice(1)) as 1 | 2 | 3 | 4 | 5 | 6;
    this.run((chain) =>
      style === 'paragraph' ? chain.setParagraph() : chain.setHeading({ level }),
    );
  }

  protected toggleMark(mark: Mark): void {
    this.run((chain) => {
      switch (mark) {
        case 'bold':
          return chain.toggleBold();
        case 'italic':
          return chain.toggleItalic();
        case 'underline':
          return chain.toggleUnderline();
        case 'strike':
          return chain.toggleStrike();
        case 'code':
          return chain.toggleCode();
      }
    });
  }

  protected toggleBlock(node: 'bulletList' | 'orderedList' | 'blockquote' | 'codeBlock'): void {
    this.run((chain) => {
      switch (node) {
        case 'bulletList':
          return chain.toggleBulletList();
        case 'orderedList':
          return chain.toggleOrderedList();
        case 'blockquote':
          return chain.toggleBlockquote();
        case 'codeBlock':
          return chain.toggleCodeBlock();
      }
    });
  }

  private openLink(): void {
    if (this.disabled()) return;
    this.onLinkState('open');
    this.linkState.set('open');
  }

  protected onLinkState(state: BrnOverlayState): void {
    if (state === 'open') {
      this.linkUrl.set(String(this.editor?.getAttributes('link')['href'] ?? ''));
      this.linkError.set(false);
    }
    this.linkState.set(state);
  }

  protected applyLink(): void {
    const url = this.linkUrl().trim();
    if (!url) {
      this.removeLink();
      return;
    }
    if (!isSafeUrl(url)) {
      this.linkError.set(true);
      return;
    }
    const editor = this.editor;
    if (!editor) return;
    if (editor.state.selection.empty && !editor.isActive('link')) {
      // No selection: insert the URL itself as the link text.
      editor
        .chain()
        .focus()
        .insertContent({ type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url } }] })
        .run();
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    }
    this.linkState.set('closed');
  }

  protected removeLink(): void {
    this.editor?.chain().focus().extendMarkRange('link').unsetLink().run();
    this.linkState.set('closed');
  }

  protected insertImage(files: MediaFile[]): void {
    this.pickerOpen.set(false);
    const file = files[0];
    if (!file || !this.editor) return;
    this.editor
      .chain()
      .focus()
      .insertContent({
        type: 'image',
        attrs: { src: file.url, alt: file.alternativeText ?? null, file },
      })
      .run();
  }
}
