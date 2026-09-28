import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';

import { I18n } from '../../core/i18n/i18n';
import { Schema } from '../../core/schema';
import {
  UsageEntry,
  UsageResult,
  UsageState,
  firstPlaces,
  groupUsages,
  usageEntryCount,
} from '../../core/usage';

/** Names a content type for usage lists (its display name, else its uid). */
function typeLabel(schema: Schema): (uid: string) => string {
  return (uid) => schema.type(uid)?.displayName ?? uid;
}

/** The editor route of a referencing entry. */
function entryLink(schema: Schema, entry: UsageEntry): string[] {
  return schema.type(entry.uid)?.kind === 'singleType'
    ? ['/single', entry.uid]
    : ['/content', entry.uid, entry.documentId];
}

/** The entries using something, by type, with the fields and versions that reference it. */
@Component({
  selector: 'vd-usage-list',
  imports: [RouterLink, HlmBadgeImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-4">
      @for (group of groups(); track group.uid) {
        <div class="flex flex-col gap-1.5">
          <h4 class="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {{ label(group.uid) }}
          </h4>
          <ul class="flex flex-col gap-2">
            @for (entry of group.entries; track entry.documentId + '/' + entry.locale) {
              <li class="flex items-start justify-between gap-2 text-sm">
                <span class="flex min-w-0 flex-col">
                  <a
                    class="hover:text-primary truncate font-medium underline-offset-2 hover:underline"
                    [routerLink]="link(entry)"
                    [queryParams]="entry.locale ? { locale: entry.locale } : {}"
                    [title]="entry.title ?? entry.documentId"
                    >{{ entry.title || t('usage.untitled', { id: entry.documentId }) }}</a
                  >
                  <span class="text-muted-foreground truncate text-xs">
                    {{ t('usage.fields', { fields: i18n.formatList(entry.fields) }) }}
                  </span>
                </span>
                <span class="flex shrink-0 flex-wrap justify-end gap-1">
                  @if (entry.locale) {
                    <span hlmBadge variant="outline" class="font-mono">{{ entry.locale }}</span>
                  }
                  @for (status of entry.statuses; track status) {
                    <span hlmBadge [variant]="status === 'published' ? 'secondary' : 'outline'">
                      {{
                        status === 'published'
                          ? t('content.status.published')
                          : t('content.status.draft')
                      }}
                    </span>
                  }
                </span>
              </li>
            }
          </ul>
        </div>
      }
      @if (result().hidden) {
        <p class="text-muted-foreground text-xs">
          {{ t('usage.hidden', { count: result().hidden }) }}
        </p>
      }
    </div>
  `,
})
export class UsageList {
  private readonly schema = inject(Schema);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;

  readonly result = input.required<UsageResult>();

  protected readonly label = typeLabel(this.schema);
  protected readonly groups = computed(() => groupUsages(this.result().data, this.label));

  protected link(entry: UsageEntry): string[] {
    return entryLink(this.schema, entry);
  }
}

/** A collapsible "Used in" section: the count in its header, the list when opened. */
@Component({
  selector: 'vd-usage-section',
  imports: [
    NgIcon,
    HlmBadgeImports,
    HlmButtonImports,
    HlmSkeletonImports,
    HlmSpinnerImports,
    UsageList,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-3">
      <h3 class="text-sm leading-none font-semibold" [attr.aria-level]="level()" role="heading">
        <button
          type="button"
          class="focus-visible:ring-ring/50 -m-1 flex w-[calc(100%+0.5rem)] items-center gap-2 rounded-md p-1 text-start outline-none focus-visible:ring-3"
          [attr.aria-expanded]="expanded()"
          [attr.aria-controls]="panelId"
          (click)="expanded.set(!expanded())"
        >
          <ng-icon
            name="lucideChevronRight"
            size="16"
            class="text-muted-foreground shrink-0 transition-transform rtl:-scale-x-100"
            [class.rotate-90]="expanded()"
            aria-hidden="true"
          />
          <span class="me-auto">{{ t('usage.title') }}</span>
          @switch (state()?.status) {
            @case ('loading') {
              <hlm-spinner class="size-4" [attr.aria-label]="t('usage.checking')" />
            }
            @case ('done') {
              <span hlmBadge variant="secondary" class="tabular-nums">{{ count() }}</span>
            }
          }
        </button>
      </h3>
      <div [id]="panelId" [hidden]="!expanded()" aria-live="polite">
        @switch (state()?.status) {
          @case ('done') {
            @if (result(); as result) {
              @if (result.data.length) {
                <vd-usage-list [result]="result" />
              } @else if (result.hidden) {
                <p class="text-muted-foreground text-sm">
                  {{ t('usage.onlyHidden', { count: result.hidden }) }}
                </p>
              } @else {
                <p class="text-muted-foreground text-sm">{{ t('usage.none') }}</p>
              }
            }
          }
          @case ('error') {
            <div class="flex items-center justify-between gap-2 text-sm">
              <span class="text-muted-foreground">{{ t('usage.failed') }}</span>
              <button hlmBtn variant="outline" size="xs" type="button" (click)="retry.emit()">
                {{ t('common.retry') }}
              </button>
            </div>
          }
          @default {
            <hlm-skeleton class="h-10 w-full" />
          }
        }
      </div>
    </div>
  `,
})
export class UsageSection {
  private static next = 0;
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  protected readonly panelId = `usage-panel-${UsageSection.next++}`;

  readonly state = input<UsageState | null>(null);
  /** The heading's level in the page outline. */
  readonly level = input<2 | 3>(2);
  readonly retry = output<void>();

  protected readonly expanded = signal(false);
  protected readonly result = computed(() => {
    const state = this.state();
    return state?.status === 'done' ? state.result : null;
  });
  /** Entries, plus the versions the admin cannot see. */
  protected readonly count = computed(() => {
    const result = this.result();
    return result ? usageEntryCount(result) + result.hidden : 0;
  });
}

/** The usage check of a delete confirmation: how many entries use it, and the first few. */
@Component({
  selector: 'vd-usage-warning',
  imports: [NgIcon, HlmAlertImports, HlmSpinnerImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (state()?.status) {
      @case ('loading') {
        <p class="text-muted-foreground flex items-center gap-2 text-sm" role="status">
          <hlm-spinner class="size-4" /> {{ t('usage.checking') }}
        </p>
      }
      @case ('error') {
        <p class="text-muted-foreground text-sm" role="status">{{ t('usage.failed') }}</p>
      }
      @case ('done') {
        @if (count(); as count) {
          <div hlmAlert role="alert" class="border-amber-500/50 text-start">
            <ng-icon hlmAlertIcon name="lucideTriangleAlert" class="text-amber-600" />
            <p hlmAlertTitle>{{ t('usage.warning.title', { count }) }}</p>
            <div hlmAlertDescription class="flex flex-col gap-1">
              <p>{{ t('usage.warning.hint') }}</p>
              @if (places().length) {
                <ul class="list-disc ps-4">
                  @for (place of places(); track place.uid + place.documentId + place.locale) {
                    <li>
                      {{
                        t('usage.warning.place', {
                          title: place.title || t('usage.untitled', { id: place.documentId }),
                          type: label(place.uid),
                          fields: i18n.formatList(place.fields),
                        })
                      }}
                    </li>
                  }
                </ul>
              }
              @if (more()) {
                <p>{{ t('usage.more', { count: more() }) }}</p>
              }
              @if (hidden()) {
                <p>{{ t('usage.hidden', { count: hidden() }) }}</p>
              }
            </div>
          </div>
        }
      }
    }
  `,
})
export class UsageWarning {
  private readonly schema = inject(Schema);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;

  readonly state = input<UsageState | null>(null);
  /** Places listed by name. */
  readonly max = input(3);

  protected readonly label = typeLabel(this.schema);
  private readonly result = computed(() => {
    const state = this.state();
    return state?.status === 'done' ? state.result : null;
  });
  private readonly entries = computed(() => {
    const result = this.result();
    return result ? usageEntryCount(result) : 0;
  });
  protected readonly hidden = computed(() => this.result()?.hidden ?? 0);
  protected readonly count = computed(() => this.entries() + this.hidden());
  protected readonly places = computed(() => {
    const result = this.result();
    return result ? firstPlaces(result, this.max(), this.label) : [];
  });
  protected readonly more = computed(() => Math.max(0, this.entries() - this.places().length));
}
