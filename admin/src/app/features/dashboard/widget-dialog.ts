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
import { NgIcon } from '@ng-icons/core';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { HlmSwitchImports } from '@spartan-ng/helm/switch';
import { HlmTextareaImports } from '@spartan-ng/helm/textarea';
import { HlmToggleGroupImports } from '@spartan-ng/helm/toggle-group';

import { ApiFailure } from '../../core/api';
import {
  ConditionOp,
  ListSort,
  WIDGET_WIDTHS,
  Widget,
  WidgetCondition,
  WidgetConfig,
  WidgetType,
  WidgetWidth,
  newWidgetId,
} from '../../core/dashboard';
import { Engagement, Poll } from '../../core/engagement';
import { I18n } from '../../core/i18n/i18n';
import { MessageKey } from '../../core/i18n/keys';
import { Schema } from '../../core/schema';
import { Attribute } from '../../core/types';
import { DateControl } from '../content/fields/controls';

interface Kind {
  type: WidgetType;
  icon: string;
  label: MessageKey;
  hint: MessageKey;
}

export const WIDGET_KINDS: Kind[] = [
  {
    type: 'count',
    icon: 'lucideHash',
    label: 'dashboard.kind.count',
    hint: 'dashboard.kind.countHint',
  },
  {
    type: 'list',
    icon: 'lucideList',
    label: 'dashboard.kind.list',
    hint: 'dashboard.kind.listHint',
  },
  {
    type: 'recent',
    icon: 'lucideClock',
    label: 'dashboard.kind.recent',
    hint: 'dashboard.kind.recentHint',
  },
  {
    type: 'poll',
    icon: 'lucideVote',
    label: 'dashboard.kind.poll',
    hint: 'dashboard.kind.pollHint',
  },
  {
    type: 'note',
    icon: 'lucideStickyNote',
    label: 'dashboard.kind.note',
    hint: 'dashboard.kind.noteHint',
  },
  {
    type: 'links',
    icon: 'lucideRocket',
    label: 'dashboard.kind.links',
    hint: 'dashboard.kind.linksHint',
  },
  {
    type: 'system',
    icon: 'lucideDatabase',
    label: 'dashboard.kind.system',
    hint: 'dashboard.kind.systemHint',
  },
];

const WIDTHS: { value: WidgetWidth; label: MessageKey }[] = [
  { value: 1, label: 'dashboard.width.small' },
  { value: 2, label: 'dashboard.width.medium' },
  { value: 3, label: 'dashboard.width.large' },
  { value: 4, label: 'dashboard.width.full' },
];

const SORTS: { value: ListSort; label: MessageKey }[] = [
  { value: 'updatedAt:desc', label: 'dashboard.sort.updated' },
  { value: 'createdAt:desc', label: 'dashboard.sort.created' },
  { value: 'title:asc', label: 'dashboard.sort.title' },
  { value: 'votes:desc', label: 'dashboard.sort.votes' },
];

const OPERATOR_LABELS: Record<ConditionOp, MessageKey> = {
  eq: 'condition.op.eq',
  ne: 'condition.op.ne',
  containsi: 'condition.op.containsi',
  gt: 'condition.op.gt',
  lt: 'condition.op.lt',
  null: 'condition.op.null',
  notNull: 'condition.op.notNull',
};

const TEXT = ['string', 'text', 'richtext', 'email', 'uid'];
const ORDERED = ['integer', 'biginteger', 'float', 'decimal', 'date', 'datetime', 'time'];

/** Operators that make sense for an attribute type. */
function operatorsFor(attribute: Attribute | undefined): ConditionOp[] {
  const type = attribute?.type ?? 'string';
  if (type === 'boolean') return ['eq', 'null', 'notNull'];
  if (type === 'enumeration') return ['eq', 'ne', 'null', 'notNull'];
  if (ORDERED.includes(type)) return ['eq', 'ne', 'gt', 'lt', 'null', 'notNull'];
  return ['eq', 'ne', 'containsi', 'null', 'notNull'];
}

