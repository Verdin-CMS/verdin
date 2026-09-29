import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList } from '@angular/cdk/drag-drop';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';

import { ApiFailure, RUNTIME_CONFIG } from '../../core/api';
import { I18n } from '../../core/i18n/i18n';
import { MessageKey } from '../../core/i18n/keys';
import {
  ItemProblem,
  MAX_MENU_DEPTH,
  MAX_MENU_ITEMS,
  MenuNode,
  addNode,
  canIndent,
  canOutdent,
  countItems,
  emptyNode,
  findNode,
  flatten,
  fromItems,
  indent,
  moveNode,
  moveRow,
  outdent,
  removeNode,
  toItems,
  treeDepth,
  treeProblems,
  updateNode,
} from '../../core/menu-tree';
import { ContentDocuments } from '../../core/documents';
import { Schema } from '../../core/schema';
import { Site, slugify, validSlug } from '../../core/site';
import { EntryPicker, PickedEntry } from '../content/fields/entry-picker';
import { documentLabel } from '../content/fields/model';
import { PageHeader } from '../../shared/components/page-header';
import { SiteAccessNotice, siteAccess } from './site-access';

const PROBLEM_LABELS: Record<ItemProblem, MessageKey> = {
  label: 'menus.problem.label',
  labelLength: 'menus.problem.labelLength',
  url: 'menus.problem.url',
  entry: 'menus.problem.entry',
};

type EntryLink = NonNullable<MenuNode['entry']>;

