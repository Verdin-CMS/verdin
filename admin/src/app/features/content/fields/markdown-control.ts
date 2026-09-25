import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { FormValueControl } from '@angular/forms/signals';
import { NgIcon } from '@ng-icons/core';
import { HlmTextareaImports } from '@spartan-ng/helm/textarea';
import { HlmToggleGroupImports } from '@spartan-ng/helm/toggle-group';
import DOMPurify from 'dompurify';
import { marked } from 'marked';

import { I18n } from '../../../core/i18n/i18n';

let purifier: ReturnType<typeof DOMPurify> | null = null;

/** A DOMPurify instance whose links open safely (`rel="noopener noreferrer"`). */
function purify(): ReturnType<typeof DOMPurify> {
  if (!purifier) {
    purifier = DOMPurify(window);
    purifier.addHook('afterSanitizeAttributes', (node) => {
      if (node.tagName === 'A' && node.hasAttribute('href')) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer nofollow');
      }
    });
  }
  return purifier;
}

/** Markdown → sanitized HTML (marked + DOMPurify; neither evaluates code, so CSP-safe). */
export function renderMarkdown(markdown: string): string {
  const html = marked.parse(markdown, { async: false, gfm: true }) as string;
  return purify().sanitize(html, { USE_PROFILES: { html: true } });
}

/** A Markdown (`richtext`) field: a textarea with an Edit / Preview toggle. */
@Component({
  selector: 'vd-markdown-control',
  imports: [NgIcon, HlmTextareaImports, HlmToggleGroupImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrl: './prose.css',
  template: `
    <div class="flex flex-col gap-2">
      <hlm-toggle-group
        type="single"
        variant="outline"
        size="sm"
        class="self-start"
        [attr.aria-label]="t('content.markdown.mode')"
        [value]="mode()"
        (valueChange)="setMode($any($event))"
      >
        <button hlmToggleGroupItem value="edit" type="button">
          <ng-icon name="lucidePencil" /> {{ t('content.markdown.edit') }}
        </button>
        <button hlmToggleGroupItem value="preview" type="button">
          <ng-icon name="lucideEye" /> {{ t('content.markdown.preview') }}
        </button>
      </hlm-toggle-group>
      @if (mode() === 'edit') {
        <textarea
          hlmTextarea
          rows="10"
          class="font-mono text-sm"
          [id]="inputId()"
          [value]="value() ?? ''"
          [disabled]="disabled()"
          [attr.aria-invalid]="invalid() || null"
          (input)="value.set($any($event.target).value)"
          (blur)="touch.emit()"
        ></textarea>
      } @else {
        <div
          class="bg-background dark:bg-input/30 min-h-[15.5rem] overflow-auto rounded-md border px-3 py-2 shadow-xs"
          [id]="inputId()"
          tabindex="0"
          role="region"
          [attr.aria-label]="t('content.markdown.preview')"
        >
          @if (html(); as html) {
            <div class="vd-prose" [innerHTML]="html"></div>
          } @else {
            <p class="text-muted-foreground text-sm">{{ t('content.markdown.empty') }}</p>
          }
        </div>
      }
    </div>
  `,
})
export class MarkdownControl implements FormValueControl<string | null> {
  private readonly sanitizer = inject(DomSanitizer);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;

  readonly value = model<string | null>('');
  readonly disabled = input(false);
  readonly invalid = input(false);
  readonly touch = output<void>();
  readonly inputId = input<string>('');

  protected readonly mode = signal<'edit' | 'preview'>('edit');

  /** Sanitized by DOMPurify, so Angular's (stricter, lossy) sanitizer is bypassed. */
  protected readonly html = computed<SafeHtml | null>(() => {
    if (this.mode() !== 'preview') return null;
    const text = (this.value() ?? '').trim();
    return text ? this.sanitizer.bypassSecurityTrustHtml(renderMarkdown(text)) : null;
  });

  protected setMode(mode: 'edit' | 'preview' | null | undefined): void {
    if (mode) this.mode.set(mode);
  }
}