/** Adds a widget (pick a kind, then configure it) or edits an existing one. */
@Component({
  selector: 'vd-widget-dialog',
  imports: [
    NgIcon,
    HlmButtonImports,
    HlmDialogImports,
    HlmFieldImports,
    HlmInputImports,
    HlmNativeSelectImports,
    HlmSwitchImports,
    HlmTextareaImports,
    HlmToggleGroupImports,
    DateControl,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-dialog [state]="open() ? 'open' : 'closed'" (closed)="closed.emit()">
      <hlm-dialog-content
        *hlmDialogPortal="let ctx"
        class="max-h-[90svh] overflow-y-auto sm:max-w-2xl"
      >
        <hlm-dialog-header>
          <h2 hlmDialogTitle>
            {{ widget() ? t('dashboard.configure') : t('dashboard.addWidget') }}
          </h2>
          <p hlmDialogDescription>
            {{ type() ? t(kind()!.hint) : t('dashboard.pickKind') }}
          </p>
        </hlm-dialog-header>

        @if (!type()) {
          <div class="grid gap-3 sm:grid-cols-2">
            @for (kind of kinds; track kind.type) {
              <button
                type="button"
                class="hover:border-primary/50 hover:bg-accent/50 flex items-start gap-3 rounded-xl border p-4 text-start transition-colors"
                (click)="choose(kind.type)"
              >
                <span
                  class="bg-primary/10 text-primary inline-flex size-9 shrink-0 items-center justify-center rounded-lg"
                >
                  <ng-icon [name]="kind.icon" />
                </span>
                <span class="flex flex-col gap-0.5">
                  <span class="text-sm font-medium">{{ t(kind.label) }}</span>
                  <span class="text-muted-foreground text-xs">{{ t(kind.hint) }}</span>
                </span>
              </button>
            }
          </div>
        } @else {
          <form class="grid gap-4 sm:grid-cols-2" (submit)="$event.preventDefault(); save()">
            <div hlmField class="sm:col-span-2">
              <label hlmFieldLabel for="widget-title">{{ t('dashboard.field.title') }}</label>
              <input
                hlmInput
                id="widget-title"
                [placeholder]="t('dashboard.field.titlePlaceholder')"
                [value]="title()"
                (input)="title.set($any($event.target).value)"
              />
            </div>

            @if (needsType()) {
              <div hlmField>
                <label hlmFieldLabel for="widget-type">{{
                  t('dashboard.field.contentType')
                }}</label>
                <hlm-native-select
                  selectId="widget-type"
                  [value]="config().uid ?? ''"
                  (valueChange)="patch({ uid: $event || undefined, conditions: [] })"
                >
                  @if (type() === 'recent') {
                    <option hlmNativeSelectOption value="">
                      {{ t('dashboard.field.allTypes') }}
                    </option>
                  }
                  @for (item of schema.collections(); track item.uid) {
                    <option hlmNativeSelectOption [value]="item.uid">{{ item.displayName }}</option>
                  }
                </hlm-native-select>
              </div>
            }

            @if (type() === 'count' || type() === 'list') {
              <div hlmField>
                <label hlmFieldLabel for="widget-status">{{ t('dashboard.field.status') }}</label>
                <hlm-native-select
                  selectId="widget-status"
                  [value]="config().status ?? 'all'"
                  (valueChange)="patch({ status: $any($event) })"
                >
                  <option hlmNativeSelectOption value="all">{{ t('dashboard.status.all') }}</option>
                  <option hlmNativeSelectOption value="published">
                    {{ t('dashboard.status.published') }}
                  </option>
                </hlm-native-select>
              </div>
              <div hlmField>
                <label hlmFieldLabel for="widget-search">{{ t('dashboard.field.search') }}</label>
                <input
                  hlmInput
                  id="widget-search"
                  [placeholder]="t('dashboard.field.searchPlaceholder')"
                  [value]="config().search ?? ''"
                  (input)="patch({ search: $any($event.target).value || undefined })"
                />
              </div>
            }

            @if (type() === 'list') {
              <div hlmField>
                <label hlmFieldLabel for="widget-sort">{{ t('dashboard.field.sort') }}</label>
                <hlm-native-select
                  selectId="widget-sort"
                  [value]="config().sort ?? 'updatedAt:desc'"
                  (valueChange)="patch({ sort: $any($event) })"
                >
                  @for (sort of sorts; track sort.value) {
                    <option hlmNativeSelectOption [value]="sort.value">{{ t(sort.label) }}</option>
                  }
                </hlm-native-select>
              </div>
            }

            @if (type() === 'list' || type() === 'recent') {
              <div hlmField>
                <label hlmFieldLabel for="widget-limit">{{ t('dashboard.field.limit') }}</label>
                <input
                  hlmInput
                  id="widget-limit"
                  type="number"
                  min="1"
                  max="20"
                  [value]="config().limit ?? 5"
                  (input)="patch({ limit: clampLimit($any($event.target).value) })"
                />
              </div>
            }

            @if (selectedType() && (type() === 'count' || type() === 'list')) {
              <fieldset class="flex flex-col gap-2 sm:col-span-2">
                <legend class="mb-2 text-sm font-medium">{{ t('condition.title') }}</legend>
                <p class="text-muted-foreground -mt-1 text-xs">{{ t('condition.hint') }}</p>
                @for (condition of conditions(); track $index; let index = $index) {
                  <div class="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2">
                    <hlm-native-select
                      [selectId]="'condition-field-' + index"
                      [attr.aria-label]="t('condition.field')"
                      [value]="condition.field"
                      (valueChange)="setCondition(index, { field: $event ?? '' })"
                    >
                      @for (field of filterable(); track field) {
                        <option hlmNativeSelectOption [value]="field">{{ field }}</option>
                      }
                    </hlm-native-select>
                    <hlm-native-select
                      [selectId]="'condition-op-' + index"
                      [attr.aria-label]="t('condition.operator')"
                      [value]="condition.op"
                      (valueChange)="setCondition(index, { op: $any($event) })"
                    >
                      @for (op of operators(condition.field); track op) {
                        <option hlmNativeSelectOption [value]="op">
                          {{ t(operatorLabels[op]) }}
                        </option>
                      }
                    </hlm-native-select>
                    @if (condition.op === 'null' || condition.op === 'notNull') {
                      <span></span>
                    } @else if (attribute(condition.field)?.type === 'boolean') {
                      <hlm-native-select
                        [selectId]="'condition-value-' + index"
                        [attr.aria-label]="t('condition.value')"
                        [value]="condition.value ?? 'true'"
                        (valueChange)="setCondition(index, { value: $event ?? 'true' })"
                      >
                        <option hlmNativeSelectOption value="true">{{ t('common.yes') }}</option>
                        <option hlmNativeSelectOption value="false">{{ t('common.no') }}</option>
                      </hlm-native-select>
                    } @else if (attribute(condition.field)?.type === 'enumeration') {
                      <hlm-native-select
                        [selectId]="'condition-value-' + index"
                        [attr.aria-label]="t('condition.value')"
                        [value]="condition.value ?? ''"
                        (valueChange)="setCondition(index, { value: $event ?? '' })"
                      >
                        @for (option of attribute(condition.field)?.enum ?? []; track option) {
                          <option hlmNativeSelectOption [value]="option">{{ option }}</option>
                        }
                      </hlm-native-select>
                    } @else {
                      <input
                        hlmInput
                        [attr.aria-label]="t('condition.value')"
                        [type]="inputType(condition.field)"
                        [value]="condition.value ?? ''"
                        (input)="setCondition(index, { value: $any($event.target).value })"
                      />
                    }
                    <button
                      hlmBtn
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      [attr.aria-label]="t('condition.remove')"
                      (click)="removeCondition(index)"
                    >
                      <ng-icon name="lucideX" />
                    </button>
                  </div>
                }
                <button
                  hlmBtn
                  type="button"
                  variant="outline"
                  size="sm"
                  class="self-start"
                  [disabled]="!filterable().length"
                  (click)="addCondition()"
                >
                  <ng-icon name="lucidePlus" /> {{ t('condition.add') }}
                </button>
              </fieldset>
            }

            @if (type() === 'count' || type() === 'list' || type() === 'recent') {
              <div class="flex flex-col gap-3 sm:col-span-2">
                <label class="flex items-start gap-3">
                  <hlm-switch
                    [checked]="!!config().unseen"
                    (checkedChange)="patch({ unseen: $event || undefined })"
                  />
                  <span class="flex flex-col">
                    <span class="text-sm font-medium">{{ t('dashboard.field.unseen') }}</span>
                    <span class="text-muted-foreground text-xs">{{
                      t('dashboard.field.unseenHint')
                    }}</span>
                  </span>
                </label>
                @if (type() !== 'count') {
                  <label class="flex items-start gap-3">
                    <hlm-switch
                      [checked]="!!config().showVotes"
                      (checkedChange)="patch({ showVotes: $event || undefined })"
                    />
                    <span class="flex flex-col">
                      <span class="text-sm font-medium">{{ t('dashboard.field.showVotes') }}</span>
                      <span class="text-muted-foreground text-xs">{{
                        t('dashboard.field.showVotesHint')
                      }}</span>
                    </span>
                  </label>
                }
              </div>
            }

            @if (type() === 'note') {
              <div hlmField class="sm:col-span-2">
                <label hlmFieldLabel for="widget-text">{{ t('dashboard.field.text') }}</label>
                <textarea
                  hlmTextarea
                  id="widget-text"
                  rows="5"
                  maxlength="2000"
                  [value]="config().text ?? ''"
                  (input)="patch({ text: $any($event.target).value })"
                ></textarea>
              </div>
            }

            @if (type() === 'poll') {
              <div class="flex flex-col gap-4 sm:col-span-2">
                @if (polls().length) {
                  <hlm-toggle-group
                    type="single"
                    variant="outline"
                    size="sm"
                    [value]="pollMode()"
                    (valueChange)="pollMode.set($any($event) || pollMode())"
                  >
                    <button hlmToggleGroupItem value="new">{{ t('poll.new') }}</button>
                    <button hlmToggleGroupItem value="existing">{{ t('poll.existing') }}</button>
                  </hlm-toggle-group>
                }
                @if (pollMode() === 'existing') {
                  <div hlmField>
                    <label hlmFieldLabel for="widget-poll">{{ t('poll.pick') }}</label>
                    <hlm-native-select
                      selectId="widget-poll"
                      [value]="config().pollId ? String(config().pollId) : ''"
                      (valueChange)="patch({ pollId: $event ? +$event : undefined })"
                    >
                      <option hlmNativeSelectOption value="">—</option>
                      @for (poll of polls(); track poll.id) {
                        <option hlmNativeSelectOption [value]="String(poll.id)">
                          {{ poll.question }}{{ poll.open ? '' : ' (' + t('poll.closed') + ')' }}
                        </option>
                      }
                    </hlm-native-select>
                  </div>
                } @else {
                  <div hlmField>
                    <label hlmFieldLabel for="poll-question">{{ t('poll.question') }}</label>
                    <input
                      hlmInput
                      id="poll-question"
                      maxlength="500"
                      [placeholder]="t('poll.questionPlaceholder')"
                      [value]="question()"
                      (input)="question.set($any($event.target).value)"
                    />
                  </div>
                  <fieldset class="flex flex-col gap-2">
                    <legend class="mb-2 text-sm font-medium">{{ t('poll.options') }}</legend>
                    @for (option of options(); track $index; let index = $index) {
                      <div class="flex items-center gap-2">
                        <input
                          hlmInput
                          maxlength="200"
                          [attr.aria-label]="t('poll.option', { number: index + 1 })"
                          [placeholder]="t('poll.option', { number: index + 1 })"
                          [value]="option"
                          (input)="setOption(index, $any($event.target).value)"
                        />
                        <button
                          hlmBtn
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          [attr.aria-label]="t('poll.removeOption')"
                          [disabled]="options().length <= 2"
                          (click)="removeOption(index)"
                        >
                          <ng-icon name="lucideX" />
                        </button>
                      </div>
                    }
                    <button
                      hlmBtn
                      type="button"
                      variant="outline"
                      size="sm"
                      class="self-start"
                      [disabled]="options().length >= 10"
                      (click)="addOption()"
                    >
                      <ng-icon name="lucidePlus" /> {{ t('poll.addOption') }}
                    </button>
                  </fieldset>
                  <div class="grid gap-4 sm:grid-cols-2">
                    <label class="flex items-center gap-3">
                      <hlm-switch [checked]="multiple()" (checkedChange)="multiple.set($event)" />
                      <span class="text-sm">{{ t('poll.allowMultiple') }}</span>
                    </label>
                    <div hlmField>
                      <label hlmFieldLabel for="poll-closes">{{ t('poll.closesOn') }}</label>
                      <vd-date-control inputId="poll-closes" [(value)]="closesOn" />
                    </div>
                  </div>
                }
              </div>
            }

            <div hlmField>
              <label hlmFieldLabel for="widget-width">{{ t('dashboard.field.width') }}</label>
              <hlm-native-select
                selectId="widget-width"
                [value]="String(width())"
                (valueChange)="setWidth($event)"
              >
                @for (option of widths; track option.value) {
                  <option hlmNativeSelectOption [value]="String(option.value)">
                    {{ t(option.label) }}
                  </option>
                }
              </hlm-native-select>
            </div>

            @if (error()) {
              <p class="text-destructive text-sm sm:col-span-2">{{ error() }}</p>
            }

            <hlm-dialog-footer class="sm:col-span-2">
              @if (!widget()) {
                <button
                  hlmBtn
                  type="button"
                  variant="ghost"
                  class="me-auto"
                  (click)="type.set(null)"
                >
                  <ng-icon name="lucideArrowLeft" /> {{ t('common.back') }}
                </button>
              }
              <button hlmBtn type="button" variant="outline" (click)="closed.emit()">
                {{ t('common.cancel') }}
              </button>
              <button hlmBtn type="submit" [disabled]="!valid() || busy()">
                {{ widget() ? t('common.save') : t('dashboard.add') }}
              </button>
            </hlm-dialog-footer>
          </form>
        }
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class WidgetDialog {
  protected readonly schema = inject(Schema);
  private readonly engagement = inject(Engagement);
  protected readonly t = inject(I18n).t;
  protected readonly String = String;
  protected readonly kinds = WIDGET_KINDS;
  protected readonly widths = WIDTHS;
  protected readonly sorts = SORTS;
  protected readonly operatorLabels = OPERATOR_LABELS;

  readonly open = input(false);
  /** The widget to edit; `null` adds a new one. */
  readonly widget = input<Widget | null>(null);
  readonly saved = output<Widget>();
  readonly closed = output<void>();

  protected readonly type = signal<WidgetType | null>(null);
  protected readonly title = signal('');
  protected readonly width = signal<WidgetWidth>(1);
  protected readonly config = signal<WidgetConfig>({});
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  // Poll widgets: pick an existing poll or create one.
  protected readonly polls = signal<Poll[]>([]);
  protected readonly pollMode = signal<'new' | 'existing'>('new');
  protected readonly question = signal('');
  protected readonly options = signal<string[]>(['', '']);
  protected readonly multiple = signal(false);
  protected readonly closesOn = signal<string | null>(null);

  protected readonly kind = computed(() => WIDGET_KINDS.find((kind) => kind.type === this.type()));
  protected readonly needsType = computed(() =>
    ['count', 'list', 'recent'].includes(this.type() ?? ''),
  );
  protected readonly selectedType = computed(() => {
    const uid = this.config().uid;
    return uid ? this.schema.type(uid) : undefined;
  });
  protected readonly conditions = computed(() => this.config().conditions ?? []);
  /** Attributes a condition can test (field names are schema data, shown as is). */
  protected readonly filterable = computed(() => {
    const type = this.selectedType();
    if (!type) return [];
    return Object.entries(type.attributes)
      .filter(
        ([, attribute]) =>
          !attribute.private &&
          [...TEXT, ...ORDERED, 'boolean', 'enumeration'].includes(attribute.type),
      )
      .map(([name]) => name);
  });
  protected readonly valid = computed(() => {
    const type = this.type();
    if (!type) return false;
    if (type === 'count' || type === 'list') return !!this.config().uid;
    if (type === 'poll') {
      if (this.pollMode() === 'existing') return !!this.config().pollId;
      const filled = this.options().filter((option) => option.trim()).length;
      return !!this.question().trim() && filled >= 2;
    }
    return true;
  });

  constructor() {
    // Reset the form whenever the dialog opens.
    effect(() => {
      if (!this.open()) return;
      const widget = this.widget();
      untracked(() => {
        this.type.set(widget?.type ?? null);
        this.title.set(widget?.title ?? '');
        this.width.set(widget?.width ?? 1);
        this.config.set({ ...(widget?.config ?? {}) });
        this.error.set(null);
        this.question.set('');
        this.options.set(['', '']);
        this.multiple.set(false);
        this.closesOn.set(null);
        this.pollMode.set(widget?.config.pollId ? 'existing' : 'new');
        void this.loadPolls();
      });
    });
  }

  private async loadPolls(): Promise<void> {
    try {
      this.polls.set(await this.engagement.polls());
    } catch {
      this.polls.set([]);
    }
  }

  protected choose(type: WidgetType): void {
    this.type.set(type);
    this.width.set(WIDGET_WIDTHS[type]);
    const first = this.schema.collections()[0]?.uid;
    this.config.set(
      type === 'count' || type === 'list'
        ? { uid: first, status: 'all', ...(type === 'list' ? { limit: 5 } : {}) }
        : type === 'recent'
          ? { limit: 8 }
          : {},
    );
  }

  protected patch(changes: Partial<WidgetConfig>): void {
    this.config.update((config) => ({ ...config, ...changes }));
  }

  protected attribute(field: string): Attribute | undefined {
    return this.selectedType()?.attributes[field];
  }

  protected operators(field: string): ConditionOp[] {
    return operatorsFor(this.attribute(field));
  }

  protected inputType(field: string): string {
    const type = this.attribute(field)?.type;
    if (type === 'date') return 'date';
    if (type === 'datetime') return 'datetime-local';
    if (type === 'time') return 'time';
    if (['integer', 'biginteger', 'float', 'decimal'].includes(type ?? '')) return 'number';
    return 'text';
  }

  /** The value a condition on `field` starts with. */
  private initialValue(field: string): string {
    const attribute = this.attribute(field);
    if (attribute?.type === 'boolean') return 'true';
    if (attribute?.type === 'enumeration') return attribute.enum?.[0] ?? '';
    return '';
  }

  protected addCondition(): void {
    const field = this.filterable()[0];
    if (!field) return;
    const condition: WidgetCondition = { field, op: 'eq', value: this.initialValue(field) };
    this.patch({ conditions: [...this.conditions(), condition] });
  }

  protected setCondition(index: number, changes: Partial<WidgetCondition>): void {
    const conditions = this.conditions().map((condition, position) => {
      if (position !== index) return condition;
      const next = { ...condition, ...changes };
      if (changes.field !== undefined && changes.field !== condition.field) {
        next.op = 'eq';
        next.value = this.initialValue(next.field);
      }
      if (!this.operators(next.field).includes(next.op)) next.op = 'eq';
      return next;
    });
    this.patch({ conditions });
  }

  protected removeCondition(index: number): void {
    this.patch({ conditions: this.conditions().filter((_, position) => position !== index) });
  }

  protected addOption(): void {
    this.options.update((list) => [...list, '']);
  }

  protected setOption(index: number, value: string): void {
    this.options.update((list) =>
      list.map((option, position) => (position === index ? value : option)),
    );
  }

  protected removeOption(index: number): void {
    this.options.update((list) => list.filter((_, position) => position !== index));
  }

  protected setWidth(value: string | null | undefined): void {
    const width = Number(value);
    if (width === 1 || width === 2 || width === 3 || width === 4) this.width.set(width);
  }

  protected clampLimit(text: string): number {
    const value = Math.round(Number(text));
    return Number.isFinite(value) ? Math.min(Math.max(value, 1), 20) : 5;
  }

  protected async save(): Promise<void> {
    const type = this.type();
    if (!type || !this.valid()) return;
    let config = this.config();
    if (type === 'poll' && this.pollMode() === 'new') {
      this.busy.set(true);
      this.error.set(null);
      try {
        const closesOn = this.closesOn();
        const poll = await this.engagement.createPoll({
          question: this.question().trim(),
          options: this.options()
            .map((option) => option.trim())
            .filter(Boolean),
          multiple: this.multiple(),
          // The end of the chosen day, local time.
          closesAt: closesOn ? new Date(`${closesOn}T23:59:59`).toISOString() : null,
        });
        config = { pollId: poll.id };
      } catch (error) {
        this.error.set(ApiFailure.from(error).message);
        return;
      } finally {
        this.busy.set(false);
      }
    }
    const title = this.title().trim();
    this.saved.emit({
      id: this.widget()?.id ?? newWidgetId(),
      type,
      title: title || undefined,
      width: this.width(),
      config,
    });
  }
}