/** The entry a menu link opens: shown with a clear button, chosen with the entry picker. */
@Component({
  selector: 'vd-menu-entry-picker',
  imports: [NgIcon, HlmButtonImports, EntryPicker],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-3">
      @if (value(); as entry) {
        <div class="bg-muted/50 flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
          <ng-icon name="lucideLink" class="text-muted-foreground shrink-0" />
          <span class="min-w-0 flex-1 truncate" data-menu-entry>{{
            entry.title ?? entry.documentId
          }}</span>
          <button
            hlmBtn
            size="icon-xs"
            variant="ghost"
            type="button"
            [attr.aria-label]="t('menus.entry.clear')"
            (click)="clear()"
          >
            <ng-icon name="lucideX" />
          </button>
        </div>
      }
      <div>
        <button hlmBtn variant="outline" size="sm" type="button" (click)="pickerOpen.set(true)">
          <ng-icon name="lucideLink" />
          {{ value() ? t('menus.entry.change') : t('menus.entry.choose') }}
        </button>
      </div>
    </div>

    <vd-entry-picker
      [open]="pickerOpen()"
      [description]="t('menus.entry.pickerDescription')"
      [types]="types()"
      [linked]="linked()"
      (picked)="pick($event)"
      (closed)="pickerOpen.set(false)"
    />
  `,
})
export class MenuEntryPicker {
  private readonly documents = inject(ContentDocuments);
  private readonly schema = inject(Schema);
  protected readonly t = inject(I18n).t;

  readonly value = input<EntryLink | null>(null);
  readonly changed = output<EntryLink | null>();

  protected readonly pickerOpen = signal(false);
  /** Menu links open collection entries. */
  protected readonly types = computed(() => this.schema.collections().map((type) => type.uid));
  protected readonly linked = computed(() => {
    const entry = this.value();
    return entry ? [{ uid: entry.uid, documentId: entry.documentId }] : [];
  });

  constructor() {
    // Entries linked before carry no title: fetch it once.
    effect(() => {
      const entry = this.value();
      if (!entry || entry.title) return;
      untracked(() => void this.resolveTitle(entry));
    });
  }

  private titleField(uid: string): string | null {
    const type = this.schema.type(uid);
    return type ? this.schema.titleField(type) : null;
  }

  private async resolveTitle(entry: EntryLink): Promise<void> {
    try {
      const document = await this.documents.get(entry.uid, entry.documentId);
      const title = documentLabel(document, this.titleField(entry.uid));
      if (this.value()?.documentId === entry.documentId) this.changed.emit({ ...entry, title });
    } catch {
      // The entry may be gone; the save reports it.
    }
  }

  protected pick(entries: PickedEntry[]): void {
    this.pickerOpen.set(false);
    const [entry] = entries;
    if (entry)
      this.changed.emit({ uid: entry.uid, documentId: entry.documentId, title: entry.label });
  }

  protected clear(): void {
    this.changed.emit(null);
  }
}

/** Settings → Menus → one menu: a reorderable tree of links. */
@Component({
  selector: 'vd-menu-edit',
  imports: [
    NgIcon,
    RouterLink,
    CdkDropList,
    CdkDrag,
    CdkDragHandle,
    MenuEntryPicker,
    SiteAccessNotice,
    HlmAlertImports,
    HlmButtonImports,
    HlmEmptyImports,
    HlmFieldImports,
    HlmInputImports,
    HlmNativeSelectImports,
    HlmSkeletonImports,
    HlmSpinnerImports,
    PageHeader,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-6">
      <a
        routerLink="/settings/menus"
        class="text-muted-foreground hover:text-foreground flex w-fit items-center gap-1.5 text-sm"
      >
        <ng-icon name="lucideArrowLeft" class="rtl:-scale-x-100" /> {{ t('menus.back') }}
      </a>
      <vd-page-header
        [title]="isNew() ? t('menus.newTitle') : name() || t('menus.untitled')"
        [description]="t('menus.editorHint')"
      >
        @if (access() === 'ok' && loaded()) {
          <div actions>
            <button hlmBtn data-menu-save [disabled]="saving()" (click)="save()">
              @if (saving()) {
                <hlm-spinner class="size-4" />
              } @else {
                <ng-icon name="lucideSave" />
              }
              {{ t('common.save') }}
            </button>
          </div>
        }
      </vd-page-header>

      @if (access() !== 'ok') {
        <vd-site-access [access]="access()" feature="menus" />
      } @else if (loadError()) {
        <p class="text-destructive text-sm" role="alert">{{ loadError() }}</p>
      } @else if (!loaded()) {
        <hlm-skeleton class="h-64 rounded-xl" />
      } @else {
        <div class="grid gap-4 sm:grid-cols-2">
          <div hlmField [attr.data-invalid]="showErrors() && !name().trim() ? true : null">
            <label hlmFieldLabel for="menu-name">{{ t('common.name') }}</label>
            <input
              hlmInput
              id="menu-name"
              autocomplete="off"
              maxlength="255"
              [placeholder]="t('menus.namePlaceholder')"
              [value]="name()"
              (input)="setName($any($event.target).value)"
            />
            @if (showErrors() && !name().trim()) {
              <hlm-field-error forceShow>{{ t('menus.problem.name') }}</hlm-field-error>
            }
          </div>
          <div hlmField [attr.data-invalid]="showErrors() && !slugValid() ? true : null">
            <label hlmFieldLabel for="menu-slug">{{ t('menus.slug') }}</label>
            <input
              hlmInput
              dir="ltr"
              id="menu-slug"
              autocomplete="off"
              spellcheck="false"
              class="font-mono text-xs"
              placeholder="main"
              aria-describedby="menu-slug-hint"
              [value]="slug()"
              (input)="setSlug($any($event.target).value)"
            />
            <p id="menu-slug-hint" class="text-muted-foreground text-xs">
              {{ t('menus.slugHint', { endpoint: endpoint(slug() || '{slug}') }) }}
            </p>
            @if (showErrors() && !slugValid()) {
              <hlm-field-error forceShow>{{ t('menus.problem.slug') }}</hlm-field-error>
            }
          </div>
        </div>

        @if (saveError()) {
          <div hlmAlert variant="destructive" role="alert">
            <ng-icon hlmAlertIcon name="lucideCircleAlert" />
            <p hlmAlertTitle>{{ t('menus.saveFailed') }}</p>
            <p hlmAlertDescription>{{ saveError() }}</p>
          </div>
        }

        <div class="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <section
            class="bg-card flex flex-col rounded-xl border"
            aria-labelledby="menu-tree-title"
          >
            <header class="flex flex-wrap items-center gap-2 border-b px-4 py-3">
              <div class="flex min-w-0 flex-col">
                <h2 id="menu-tree-title" class="font-medium">{{ t('menus.tree') }}</h2>
                <p class="text-muted-foreground text-xs" id="menu-tree-hint">
                  {{ t('menus.keyboardHint') }}
                </p>
              </div>
              <button hlmBtn size="sm" variant="outline" class="ms-auto" (click)="add(null)">
                <ng-icon name="lucidePlus" /> {{ t('menus.addItem') }}
              </button>
            </header>
            @if (rows().length === 0) {
              <div hlmEmpty class="py-12">
                <div hlmEmptyHeader>
                  <div hlmEmptyMedia variant="icon"><ng-icon name="lucideListTree" /></div>
                  <h3 hlmEmptyTitle>{{ t('menus.noItems') }}</h3>
                  <p hlmEmptyDescription>{{ t('menus.noItemsHint') }}</p>
                </div>
              </div>
            } @else {
              <ul
                class="flex flex-col gap-1 p-2"
                cdkDropList
                cdkDropListLockAxis="y"
                aria-labelledby="menu-tree-title"
                aria-describedby="menu-tree-hint"
                (cdkDropListDropped)="drop($event)"
              >
                @for (row of rows(); track row.node.key) {
                  @let node = row.node;
                  @let label = node.label || t('menus.untitledItem');
                  <li
                    cdkDrag
                    class="bg-background flex items-center gap-1 rounded-md border py-1 pe-1 text-sm"
                    [class.border-primary]="selectedKey() === node.key"
                    [class.border-destructive]="showErrors() && problems().has(node.key)"
                    [style.margin-inline-start.rem]="(row.depth - 1) * 1.5"
                    data-menu-item
                  >
                    <button
                      cdkDragHandle
                      type="button"
                      class="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex cursor-grab items-center rounded-sm p-1 outline-none focus-visible:ring-[3px] active:cursor-grabbing"
                      [attr.data-handle]="node.key"
                      [attr.aria-label]="t('menus.handle', { label })"
                      (keydown)="onHandleKey($event, node)"
                    >
                      <ng-icon name="lucideGripVertical" size="14" />
                    </button>
                    <button
                      type="button"
                      class="hover:bg-muted flex min-w-0 flex-1 flex-col items-start rounded-sm px-2 py-0.5 text-start"
                      [attr.aria-label]="t('menus.select', { label, level: row.depth })"
                      [attr.aria-current]="selectedKey() === node.key ? 'true' : null"
                      (click)="select(node.key)"
                    >
                      <span
                        class="w-full truncate font-medium"
                        [class.text-muted-foreground]="!node.label"
                        >{{ label }}</span
                      >
                      <span
                        dir="ltr"
                        class="text-muted-foreground w-full truncate font-mono text-xs"
                        >{{ linkSummary(node) }}</span
                      >
                    </button>
                    @if (showErrors() && problems().has(node.key)) {
                      <ng-icon
                        name="lucideCircleAlert"
                        class="text-destructive shrink-0"
                        [attr.aria-label]="t('menus.hasProblems')"
                      />
                    }
                    <div class="flex shrink-0 items-center">
                      <button
                        hlmBtn
                        size="icon-xs"
                        variant="ghost"
                        type="button"
                        [disabled]="row.path[row.path.length - 1] === 0"
                        [attr.aria-label]="t('menus.moveUp', { label })"
                        [title]="t('menus.moveUp', { label })"
                        (click)="move(node, -1)"
                      >
                        <ng-icon name="lucideArrowUp" />
                      </button>
                      <button
                        hlmBtn
                        size="icon-xs"
                        variant="ghost"
                        type="button"
                        [disabled]="row.path[row.path.length - 1] === row.siblings - 1"
                        [attr.aria-label]="t('menus.moveDown', { label })"
                        [title]="t('menus.moveDown', { label })"
                        (click)="move(node, 1)"
                      >
                        <ng-icon name="lucideArrowDown" />
                      </button>
                      <button
                        hlmBtn
                        size="icon-xs"
                        variant="ghost"
                        type="button"
                        [disabled]="!outdentable(node)"
                        [attr.aria-label]="t('menus.outdent', { label })"
                        [title]="t('menus.outdent', { label })"
                        (click)="shift(node, 'out')"
                      >
                        <ng-icon name="lucideIndentDecrease" class="rtl:-scale-x-100" />
                      </button>
                      <button
                        hlmBtn
                        size="icon-xs"
                        variant="ghost"
                        type="button"
                        [disabled]="!indentable(node)"
                        [attr.aria-label]="t('menus.indent', { label })"
                        [title]="t('menus.indent', { label })"
                        (click)="shift(node, 'in')"
                      >
                        <ng-icon name="lucideIndentIncrease" class="rtl:-scale-x-100" />
                      </button>
                      <button
                        hlmBtn
                        size="icon-xs"
                        variant="ghost"
                        type="button"
                        [disabled]="row.depth >= maxDepth"
                        [attr.aria-label]="t('menus.addChild', { label })"
                        [title]="t('menus.addChild', { label })"
                        (click)="add(node.key)"
                      >
                        <ng-icon name="lucidePlus" />
                      </button>
                      <button
                        hlmBtn
                        size="icon-xs"
                        variant="ghost"
                        type="button"
                        class="hover:text-destructive"
                        [attr.aria-label]="t('menus.removeItem', { label })"
                        [title]="t('menus.removeItem', { label })"
                        (click)="remove(node)"
                      >
                        <ng-icon name="lucideTrash2" />
                      </button>
                    </div>
                  </li>
                }
              </ul>
            }
            <footer class="text-muted-foreground bg-muted/30 mt-auto border-t px-4 py-2 text-xs">
              {{
                t('menus.stats', {
                  count: count(),
                  max: maxItems,
                  depth: depth(),
                  maxDepth: maxDepth,
                })
              }}
            </footer>
          </section>

          <section
            class="bg-card flex flex-col gap-4 rounded-xl border p-4"
            aria-labelledby="menu-item-title"
          >
            <h2 id="menu-item-title" class="font-medium">{{ t('menus.itemTitle') }}</h2>
            @if (selected(); as node) {
              @let itemProblems = problems().get(node.key) ?? [];
              <div
                hlmField
                [attr.data-invalid]="
                  showErrors() && hasProblem(itemProblems, 'label') ? true : null
                "
              >
                <label hlmFieldLabel for="menu-item-label">{{ t('menus.label') }}</label>
                <input
                  hlmInput
                  id="menu-item-label"
                  autocomplete="off"
                  maxlength="255"
                  [attr.aria-invalid]="
                    showErrors() && hasProblem(itemProblems, 'label') ? true : null
                  "
                  [value]="node.label"
                  (input)="change(node.key, { label: $any($event.target).value })"
                />
              </div>
              <div hlmField>
                <label hlmFieldLabel for="menu-item-link">{{ t('menus.linkTo') }}</label>
                <hlm-native-select
                  selectId="menu-item-link"
                  [value]="node.link"
                  (valueChange)="change(node.key, { link: $any($event) })"
                >
                  <option hlmNativeSelectOption value="url">{{ t('menus.link.url') }}</option>
                  <option hlmNativeSelectOption value="entry">{{ t('menus.link.entry') }}</option>
                  <option hlmNativeSelectOption value="none">{{ t('menus.link.none') }}</option>
                </hlm-native-select>
              </div>
              @if (node.link === 'url') {
                <div hlmField [attr.data-invalid]="hasProblem(itemProblems, 'url') ? true : null">
                  <label hlmFieldLabel for="menu-item-url">{{ t('menus.url') }}</label>
                  <input
                    hlmInput
                    dir="ltr"
                    id="menu-item-url"
                    autocomplete="off"
                    spellcheck="false"
                    class="font-mono text-xs"
                    placeholder="/about"
                    aria-describedby="menu-item-url-hint"
                    [attr.aria-invalid]="hasProblem(itemProblems, 'url') ? true : null"
                    [value]="node.url"
                    (input)="change(node.key, { url: $any($event.target).value })"
                  />
                  <p id="menu-item-url-hint" class="text-muted-foreground text-xs">
                    {{ t('menus.urlHint') }}
                  </p>
                </div>
              } @else if (node.link === 'entry') {
                <vd-menu-entry-picker
                  [value]="node.entry"
                  (changed)="change(node.key, { entry: $event })"
                />
              }
              <div hlmField>
                <label hlmFieldLabel for="menu-item-target">{{ t('menus.target') }}</label>
                <hlm-native-select
                  selectId="menu-item-target"
                  [value]="node.target"
                  (valueChange)="
                    change(node.key, { target: $event === '_blank' ? '_blank' : '_self' })
                  "
                >
                  <option hlmNativeSelectOption value="_self">{{ t('menus.target.self') }}</option>
                  <option hlmNativeSelectOption value="_blank">
                    {{ t('menus.target.blank') }}
                  </option>
                </hlm-native-select>
              </div>
              @if (itemProblems.length && (showErrors() || hasProblem(itemProblems, 'url'))) {
                <ul class="text-destructive flex flex-col gap-1 text-sm" role="alert">
                  @for (problem of itemProblems; track problem) {
                    <li>{{ t(problemLabels[problem]) }}</li>
                  }
                </ul>
              }
            } @else {
              <p class="text-muted-foreground text-sm">{{ t('menus.noSelection') }}</p>
            }
          </section>
        </div>
      }
      <p class="sr-only" aria-live="polite">{{ announcement() }}</p>
    </div>
  `,
})
export class MenuEditPage {
  private readonly site = inject(Site);
  private readonly router = inject(Router);
  private readonly config = inject(RUNTIME_CONFIG);
  private readonly schema = inject(Schema);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  protected readonly access = siteAccess('menus');

