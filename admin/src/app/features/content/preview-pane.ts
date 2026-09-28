import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { NgIcon } from '@ng-icons/core';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { HlmToggleGroupImports } from '@spartan-ng/helm/toggle-group';

import { I18n } from '../../core/i18n/i18n';
import { MessageKey } from '../../core/i18n/keys';
import { EditTarget, editMessage } from './visual-editing';

/** Width presets of the side-by-side preview. */
export type PreviewDevice = 'desktop' | 'tablet' | 'mobile';

export const PREVIEW_DEVICES: {
  device: PreviewDevice;
  icon: string;
  label: MessageKey;
  /** CSS width of the frame. */
  width: string;
}[] = [
  { device: 'desktop', icon: 'lucideMonitor', label: 'content.preview.desktop', width: '100%' },
  { device: 'tablet', icon: 'lucideTablet', label: 'content.preview.tablet', width: '768px' },
  { device: 'mobile', icon: 'lucideSmartphone', label: 'content.preview.mobile', width: '390px' },
];

/** The form column's share of the split, in percent. */
export const SPLIT_MIN = 30;
export const SPLIT_MAX = 70;
export const SPLIT_DEFAULT = 50;

/** A preview URL the frame may load: absolute http(s) only (never `javascript:`, `data:`…). */
export function frameableUrl(raw: string, base = globalThis.location?.href): string | null {
  try {
    const url = new URL(raw, base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export function clampSplit(value: number): number {
  return Math.round(Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, value)));
}

/**
 * The split for a pointer at `x` over a container spanning `left`..`right`: the form sits
 * at the inline start, which is the right side in right-to-left layouts.
 */
export function splitAt(x: number, left: number, right: number, rtl: boolean): number {
  const width = right - left;
  if (width <= 0) return SPLIT_DEFAULT;
  return clampSplit(((rtl ? right - x : x - left) / width) * 100);
}

/** The split after a key press on the separator (`null`: the key does nothing). */
export function splitAfterKey(split: number, key: string, rtl: boolean): number | null {
  const step = 5;
  switch (key) {
    case 'ArrowLeft':
      return clampSplit(split + (rtl ? step : -step));
    case 'ArrowRight':
      return clampSplit(split + (rtl ? -step : step));
    case 'Home':
      return SPLIT_MIN;
    case 'End':
      return SPLIT_MAX;
    default:
      return null;
  }
}

/**
 * The side-by-side preview: the site in a sandboxed frame, with device widths. A site that
 * loads the visual editing overlay asks, with a `verdin:edit` message, to open a field.
 */
@Component({
  selector: 'vd-preview-pane',
  imports: [NgIcon, HlmButtonImports, HlmSpinnerImports, HlmToggleGroupImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card shadow-xs' },
  template: `
    <div class="flex flex-wrap items-center gap-2 border-b px-3 py-2">
      <h2 class="me-auto text-sm font-medium">{{ t('content.preview.panel') }}</h2>
      <hlm-toggle-group
        type="single"
        variant="outline"
        size="sm"
        [attr.aria-label]="t('content.preview.device')"
        [value]="device()"
        (valueChange)="setDevice($event)"
      >
        @for (preset of devices; track preset.device) {
          <button
            hlmToggleGroupItem
            [value]="preset.device"
            [attr.aria-label]="t(preset.label)"
            [title]="t(preset.label)"
          >
            <ng-icon [name]="preset.icon" />
          </button>
        }
      </hlm-toggle-group>
      <button
        hlmBtn
        variant="ghost"
        size="icon-sm"
        type="button"
        [disabled]="loading()"
        [attr.aria-label]="t('content.preview.reload')"
        [title]="t('content.preview.reload')"
        (click)="reload.emit()"
      >
        @if (loading()) {
          <hlm-spinner class="size-4" />
        } @else {
          <ng-icon name="lucideRefreshCw" />
        }
      </button>
      <button
        hlmBtn
        variant="ghost"
        size="icon-sm"
        type="button"
        [attr.aria-label]="t('content.preview.newTab')"
        [title]="t('content.preview.newTab')"
        (click)="openTab.emit()"
      >
        <ng-icon name="lucideExternalLink" />
      </button>
      <button
        hlmBtn
        variant="ghost"
        size="icon-sm"
        type="button"
        [attr.aria-label]="t('content.preview.close')"
        [title]="t('content.preview.close')"
        (click)="closed.emit()"
      >
        <ng-icon name="lucideX" />
      </button>
    </div>
    <div class="bg-muted/40 flex min-h-0 flex-1 justify-center overflow-auto">
      @if (frameUrl(); as src) {
        @for (key of [version()]; track key) {
          <iframe
            #frame
            class="bg-background h-full max-w-full border-x"
            [style.width]="width()"
            [src]="src"
            [title]="t('content.preview.frameTitle', { title: title() })"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            referrerpolicy="no-referrer"
            loading="lazy"
          ></iframe>
        }
      } @else if (!loading()) {
        <p class="text-muted-foreground self-center p-6 text-center text-sm">
          {{ t('content.preview.unavailable') }}
        </p>
      }
    </div>
    <p class="text-muted-foreground border-t px-3 py-2 text-xs">
      {{ t('content.preview.frameHint') }}
    </p>
  `,
})
export class PreviewPane {
  private readonly sanitizer = inject(DomSanitizer);
  protected readonly t = inject(I18n).t;
  protected readonly devices = PREVIEW_DEVICES;

  /** The preview URL (already checked with `frameableUrl`), `null` while unknown. */
  readonly url = input<string | null>(null);
  /** Bumped to reload the frame (e.g. after a save). */
  readonly version = input(0);
  readonly title = input('');
  readonly loading = input(false);
  readonly reload = output<void>();
  readonly openTab = output<void>();
  readonly closed = output<void>();
  /** The overlay's "Edit" was clicked on a marked text of the framed site. */
  readonly edit = output<EditTarget>();

  private readonly frame = viewChild<ElementRef<HTMLIFrameElement>>('frame');

  protected readonly device = signal<PreviewDevice>('desktop');
  protected readonly width = computed(
    () => PREVIEW_DEVICES.find((preset) => preset.device === this.device())?.width ?? '100%',
  );
  protected readonly frameUrl = computed<SafeResourceUrl | null>(() => {
    const url = this.url();
    const checked = url ? frameableUrl(url) : null;
    // Only http(s) URLs reach the frame; the sandbox limits what the page may do.
    return checked ? this.sanitizer.bypassSecurityTrustResourceUrl(checked) : null;
  });

  constructor() {
    const listener = (event: MessageEvent) => {
      // Only the framed page may ask (not another window or frame of the same site).
      const frame = this.frame()?.nativeElement;
      if (!frame || event.source !== frame.contentWindow) return;
      const target = editMessage(event, this.url(), document.baseURI);
      if (target) this.edit.emit(target);
    };
    window.addEventListener('message', listener);
    inject(DestroyRef).onDestroy(() => window.removeEventListener('message', listener));
  }

  protected setDevice(value: unknown): void {
    if (PREVIEW_DEVICES.some((preset) => preset.device === value))
      this.device.set(value as PreviewDevice);
  }
}
