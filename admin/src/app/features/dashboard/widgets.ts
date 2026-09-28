/** Dashboard widget bodies. The dashboard page draws the card, title and edit controls. */

import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';

import { Api, ApiFailure, RUNTIME_CONFIG, toQuery } from '../../core/api';
import { Auth } from '../../core/auth';
import { ChartSeries, WidgetCondition, WidgetConfig } from '../../core/dashboard';
import { Engagement, Poll, VoteTally } from '../../core/engagement';
import { I18n } from '../../core/i18n/i18n';
import { MessageKey } from '../../core/i18n/keys';
import { PluginExtensions } from '../../core/plugin-extensions';
import { Schema } from '../../core/schema';
import { ContentType, Document } from '../../core/types';
import { VoteControl } from '../../shared/components/vote-control';
import { documentLabel } from '../content/fields/model';
import { ContentStats, buildChart } from './chart';

interface Row {
  type: ContentType;
  document: Document;
}

const OPERATORS: Record<WidgetCondition['op'], string> = {
  eq: '$eq',
  ne: '$ne',
  containsi: '$containsi',
  gt: '$gt',
  lt: '$lt',
  null: '$null',
  notNull: '$notNull',
};

/** API filters for a widget: its conditions and title search, all of which must hold. */
function widgetFilters(schema: Schema, type: ContentType, config: WidgetConfig): unknown[] {
  const filters: unknown[] = [];
  const titleField = schema.titleField(type);
  if (config.search && titleField) filters.push({ [titleField]: { $containsi: config.search } });
  for (const condition of config.conditions ?? []) {
    if (!condition.field || !(condition.field in type.attributes)) continue;
    const operator = OPERATORS[condition.op];
    if (!operator) continue;
    const value =
      condition.op === 'null' || condition.op === 'notNull' ? true : (condition.value ?? '');
    filters.push({ [condition.field]: { [operator]: value } });
  }
  return filters;
}

/** Content admin query string for a widget's configuration. */
function listQuery(
  schema: Schema,
  type: ContentType,
  config: WidgetConfig,
  pageSize: number,
  extra: unknown[] = [],
): string {
  const titleField = schema.titleField(type);
  let sort: string = config.sort ?? 'updatedAt:desc';
  if (sort === 'title:asc') sort = titleField ? `${titleField}:asc` : 'updatedAt:desc';
  if (sort === 'votes:desc') sort = 'updatedAt:desc';
  const query: Record<string, unknown> = { pagination: { pageSize }, sort };
  if (config.status === 'published' && type.draftAndPublish) query['status'] = 'published';
  const filters = [...widgetFilters(schema, type, config), ...extra];
  if (filters.length) query['filters'] = { $and: Object.fromEntries(filters.entries()) };
  const text = toQuery(query);
  return config.unseen ? `${text}&unseen=true` : text;
}