  /** The route's `:id` (`new` for a new menu). */
  readonly id = input.required<string>();
  protected readonly isNew = computed(() => this.id() === 'new');

  protected readonly maxDepth = MAX_MENU_DEPTH;
  protected readonly maxItems = MAX_MENU_ITEMS;
  protected readonly problemLabels = PROBLEM_LABELS;
  protected readonly name = signal('');
  protected readonly slug = signal('');
  private slugTouched = false;
  protected readonly tree = signal<MenuNode[]>([]);
  protected readonly selectedKey = signal<string | null>(null);
  protected readonly loaded = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saveError = signal<string | null>(null);
  protected readonly showErrors = signal(false);
  protected readonly saving = signal(false);
  protected readonly announcement = signal('');

  protected readonly rows = computed(() => flatten(this.tree()));
  protected readonly count = computed(() => countItems(this.tree()));
  protected readonly depth = computed(() => treeDepth(this.tree()));
  protected readonly problems = computed(() => treeProblems(this.tree()));
  protected readonly slugValid = computed(() => validSlug(this.slug()));
  protected readonly selected = computed(() => {
    const key = this.selectedKey();
    return key ? findNode(this.tree(), key) : null;
  });

  private loading = false;

  constructor() {
    effect(() => {
      const id = this.id();
      if (this.access() !== 'ok') return;
      untracked(() => void this.load(id));
    });
  }

