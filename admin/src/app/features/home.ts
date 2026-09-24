import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';

import { Auth } from '../core/auth';
import { Dashboard, DashboardLayout, Widget, defaultLayout } from '../core/dashboard';
import { I18n } from '../core/i18n/i18n';
import { Schema } from '../core/schema';
import { PageHeader } from '../shared/components/page-header';
import { WIDGET_KINDS, WidgetDialog } from './dashboard/widget-dialog';
import {
  CountWidget,
  EntriesWidget,
  LinksWidget,
  NoteWidget,
  PollWidget,
  SystemWidget,
} from './dashboard/widgets';

const SPAN: Record<number, string> = {
  1: '',
  2: 'md:col-span-2',
  3: 'md:col-span-2 xl:col-span-3',
  4: 'md:col-span-2 xl:col-span-4',
};

/** The dashboard: a grid of widgets each user can add, configure, reorder and remove. */
@Component({
  selector: 'vd-home',
  imports: [
    RouterLink,
    NgIcon,
    HlmButtonImports,
    HlmEmptyImports,
    HlmSkeletonImports,
    PageHeader,
    WidgetDialog,
    CountWidget,
    EntriesWidget,
    LinksWidget,
    SystemWidget,
    NoteWidget,
    PollWidget,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-6">
      <vd-page-header [title]="greeting()" [description]="t('home.subtitle')">
        <div actions>
          @if (editing()) {
            <button hlmBtn variant="ghost" size="sm" (click)="reset()">
              <ng-icon name="lucideUndo2" /> {{ t('dashboard.reset') }}
            </button>
            <button hlmBtn variant="outline" size="sm" (click)="add()">
              <ng-icon name="lucidePlus" /> {{ t('dashboard.addWidget') }}
            </button>
            <button hlmBtn size="sm" (click)="editing.set(false)">
              <ng-icon name="lucideCheck" /> {{ t('dashboard.done') }}
            </button>
          } @else {
            <button hlmBtn variant="outline" size="sm" (click)="editing.set(true)">
              <ng-icon name="lucideLayoutDashboard" /> {{ t('dashboard.customize') }}
            </button>
          }
        </div>
      </vd-page-header>

      @if (schema.contentTypes().length === 0 && !editing()) {
        <div hlmEmpty class="rounded-xl border border-dashed py-16">
          <div hlmEmptyHeader>
            <div hlmEmptyMedia variant="icon"><ng-icon name="lucideBlocks" /></div>
            <h2 hlmEmptyTitle>{{ t('home.emptyTitle') }}</h2>
            <p hlmEmptyDescription>
              {{ schema.devMode() ? t('home.emptyDev') : t('home.emptyProd') }}
            </p>
          </div>
          @if (schema.devMode() && auth.can('schema.manage')) {
            <div hlmEmptyContent>
              <a hlmBtn routerLink="/builder"
                ><ng-icon name="lucidePlus" /> {{ t('home.createType') }}</a
              >
            </div>
          }
        </div>
      } @else if (!dashboard.loaded()) {
        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          @for (row of [1, 2, 3, 4]; track row) {
            <hlm-skeleton class="h-32 rounded-xl" />
          }
        </div>
      } @else {
        <div class="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-4">
          @for (widget of widgets(); track widget.id; let index = $index, last = $last) {
            <section
              class="bg-card text-card-foreground flex flex-col gap-4 rounded-xl border p-5 shadow-xs transition-shadow"
              [class]="span(widget)"
              [class.ring-2]="editing()"
              [class.ring-primary/20]="editing()"
            >
              <header class="flex min-h-7 items-center gap-2">
                <h2 class="min-w-0 flex-1 truncate text-sm font-medium">{{ title(widget) }}</h2>
                @if (editing()) {
                  <div class="-me-2 flex items-center">
                    <button
                      hlmBtn
                      size="icon-sm"
                      variant="ghost"
                      [attr.aria-label]="t('dashboard.moveLeft')"
                      [disabled]="index === 0"
                      (click)="move(index, -1)"
                    >
                      <ng-icon name="lucideArrowLeft" class="rtl:rotate-180" />
                    </button>
                    <button
                      hlmBtn
                      size="icon-sm"
                      variant="ghost"
                      [attr.aria-label]="t('dashboard.moveRight')"
                      [disabled]="last"
                      (click)="move(index, 1)"
                    >
                      <ng-icon name="lucideArrowRight" class="rtl:rotate-180" />
                    </button>
                    <button
                      hlmBtn
                      size="icon-sm"
                      variant="ghost"
                      [attr.aria-label]="t('dashboard.configure')"
                      (click)="configure(widget)"
                    >
                      <ng-icon name="lucideSettings" />
                    </button>
                    <button
                      hlmBtn
                      size="icon-sm"
                      variant="ghost"
                      [attr.aria-label]="t('dashboard.remove')"
                      (click)="remove(widget)"
                    >
                      <ng-icon name="lucideTrash2" />
                    </button>
                  </div>
                }
              </header>
              @switch (widget.type) {
                @case ('count') {
                  <vd-count-widget [config]="widget.config" />
                }
                @case ('recent') {
                  <vd-entries-widget [config]="widget.config" />
                }
                @case ('list') {
                  <vd-entries-widget [config]="widget.config" />
                }
                @case ('links') {
                  <vd-links-widget />
                }
                @case ('system') {
                  <vd-system-widget />
                }
                @case ('note') {
                  <vd-note-widget [config]="widget.config" />
                }
                @case ('poll') {
                  <vd-poll-widget [config]="widget.config" />
                }
              }
            </section>
          }
          @if (editing()) {
            <button
              type="button"
              class="text-muted-foreground hover:border-primary/50 hover:text-foreground flex min-h-32 flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-sm transition-colors"
              (click)="add()"
            >
              <ng-icon name="lucidePlus" size="20" />
              {{ t('dashboard.addWidget') }}
            </button>
          }
        </div>
      }
    </div>

    <vd-widget-dialog
      [open]="dialogOpen()"
      [widget]="editingWidget()"
      (saved)="save($event)"
      (closed)="dialogOpen.set(false)"
    />
  `,
})
export class HomePage {
  protected readonly auth = inject(Auth);
  protected readonly schema = inject(Schema);
  protected readonly dashboard = inject(Dashboard);
  protected readonly t = inject(I18n).t;

  protected readonly editing = signal(false);
  protected readonly dialogOpen = signal(false);
  protected readonly editingWidget = signal<Widget | null>(null);

  private readonly layout = computed<DashboardLayout>(
    () => this.dashboard.layout() ?? defaultLayout(this.readableTypes()),
  );
  private readonly readableTypes = computed(() =>
    this.schema.contentTypes().filter((type) => this.auth.canContent('content.read', type.uid)),
  );
  protected readonly widgets = computed(() => this.layout().widgets);

  protected readonly greeting = computed(() => {
    const name = this.auth.user()?.firstname;
    return name ? this.t('home.greetingName', { name }) : this.t('home.greeting');
  });

  constructor() {
    void this.dashboard.load();
  }

  protected span(widget: Widget): string {
    return SPAN[widget.width] ?? '';
  }

  protected title(widget: Widget): string {
    if (widget.title) return widget.title;
    const uid = widget.config.uid;
    const type = uid ? this.schema.type(uid) : undefined;
    if ((widget.type === 'count' || widget.type === 'list') && type) return type.displayName;
    if (widget.type === 'recent' && type) {
      return this.t('dashboard.recentOf', { type: type.displayName });
    }
    const kind = WIDGET_KINDS.find((item) => item.type === widget.type);
    return kind ? this.t(kind.label) : widget.type;
  }

  protected add(): void {
    this.editingWidget.set(null);
    this.dialogOpen.set(true);
  }

  protected configure(widget: Widget): void {
    this.editingWidget.set(widget);
    this.dialogOpen.set(true);
  }

  protected save(widget: Widget): void {
    const widgets = this.widgets();
    const exists = widgets.some((item) => item.id === widget.id);
    this.update(
      exists
        ? widgets.map((item) => (item.id === widget.id ? widget : item))
        : [...widgets, widget],
    );
    this.dialogOpen.set(false);
  }

  protected remove(widget: Widget): void {
    this.update(this.widgets().filter((item) => item.id !== widget.id));
  }

  protected move(index: number, delta: number): void {
    const widgets = [...this.widgets()];
    const [widget] = widgets.splice(index, 1);
    widgets.splice(index + delta, 0, widget);
    this.update(widgets);
  }

  protected async reset(): Promise<void> {
    await this.dashboard.reset();
  }

  private update(widgets: Widget[]): void {
    void this.dashboard.set({ version: 1, widgets });
  }
}