@Component({
  selector: 'vd-count-widget',
  imports: [RouterLink, NgIcon, HlmSkeletonImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (type(); as type) {
      <a [routerLink]="['/content', type.uid]" class="group flex items-end justify-between gap-3">
        <div class="flex flex-col gap-1">
          @if (total() === null) {
            <hlm-skeleton class="h-9 w-16" />
          } @else {
            <span class="flex items-center gap-2">
              <span class="text-3xl font-semibold tracking-tight tabular-nums">{{
                i18n.formatNumber(total()!)
              }}</span>
              @if (config().unseen && total()! > 0) {
                <span class="bg-primary size-2 rounded-full" aria-hidden="true"></span>
              }
            </span>
          }
          <span class="text-muted-foreground text-xs">{{ caption() }}</span>
        </div>
        <span
          class="bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground inline-flex size-10 items-center justify-center rounded-xl transition-colors"
        >
          <ng-icon [name]="config().unseen ? 'lucideInbox' : 'lucideFileText'" size="18" />
        </span>
      </a>
    } @else {
      <p class="text-muted-foreground text-sm">{{ t('dashboard.missingType') }}</p>
    }
  `,
})
export class CountWidget {
  private readonly api = inject(Api);
  private readonly schema = inject(Schema);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;

  readonly config = input.required<WidgetConfig>();
  protected readonly type = computed(() => {
    const uid = this.config().uid;
    return uid ? this.schema.type(uid) : undefined;
  });
  protected readonly total = signal<number | null>(null);
  protected readonly caption = computed(() => {
    const config = this.config();
    const parts = [
      this.t(
        config.unseen
          ? 'dashboard.unseenEntries'
          : config.status === 'published'
            ? 'dashboard.publishedEntries'
            : 'dashboard.allEntries',
      ),
    ];
    const conditions = config.conditions?.length ?? 0;
    if (conditions) parts.push(this.t('dashboard.conditionCount', { count: conditions }));
    if (config.search) parts.push(`“${config.search}”`);
    return parts.join(' · ');
  });

  constructor() {
    effect(() => {
      const type = this.type();
      const config = this.config();
      untracked(() => void this.load(type, config));
    });
  }

  private async load(type: ContentType | undefined, config: WidgetConfig): Promise<void> {
    if (!type) return;
    this.total.set(null);
    try {
      const response = await this.api.list<Document>(
        `/content/${type.uid}`,
        listQuery(this.schema, type, config, 1),
      );
      this.total.set(response.meta.pagination?.total ?? 0);
    } catch {
      this.total.set(0);
    }
  }
}

/** Latest entries of one type (`list`) or of every readable type (`recent`). */
@Component({
  selector: 'vd-entries-widget',
  imports: [RouterLink, HlmBadgeImports, HlmSkeletonImports, VoteControl],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (rows() === null) {
      <div class="flex flex-col gap-2">
        @for (row of placeholders(); track row) {
          <hlm-skeleton class="h-8 w-full" />
        }
      </div>
    } @else if (rows()!.length === 0) {
      <p class="text-muted-foreground py-6 text-center text-sm">
        {{ config().unseen ? t('dashboard.allSeen') : t('dashboard.noEntries') }}
      </p>
    } @else {
      <ul class="-mx-2 flex flex-col">
        @for (row of rows(); track row.type.uid + row.document.documentId) {
          <li class="flex items-center gap-1">
            <a
              class="hover:bg-accent flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-1.5 text-sm transition-colors"
              [routerLink]="['/content', row.type.uid, row.document.documentId]"
            >
              @if (config().unseen) {
                <span class="bg-primary size-1.5 shrink-0 rounded-full" aria-hidden="true"></span>
              }
              <span class="min-w-0 flex-1 truncate font-medium">{{ label(row) }}</span>
              @if (showType()) {
                <span hlmBadge variant="secondary" class="shrink-0 font-normal">{{
                  row.type.displayName
                }}</span>
              }
              <span
                class="text-muted-foreground w-24 shrink-0 text-end text-xs"
                [title]="i18n.formatDate(row.document.updatedAt, 'long')"
                >{{ i18n.formatRelative(row.document.updatedAt) }}</span
              >
            </a>
            @if (config().showVotes) {
              <vd-vote-control
                [uid]="row.type.uid"
                [documentId]="row.document.documentId"
                [initial]="tallies()[row.document.documentId] ?? null"
                size="13"
              />
            }
          </li>
        }
      </ul>
    }
  `,
})
export class EntriesWidget {
  private readonly api = inject(Api);
  private readonly auth = inject(Auth);
  private readonly schema = inject(Schema);
  private readonly engagement = inject(Engagement);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;

  readonly config = input.required<WidgetConfig>();

  private readonly types = computed(() => {
    const uid = this.config().uid;
    const readable = this.schema
      .collections()
      .filter((type) => this.auth.canContent('content.read', type.uid));
    return uid ? readable.filter((type) => type.uid === uid) : readable.slice(0, 12);
  });
  protected readonly showType = computed(() => !this.config().uid);
  private readonly limit = computed(() => Math.min(Math.max(this.config().limit ?? 5, 1), 20));
  protected readonly placeholders = computed(() =>
    Array.from({ length: Math.min(this.limit(), 5) }, (_, index) => index),
  );
  protected readonly rows = signal<Row[] | null>(null);
  protected readonly tallies = signal<Record<string, VoteTally>>({});

  constructor() {
    effect(() => {
      const types = this.types();
      const config = this.config();
      const limit = this.limit();
      untracked(() => void this.load(types, config, limit));
    });
  }

  protected label(row: Row): string {
    return documentLabel(row.document, this.schema.titleField(row.type));
  }

  private async load(types: ContentType[], config: WidgetConfig, limit: number): Promise<void> {
    this.rows.set(null);
    let rows: Row[];
    if (config.sort === 'votes:desc' && types.length === 1) {
      rows = await this.mostVoted(types[0], config, limit);
    } else {
      const results = await Promise.all(
        types.map(async (type) => {
          try {
            const response = await this.api.list<Document>(
              `/content/${type.uid}`,
              listQuery(this.schema, type, config, limit),
            );
            return response.data.map((document) => ({ type, document }));
          } catch {
            return [];
          }
        }),
      );
      rows = results.flat();
      // One type keeps the server's order; several are merged by last update.
      if (types.length > 1) {
        rows.sort((a, b) =>
          String(b.document.updatedAt).localeCompare(String(a.document.updatedAt)),
        );
      }
      rows = rows.slice(0, limit);
    }
    if (config.showVotes) await this.loadTallies(rows);
    this.rows.set(rows);
  }

  /** Best scored entries that also match the widget's filters, best first. */
  private async mostVoted(type: ContentType, config: WidgetConfig, limit: number): Promise<Row[]> {
    try {
      const top = await this.engagement.topVoted(type.uid, Math.min(limit * 3, 50));
      if (!top.length) return [];
      const ids = top.map((item) => item.documentId);
      const inIds = { documentId: { $in: Object.fromEntries(ids.entries()) } };
      const response = await this.api.list<Document>(
        `/content/${type.uid}`,
        listQuery(this.schema, type, config, ids.length, [inIds]),
      );
      const byId = new Map(response.data.map((document) => [document.documentId, document]));
      this.tallies.set(Object.fromEntries(top.map((item) => [item.documentId, item])));
      return ids
        .map((id) => byId.get(id))
        .filter((document): document is Document => !!document)
        .slice(0, limit)
        .map((document) => ({ type, document }));
    } catch {
      return [];
    }
  }

  private async loadTallies(rows: Row[]): Promise<void> {
    const byType = new Map<string, string[]>();
    for (const row of rows) {
      byType.set(row.type.uid, [...(byType.get(row.type.uid) ?? []), row.document.documentId]);
    }
    const all: Record<string, VoteTally> = {};
    await Promise.all(
      [...byType].map(async ([uid, ids]) => {
        try {
          Object.assign(all, await this.engagement.votes(uid, ids));
        } catch {
          // Rows still render without scores.
        }
      }),
    );
    this.tallies.set(all);
  }
}

/** A poll: vote by clicking an option; results as bars. */
@Component({
  selector: 'vd-poll-widget',
  imports: [NgIcon, HlmButtonImports, HlmBadgeImports, HlmSkeletonImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (poll(); as poll) {
      <div class="flex flex-col gap-3">
        <p class="text-sm font-medium">{{ poll.question }}</p>
        <ul class="flex flex-col gap-2">
          @for (option of poll.options; track $index; let index = $index) {
            <li>
              <button
                type="button"
                class="group relative flex w-full items-center gap-2 overflow-hidden rounded-md border px-3 py-2 text-start text-sm transition-colors enabled:hover:border-primary/50 disabled:cursor-default"
                [class.border-primary]="poll.mine.includes(index)"
                [disabled]="!poll.open || busy()"
                [attr.aria-pressed]="poll.mine.includes(index)"
                (click)="choose(poll, index)"
              >
                <span
                  class="bg-primary/10 absolute inset-y-0 start-0 transition-all"
                  [style.width.%]="share(poll, index)"
                  aria-hidden="true"
                ></span>
                <span class="relative flex size-4 shrink-0 items-center justify-center">
                  @if (poll.mine.includes(index)) {
                    <ng-icon name="lucideCheck" size="14" class="text-primary" />
                  } @else {
                    <span
                      class="border-muted-foreground/40 size-3 border"
                      [class.rounded-full]="!poll.multiple"
                      [class.rounded-sm]="poll.multiple"
                    ></span>
                  }
                </span>
                <span class="relative min-w-0 flex-1 truncate">{{ option }}</span>
                <span class="text-muted-foreground relative text-xs tabular-nums"
                  >{{ i18n.formatNumber(poll.results[index] ?? 0) }} ·
                  {{ i18n.formatNumber(share(poll, index)) }}%</span
                >
              </button>
            </li>
          }
        </ul>
        <div class="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
          <span>{{ t('poll.voters', { count: poll.voters }) }}</span>
          @if (!poll.open) {
            <span hlmBadge variant="secondary">{{ t('poll.closed') }}</span>
          } @else if (poll.closesAt) {
            <span
              >· {{ t('poll.closesAt', { date: i18n.formatDate(poll.closesAt, 'date') }) }}</span
            >
          }
          @if (poll.multiple) {
            <span>· {{ t('poll.multiple') }}</span>
          }
          @if (poll.canManage) {
            <button
              hlmBtn
              variant="ghost"
              size="xs"
              class="ms-auto"
              [disabled]="busy()"
              (click)="toggleClosed(poll)"
            >
              <ng-icon [name]="poll.closed ? 'lucideLockOpen' : 'lucideLock'" />
              {{ poll.closed ? t('poll.reopen') : t('poll.close') }}
            </button>
          }
        </div>
        @if (error()) {
          <p class="text-destructive text-xs">{{ error() }}</p>
        }
      </div>
    } @else if (missing()) {
      <p class="text-muted-foreground text-sm">{{ t('poll.missing') }}</p>
    } @else {
      <div class="flex flex-col gap-2">
        <hlm-skeleton class="h-5 w-2/3" />
        <hlm-skeleton class="h-9 w-full" />
        <hlm-skeleton class="h-9 w-full" />
      </div>
    }
  `,
})
export class PollWidget {
  private readonly engagement = inject(Engagement);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;

  readonly config = input.required<WidgetConfig>();
  protected readonly poll = signal<Poll | null>(null);
  protected readonly missing = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    effect(() => {
      const id = this.config().pollId;
      untracked(() => void this.load(id));
    });
  }

  private async load(id: number | undefined): Promise<void> {
    this.poll.set(null);
    this.missing.set(false);
    if (!id) {
      this.missing.set(true);
      return;
    }
    try {
      this.poll.set(await this.engagement.poll(id));
    } catch {
      this.missing.set(true);
    }
  }

  protected share(poll: Poll, index: number): number {
    const total = poll.results.reduce((sum, count) => sum + count, 0);
    return total ? Math.round(((poll.results[index] ?? 0) / total) * 100) : 0;
  }

  protected async choose(poll: Poll, index: number): Promise<void> {
    const chosen = poll.mine.includes(index);
    const choices = poll.multiple
      ? chosen
        ? poll.mine.filter((choice) => choice !== index)
        : [...poll.mine, index]
      : chosen
        ? []
        : [index];
    await this.run(() => this.engagement.votePoll(poll.id, choices));
  }

  protected async toggleClosed(poll: Poll): Promise<void> {
    await this.run(() => this.engagement.closePoll(poll.id, !poll.closed));
  }

  private async run(action: () => Promise<Poll>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      this.poll.set(await action());
    } catch (error) {
      this.error.set(ApiFailure.from(error).message);
    } finally {
      this.busy.set(false);
    }
  }
}

interface QuickLink {
  icon: string;
  title: MessageKey;
  hint: MessageKey;
  link?: string;
  href?: string;
}

@Component({
  selector: 'vd-links-widget',
  imports: [RouterLink, NgIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="-mx-2 flex flex-col">
      @for (item of links(); track item.title) {
        @if (item.link) {
          <a
            class="hover:bg-accent flex items-start gap-3 rounded-md px-2 py-2 transition-colors"
            [routerLink]="item.link"
          >
            <ng-icon [name]="item.icon" class="text-primary mt-0.5" />
            <span class="flex flex-col">
              <span class="text-sm font-medium">{{ t(item.title) }}</span>
              <span class="text-muted-foreground text-xs">{{ t(item.hint) }}</span>
            </span>
          </a>
        } @else {
          <a
            class="hover:bg-accent flex items-start gap-3 rounded-md px-2 py-2 transition-colors"
            [href]="item.href"
            target="_blank"
            rel="noopener"
          >
            <ng-icon [name]="item.icon" class="text-primary mt-0.5" />
            <span class="flex flex-col">
              <span class="flex items-center gap-1 text-sm font-medium"
                >{{ t(item.title) }}
                <ng-icon name="lucideExternalLink" size="12" class="text-muted-foreground"
              /></span>
              <span class="text-muted-foreground text-xs">{{ t(item.hint) }}</span>
            </span>
          </a>
        }
      }
    </div>
  `,
})
export class LinksWidget {
  private readonly auth = inject(Auth);
  private readonly schema = inject(Schema);
  private readonly config = inject(RUNTIME_CONFIG);
  protected readonly t = inject(I18n).t;

  protected readonly links = computed(() => {
    const links: QuickLink[] = [];
    if (this.schema.devMode() && this.auth.can('schema.manage')) {
      links.push({
        icon: 'lucideBlocks',
        title: 'home.linkBuilder',
        hint: 'home.linkBuilderHint',
        link: '/builder',
      });
    }
    if (this.auth.can('tokens.manage')) {
      links.push({
        icon: 'lucideKeyRound',
        title: 'home.linkTokens',
        hint: 'home.linkTokensHint',
        link: '/settings/tokens',
      });
    }
    if (this.auth.can('roles.manage')) {
      links.push({
        icon: 'lucideGlobe',
        title: 'home.linkPublic',
        hint: 'home.linkPublicHint',
        link: '/settings/public',
      });
    }
    links.push({
      icon: 'lucideBookOpen',
      title: 'home.linkApi',
      hint: 'home.linkApiHint',
      href: `${this.config.contentApiBase}/_openapi.json`,
    });
    return links;
  });
}

@Component({
  selector: 'vd-system-widget',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (schema.info(); as info) {
      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt class="text-muted-foreground">{{ t('home.version') }}</dt>
        <dd class="font-mono text-xs leading-5">{{ info.version }}</dd>
        <dt class="text-muted-foreground">{{ t('home.database') }}</dt>
        <dd class="truncate">{{ info.database }}</dd>
        <dt class="text-muted-foreground">{{ t('home.mode') }}</dt>
        <dd>
          {{ t(info.mode === 'development' ? 'shell.mode.development' : 'shell.mode.production') }}
        </dd>
        <dt class="text-muted-foreground">{{ t('dashboard.types') }}</dt>
        <dd class="tabular-nums">
          {{
            t('dashboard.typesValue', {
              types: schema.contentTypes().length,
              components: schema.components().length,
            })
          }}
        </dd>
      </dl>
    }
  `,
})
export class SystemWidget {
  protected readonly schema = inject(Schema);
  protected readonly t = inject(I18n).t;
}

@Component({
  selector: 'vd-note-widget',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (config().text) {
      <p class="text-sm leading-relaxed whitespace-pre-line">{{ config().text }}</p>
    } @else {
      <p class="text-muted-foreground text-sm">{{ t('dashboard.noteEmpty') }}</p>
    }
  `,
})
export class NoteWidget {
  protected readonly t = inject(I18n).t;
  readonly config = input.required<WidgetConfig>();
}

const SERIES_LABELS: Record<ChartSeries, MessageKey> = {
  created: 'dashboard.chart.created',
  published: 'dashboard.chart.published',
};

/** Theme colors of the series (CSS variables of the palette). */
const SERIES_COLORS: Record<ChartSeries, string> = {
  created: 'var(--chart-1)',
  published: 'var(--chart-3)',
};

const CHART_WIDTH = 600;
const CHART_HEIGHT = 160;

/** Entries created and published per day or week, as a line or bar chart. */
@Component({
  selector: 'vd-chart-widget',
  imports: [HlmSkeletonImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!type()) {
      <p class="text-muted-foreground text-sm">{{ t('dashboard.missingType') }}</p>
    } @else if (error()) {
      <p class="text-muted-foreground text-sm">{{ error() }}</p>
    } @else if (!stats() || !chart()) {
      <hlm-skeleton class="h-48 w-full" />
    } @else {
      @let geometry = chart()!;
      <div class="flex flex-col gap-3">
        <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          @for (line of geometry.lines; track line.key) {
            <span class="flex items-center gap-1.5">
              <span
                class="size-2.5 rounded-sm"
                [style.background]="colors[line.key]"
                aria-hidden="true"
              ></span>
              <span class="text-muted-foreground">{{ t(labels[line.key]) }}</span>
              <span class="font-medium tabular-nums">{{ i18n.formatNumber(line.sum) }}</span>
            </span>
          }
          <span class="text-muted-foreground ms-auto tabular-nums">
            {{ t('dashboard.chart.totalDocuments', { count: stats()!.totals.documents }) }} ·
            {{ t('dashboard.chart.totalPublished', { count: stats()!.totals.published }) }}
          </span>
        </div>
        <div class="flex gap-2">
          <div
            class="text-muted-foreground flex h-40 flex-col justify-between text-end text-[10px] leading-none tabular-nums"
            aria-hidden="true"
          >
            <span>{{ i18n.formatNumber(geometry.max) }}</span>
            <span>0</span>
          </div>
          <svg
            role="img"
            class="h-40 min-w-0 flex-1 overflow-visible"
            preserveAspectRatio="none"
            [attr.viewBox]="'0 0 ' + geometry.width + ' ' + geometry.height"
            [attr.aria-label]="summary()"
          >
            @for (tick of geometry.tickY; track $index) {
              <line
                x1="0"
                [attr.x2]="geometry.width"
                [attr.y1]="tick"
                [attr.y2]="tick"
                stroke="var(--border)"
                stroke-width="1"
                vector-effect="non-scaling-stroke"
              />
            }
            @for (line of geometry.lines; track line.key) {
              @if (style() === 'bar') {
                @for (bar of line.bars; track bar.date) {
                  <rect
                    [attr.x]="bar.x"
                    [attr.y]="bar.y"
                    [attr.width]="bar.width"
                    [attr.height]="bar.height"
                    [attr.fill]="colors[line.key]"
                    rx="1"
                  >
                    <title>{{ tooltip(line.key, bar.date, bar.value) }}</title>
                  </rect>
                }
              } @else {
                <path [attr.d]="line.area" [attr.fill]="colors[line.key]" fill-opacity="0.12" />
                <path
                  [attr.d]="line.path"
                  fill="none"
                  [attr.stroke]="colors[line.key]"
                  stroke-width="2"
                  stroke-linejoin="round"
                  stroke-linecap="round"
                  vector-effect="non-scaling-stroke"
                />
              }
            }
          </svg>
        </div>
        @if (stats()!.series.length) {
          <div
            class="text-muted-foreground flex justify-between ps-6 text-[10px] tabular-nums"
            aria-hidden="true"
          >
            <span>{{ i18n.formatDate(stats()!.series[0].date, 'date') }}</span>
            <span>{{
              i18n.formatDate(stats()!.series[stats()!.series.length - 1].date, 'date')
            }}</span>
          </div>
        }
        <table class="sr-only">
          <caption>
            {{
              summary()
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('dashboard.chart.date') }}</th>
              @for (key of series(); track key) {
                <th scope="col">{{ t(labels[key]) }}</th>
              }
            </tr>
          </thead>
          <tbody>
            @for (point of stats()!.series; track point.date) {
              <tr>
                <th scope="row">{{ i18n.formatDate(point.date, 'date') }}</th>
                @for (key of series(); track key) {
                  <td>{{ i18n.formatNumber(point[key]) }}</td>
                }
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
})
export class ChartWidget {
  private readonly api = inject(Api);
  private readonly schema = inject(Schema);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  protected readonly labels = SERIES_LABELS;
  protected readonly colors = SERIES_COLORS;

  readonly config = input.required<WidgetConfig>();
  protected readonly type = computed(() => {
    const uid = this.config().uid;
    return uid ? this.schema.type(uid) : undefined;
  });
  protected readonly days = computed(() => this.config().days ?? 30);
  protected readonly interval = computed(() => this.config().interval ?? 'day');
  protected readonly style = computed(() => this.config().chart ?? 'line');
  protected readonly series = computed<ChartSeries[]>(() => {
    const series = (this.config().series ?? []).filter((key) => key in SERIES_LABELS);
    return series.length ? series : ['created', 'published'];
  });
  protected readonly stats = signal<ContentStats | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly chart = computed(() => {
    const stats = this.stats();
    return stats ? buildChart(stats.series, this.series(), CHART_WIDTH, CHART_HEIGHT) : null;
  });
  protected readonly summary = computed(() => {
    const chart = this.chart();
    const type = this.type();
    if (!chart || !type) return '';
    const values = chart.lines
      .map((line) =>
        this.t('dashboard.chart.sum', { series: this.t(SERIES_LABELS[line.key]), count: line.sum }),
      )
      .join('; ');
    return this.t('dashboard.chart.summary', {
      type: type.displayName,
      count: this.days(),
      values,
    });
  });

  constructor() {
    effect(() => {
      const type = this.type();
      const days = this.days();
      const interval = this.interval();
      untracked(() => void this.load(type?.uid, days, interval));
    });
  }

  protected tooltip(key: ChartSeries, date: string, value: number): string {
    return `${this.i18n.formatDate(date, 'date')} · ${this.t(SERIES_LABELS[key])}: ${this.i18n.formatNumber(value)}`;
  }

  private request = 0;

  private async load(uid: string | undefined, days: number, interval: string): Promise<void> {
    if (!uid) return;
    const request = ++this.request;
    this.stats.set(null);
    this.error.set(null);
    try {
      const stats = await this.api.get<ContentStats>(
        `/content/${uid}/stats`,
        toQuery({ days, interval }),
      );
      if (request === this.request) this.stats.set(stats);
    } catch (error) {
      if (request === this.request) {
        const failure = ApiFailure.from(error);
        this.error.set(
          failure.status === 403
            ? this.t('dashboard.chart.forbidden')
            : this.t('dashboard.chart.error'),
        );
      }
    }
  }
}

/** A plugin's widget: its custom element, given a `context` to call the API with. */
@Component({
  selector: 'vd-plugin-widget',
  imports: [HlmSkeletonImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-w-0' },
  template: `
    @if (!definition()) {
      @if (extensions.loaded()) {
        <p class="text-muted-foreground text-sm">
          {{ t('dashboard.pluginMissing', { plugin: config().plugin ?? '?' }) }}
        </p>
      } @else {
        <hlm-skeleton class="h-24 w-full" />
      }
    }
  `,
})
export class PluginWidgetHost {
  protected readonly extensions = inject(PluginExtensions);
  protected readonly t = inject(I18n).t;

  readonly config = input.required<WidgetConfig>();
  protected readonly definition = computed(() =>
    this.extensions.widget(this.config().plugin, this.config().widget),
  );
  /** The element goes first in the host, before Angular's own nodes. */
  private readonly host: HTMLElement = inject(ElementRef).nativeElement;

  constructor() {
    effect((onCleanup) => {
      const definition = this.definition();
      if (!definition) return;
      let node: HTMLElement & { context?: unknown };
      try {
        node = document.createElement(definition.element);
      } catch (error) {
        console.warn(`Could not create <${definition.element}>`, error);
        return;
      }
      node.context = untracked(() => this.extensions.context());
      this.host.prepend(node);
      onCleanup(() => node.remove());
    });
  }
}