  protected endpoint(slug: string): string {
    return `${this.config.contentApiBase}/_menus/${slug}`;
  }

  private async load(id: string): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    this.loaded.set(false);
    this.loadError.set(null);
    this.showErrors.set(false);
    this.saveError.set(null);
    try {
      if (id === 'new') {
        this.name.set('');
        this.slug.set('');
        this.slugTouched = false;
        this.tree.set([]);
      } else {
        const menu = await this.site.menu(Number(id));
        this.name.set(menu.name);
        this.slug.set(menu.slug);
        this.slugTouched = true;
        this.tree.set(fromItems(menu.items));
      }
      this.selectedKey.set(this.tree()[0]?.key ?? null);
      this.loaded.set(true);
    } catch (error) {
      const failure = ApiFailure.from(error);
      this.loadError.set(failure.status === 404 ? this.t('menus.notFound') : failure.message);
    } finally {
      this.loading = false;
    }
  }

  protected setName(name: string): void {
    this.name.set(name);
    if (!this.slugTouched) this.slug.set(slugify(name));
  }

  protected setSlug(slug: string): void {
    this.slugTouched = true;
    this.slug.set(slug.trim());
  }

  protected hasProblem(problems: ItemProblem[], problem: ItemProblem): boolean {
    return problems.includes(problem);
  }

  protected linkSummary(node: MenuNode): string {
    if (node.link === 'url') return node.url || this.t('menus.noLink');
    if (node.link === 'entry') {
      if (!node.entry) return this.t('menus.noEntry');
      const type = this.schemaName(node.entry.uid);
      return `${type} · ${node.entry.title ?? node.entry.documentId}`;
    }
    return this.t('menus.noLink');
  }

  private schemaName(uid: string): string {
    return this.schema.type(uid)?.displayName ?? uid;
  }

  protected indentable(node: MenuNode): boolean {
    return canIndent(this.tree(), node.key);
  }

  protected outdentable(node: MenuNode): boolean {
    return canOutdent(this.tree(), node.key);
  }

  protected select(key: string): void {
    this.selectedKey.set(key);
    setTimeout(() => document.getElementById('menu-item-label')?.focus());
  }

  protected change(key: string, change: Partial<Omit<MenuNode, 'key' | 'children'>>): void {
    this.tree.update((tree) => updateNode(tree, key, change));
  }

  protected add(parentKey: string | null): void {
    const node = emptyNode();
    const tree = addNode(this.tree(), parentKey, node);
    if (!tree) {
      this.announce(this.t('menus.limitReached', { max: this.maxItems, depth: this.maxDepth }));
      toast.error(this.t('menus.limitReached', { max: this.maxItems, depth: this.maxDepth }));
      return;
    }
    this.tree.set(tree);
    this.select(node.key);
  }

  protected remove(node: MenuNode): void {
    const rows = this.rows();
    const index = rows.findIndex((row) => row.node.key === node.key);
    this.tree.update((tree) => removeNode(tree, node.key));
    this.announce(this.t('menus.removed', { label: node.label || this.t('menus.untitledItem') }));
    if (this.selectedKey() && !findNode(this.tree(), this.selectedKey()!)) {
      const next = this.rows()[Math.min(index, this.rows().length - 1)];
      this.selectedKey.set(next?.node.key ?? null);
    }
    const focus = this.rows()[Math.max(0, Math.min(index, this.rows().length - 1))];
    if (focus) this.focusHandle(focus.node.key);
  }

  protected move(node: MenuNode, delta: -1 | 1): void {
    const tree = moveNode(this.tree(), node.key, delta);
    if (tree) this.commit(tree, node);
  }

  protected shift(node: MenuNode, direction: 'in' | 'out'): void {
    const tree =
      direction === 'in' ? indent(this.tree(), node.key) : outdent(this.tree(), node.key);
    if (tree) this.commit(tree, node);
    else if (direction === 'in') this.announce(this.t('menus.cannotIndent'));
  }

  /** Keyboard reordering on the drag handle. */
  protected onHandleKey(event: KeyboardEvent, node: MenuNode): void {
    if (!event.altKey) return;
    const rtl = this.i18n.direction() === 'rtl';
    const key = event.key;
    if (key === 'ArrowUp') this.move(node, -1);
    else if (key === 'ArrowDown') this.move(node, 1);
    else if (key === (rtl ? 'ArrowLeft' : 'ArrowRight')) this.shift(node, 'in');
    else if (key === (rtl ? 'ArrowRight' : 'ArrowLeft')) this.shift(node, 'out');
    else return;
    event.preventDefault();
  }

  protected drop(event: CdkDragDrop<unknown>): void {
    const row = this.rows()[event.previousIndex];
    if (!row || event.previousIndex === event.currentIndex) return;
    const tree = moveRow(this.tree(), event.previousIndex, event.currentIndex);
    if (tree) this.commit(tree, row.node);
    else this.announce(this.t('menus.cannotDrop'));
  }

  /** Applies a move, announces the new position and keeps the focus on the item's handle. */
  private commit(tree: MenuNode[], node: MenuNode): void {
    this.tree.set(tree);
    const row = this.rows().find((item) => item.node.key === node.key);
    if (row) {
      this.announce(
        this.t('menus.moved', {
          label: node.label || this.t('menus.untitledItem'),
          level: row.depth,
          position: row.path[row.path.length - 1] + 1,
          count: row.siblings,
        }),
      );
    }
    this.focusHandle(node.key);
  }

  private focusHandle(key: string): void {
    setTimeout(() => document.querySelector<HTMLElement>(`[data-handle="${key}"]`)?.focus());
  }

  private announce(message: string): void {
    this.announcement.set('');
    setTimeout(() => this.announcement.set(message));
  }

  protected async save(): Promise<void> {
    if (this.saving()) return;
    this.showErrors.set(true);
    this.saveError.set(null);
    const problems = this.problems();
    if (!this.name().trim() || !this.slugValid()) {
      document.getElementById(this.name().trim() ? 'menu-slug' : 'menu-name')?.focus();
      return;
    }
    if (problems.size) {
      const first = this.rows().find((row) => problems.has(row.node.key));
      if (first) this.select(first.node.key);
      this.saveError.set(this.t('menus.fixItems', { count: problems.size }));
      return;
    }
    this.saving.set(true);
    const input = { name: this.name().trim(), slug: this.slug(), items: toItems(this.tree()) };
    try {
      if (this.isNew()) {
        const menu = await this.site.createMenu(input);
        toast.success(this.t('menus.created', { name: menu.name }));
        await this.router.navigate(['/settings/menus', menu.id], { replaceUrl: true });
      } else {
        await this.site.updateMenu(Number(this.id()), input);
        toast.success(this.t('menus.saved', { name: input.name }));
      }
      this.showErrors.set(false);
    } catch (error) {
      const failure = ApiFailure.from(error);
      this.saveError.set(
        failure.status === 409 ? this.t('menus.slugTaken', { slug: input.slug }) : failure.message,
      );
    } finally {
      this.saving.set(false);
    }
  }
}
