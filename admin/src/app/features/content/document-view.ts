import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  inject,
  input,
} from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';

import { I18n } from '../../core/i18n/i18n';
import { Media } from '../../core/media';
import { Schema } from '../../core/schema';
import { Attribute, Attributes, MediaFile } from '../../core/types';
import { prettyJson } from '../../core/webhooks';
import { MediaThumb } from '../media/media-thumb';
import { Block } from './fields/blocks-convert';
import { humanize } from './fields/fields';
import { renderMarkdown } from './fields/markdown-control';
import { documentLabel } from './fields/model';
import { blocksToHtml } from './history-model';

type Entry = { name: string; attribute: Attribute; value: unknown };
type Item = Record<string, unknown>;

function isEmpty(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  );
}

function asList(value: unknown): Item[] {
  const list = Array.isArray(value) ? value : isEmpty(value) ? [] : [value];
  return list.map((item) =>
    typeof item === 'object' && item !== null ? (item as Item) : { documentId: item, id: item },
  );
}

/**
 * A document rendered read-only: labels and values, relations as chips, media as thumbnails,
 * components and dynamic zones as nested groups, Markdown and blocks as formatted text.
 * Recursive for components.
 */
@Component({
  selector: 'vd-document-view',
  imports: [RouterLink, NgIcon, HlmBadgeImports, MediaThumb],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrl: './fields/prose.css',
  template: `
    <dl class="flex flex-col gap-5">
      @for (entry of entries(); track entry.name) {
        @let attribute = entry.attribute;
        @let value = entry.value;
        @switch (attribute.type) {
          @case ('component') {
            <div role="group" class="overflow-hidden rounded-lg border">
              <dt class="bg-muted/40 flex items-center gap-2 border-b px-4 py-2.5">
                <ng-icon name="lucideBlocks" class="text-muted-foreground" />
                <span class="text-sm font-medium">{{ humanize(entry.name) }}</span>
                @if (attribute.repeatable && list(value).length) {
                  <span hlmBadge variant="outline" class="ms-auto tabular-nums">{{
                    i18n.formatNumber(list(value).length)
                  }}</span>
                }
              </dt>
              <dd class="flex flex-col gap-3 p-4">
                @if (isEmpty(value)) {
                  <span class="text-muted-foreground text-sm italic">{{
                    t('content.history.noValue')
                  }}</span>
                } @else if (attribute.repeatable) {
                  @for (item of list(value); track $index; let index = $index) {
                    <div class="bg-background overflow-hidden rounded-md border">
                      <div class="bg-muted/30 border-b px-3 py-1.5">
                        <span hlmBadge variant="secondary" class="tabular-nums"
                          >#{{ index + 1 }}</span
                        >
                      </div>
                      <div class="p-4">
                        <vd-document-view
                          [attributes]="componentAttributes(attribute.component)"
                          [data]="item"
                        />
                      </div>
                    </div>
                  }
                } @else {
                  <vd-document-view
                    [attributes]="componentAttributes(attribute.component)"
                    [data]="list(value)[0]"
                  />
                }
              </dd>
            </div>
          }
          @case ('dynamiczone') {
            <div role="group" class="overflow-hidden rounded-lg border">
              <dt class="bg-muted/40 flex items-center gap-2 border-b px-4 py-2.5">
                <ng-icon name="lucideLayers" class="text-muted-foreground" />
                <span class="text-sm font-medium">{{ humanize(entry.name) }}</span>
                @if (list(value).length) {
                  <span hlmBadge variant="outline" class="ms-auto tabular-nums">{{
                    i18n.formatNumber(list(value).length)
                  }}</span>
                }
              </dt>
              <dd class="flex flex-col gap-3 p-4">
                @for (item of list(value); track $index) {
                  <div class="bg-background overflow-hidden rounded-md border">
                    <div class="bg-muted/30 border-b px-3 py-1.5">
                      <span hlmBadge variant="secondary">{{
                        componentName(item['__component'])
                      }}</span>
                    </div>
                    <div class="p-4">
                      <vd-document-view
                        [attributes]="componentAttributes(item['__component'])"
                        [data]="item"
                      />
                    </div>
                  </div>
                } @empty {
                  <span class="text-muted-foreground text-sm italic">{{
                    t('content.history.noValue')
                  }}</span>
                }
              </dd>
            </div>
          }
          @default {
            <div class="flex flex-col gap-1.5">
              <dt class="text-muted-foreground flex items-center gap-2 text-xs font-medium">
                {{ humanize(entry.name) }}
                @if (attribute.private) {
                  <span hlmBadge variant="outline">{{ t('content.fields.private') }}</span>
                }
              </dt>
              <dd class="min-w-0 text-sm">
                @if (isEmpty(value)) {
                  <span class="text-muted-foreground italic">{{
                    t('content.history.noValue')
                  }}</span>
                } @else {
                  @switch (attribute.type) {
                    @case ('richtext') {
                      <div class="vd-prose" [innerHTML]="markdown(value)"></div>
                    }
                    @case ('blocks') {
                      <div class="vd-prose" [innerHTML]="blocks(value)"></div>
                    }
                    @case ('boolean') {
                      <span hlmBadge [variant]="value ? 'secondary' : 'outline'">{{
                        value ? t('common.yes') : t('common.no')
                      }}</span>
                    }
                    @case ('enumeration') {
                      <span hlmBadge variant="outline">{{ value }}</span>
                    }
                    @case ('integer') {
                      <span class="tabular-nums">{{ i18n.formatNumber($any(value)) }}</span>
                    }
                    @case ('biginteger') {
                      <span class="tabular-nums">{{ i18n.formatNumber($any(value)) }}</span>
                    }
                    @case ('float') {
                      <span class="tabular-nums">{{ i18n.formatNumber($any(value)) }}</span>
                    }
                    @case ('decimal') {
                      <span class="tabular-nums">{{ i18n.formatNumber($any(value)) }}</span>
                    }
                    @case ('date') {
                      {{ i18n.formatDate($any(value), 'date') }}
                    }
                    @case ('datetime') {
                      {{ i18n.formatDate($any(value), 'datetime') }}
                    }
                    @case ('time') {
                      <span class="tabular-nums">{{ $any(value).slice(0, 8) }}</span>
                    }
                    @case ('json') {
                      <pre
                        class="bg-muted/40 max-h-72 overflow-auto rounded-md border p-3 font-mono text-xs"
                        >{{ json(value) }}</pre>
                    }
                    @case ('relation') {
                      <ul class="flex flex-wrap gap-1">
                        @for (item of list(value); track $index) {
                          <li>
                            @if (item['documentId']) {
                              <a
                                hlmBadge
                                variant="secondary"
                                [routerLink]="['/content', attribute.target, item['documentId']]"
                                >{{ relationLabel(attribute, item) }}</a
                              >
                            } @else {
                              <span hlmBadge variant="secondary">{{
                                relationLabel(attribute, item)
                              }}</span>
                            }
                          </li>
                        }
                      </ul>
                    }
                    @case ('media') {
                      <ul class="flex flex-wrap gap-2">
                        @for (file of files(value); track $index) {
                          <li class="flex w-24 flex-col gap-1" [title]="file.name">
                            <vd-media-thumb
                              class="aspect-square rounded-md border"
                              [file]="file"
                              [width]="160"
                              iconSize="24"
                            />
                            <span class="text-muted-foreground truncate text-xs">{{
                              file.name
                            }}</span>
                          </li>
                        }
                      </ul>
                    }
                    @case ('text') {
                      <p class="whitespace-pre-wrap">{{ value }}</p>
                    }
                    @case ('uid') {
                      <span class="font-mono">{{ value }}</span>
                    }
                    @default {
                      <p class="whitespace-pre-wrap break-words">{{ value }}</p>
                    }
                  }
                }
              </dd>
            </div>
          }
        }
      }
    </dl>
  `,
})
export class DocumentView {
  private readonly schema = inject(Schema);
  private readonly media = inject(Media);
  private readonly sanitizer = inject(DomSanitizer);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;

  readonly attributes = input.required<Attributes>();
  readonly data = input.required<Record<string, unknown> | null | undefined>();

  protected readonly humanize = humanize;
  protected readonly isEmpty = isEmpty;
  protected readonly list = asList;
  protected readonly json = prettyJson;

  protected readonly entries = computed<Entry[]>(() => {
    const data = this.data() ?? {};
    return Object.entries(this.attributes()).map(([name, attribute]) => ({
      name,
      attribute,
      value: data[name],
    }));
  });

  protected componentAttributes(uid: unknown): Attributes {
    return this.schema.component(String(uid ?? ''))?.attributes ?? {};
  }

  protected componentName(uid: unknown): string {
    return this.schema.component(String(uid ?? ''))?.displayName ?? String(uid ?? '');
  }

  protected relationLabel(attribute: Attribute, item: Item): string {
    const target = this.schema.type(attribute.target ?? '');
    return documentLabel(item, target ? this.schema.titleField(target) : null);
  }

  protected files(value: unknown): MediaFile[] {
    return asList(value).filter((file) => 'url' in file) as unknown as MediaFile[];
  }

  /** DOMPurify-sanitized by `renderMarkdown`, so Angular's lossy sanitizer is bypassed. */
  protected markdown(value: unknown): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(renderMarkdown(String(value)));
  }

  /** Built from escaped text only (see `blocksToHtml`). */
  protected blocks(value: unknown): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(
      blocksToHtml(value as Block[], (url) => this.media.url(url)),
    );
  }
}
