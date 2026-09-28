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
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';

import { Api, ApiFailure } from '../../core/api';
import { Auth } from '../../core/auth';
import { isLocalized } from '../../core/content-locales';
import { Feature, Features } from '../../core/features';
import { I18n } from '../../core/i18n/i18n';
import {
  CHANGEFREQS,
  Changefreq,
  PatternProblem,
  SeoRow,
  examplePattern,
  patternProblem,
  placeholderHints,
  readSeoSettings,
  seoSettingsFrom,
  validBaseUrl,
  validPriority,
} from '../../core/seo';
import { Schema } from '../../core/schema';
import { SeoComponent, Site } from '../../core/site';
import { SchemaPlan } from '../../core/types';

/** Settings → Features → SEO: the site's URL and a path pattern per content type. */
@Component({
  selector: 'vd-seo-settings',
  imports: [
    NgIcon,
    HlmAlertImports,
    HlmButtonImports,
    HlmDialogImports,
    HlmFieldImports,
    HlmInputImports,
    HlmNativeSelectImports,
    HlmSpinnerImports,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-dialog [state]="open() ? 'open' : 'closed'" (closed)="closed.emit()">
      <hlm-dialog-content
        *hlmDialogPortal="let ctx"
        class="max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-3xl"
        [closeLabel]="t('common.close')"
      >
        <hlm-dialog-header>
          <h2 hlmDialogTitle>{{ t('seo.title') }}</h2>
          <p hlmDialogDescription>{{ t('seo.description') }}</p>
        </hlm-dialog-header>
        <form
          id="seo-settings-form"
          class="-mx-6 flex min-h-0 flex-col gap-5 overflow-y-auto px-6"
          novalidate
          (submit)="$event.preventDefault(); save()"
        >
          <div hlmField [attr.data-invalid]="!baseUrlValid() ? true : null">
            <label hlmFieldLabel for="seo-base-url">{{ t('seo.baseUrl') }}</label>
            <input
              hlmInput
              dir="ltr"
              id="seo-base-url"
              type="url"
              autocomplete="off"
              spellcheck="false"
              placeholder="https://www.example.com"
              aria-describedby="seo-base-url-hint"
              [attr.aria-invalid]="!baseUrlValid() ? true : null"
              [value]="baseUrl()"
              (input)="baseUrl.set($any($event.target).value)"
            />
            <p id="seo-base-url-hint" class="text-muted-foreground text-xs">
              {{ t('seo.baseUrlHint') }}
            </p>
            @if (!baseUrlValid()) {
              <hlm-field-error forceShow>{{ t('seo.problem.baseUrl') }}</hlm-field-error>
            }
            <a
              class="text-primary flex w-fit items-center gap-1 text-xs hover:underline"
              href="/sitemap.xml"
              target="_blank"
              rel="noopener"
            >
              <ng-icon name="lucideExternalLink" size="12" /> {{ t('seo.openSitemap') }}
            </a>
          </div>

          <fieldset class="flex flex-col gap-4">
            <legend class="mb-1 text-sm font-medium">{{ t('seo.types') }}</legend>
            <p class="text-muted-foreground -mt-2 text-xs">{{ t('seo.typesHint') }}</p>
            @for (row of rows(); track row.uid; let index = $index) {
              @let id = 'seo-' + index;
              @let problem = problemOf(row);
              <div class="flex flex-col gap-2 rounded-lg border p-3" data-seo-type>
                <div class="flex items-baseline gap-2">
                  <span class="text-sm font-medium">{{ typeName(row.uid) }}</span>
                  <span class="text-muted-foreground font-mono text-xs">{{ row.uid }}</span>
                </div>
                <div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_6rem]">
                  <div hlmField [attr.data-invalid]="problem ? true : null">
                    <label hlmFieldLabel [for]="id + '-pattern'">{{ t('seo.pattern') }}</label>
                    <input
                      hlmInput
                      dir="ltr"
                      autocomplete="off"
                      spellcheck="false"
                      class="font-mono text-xs"
                      [id]="id + '-pattern'"
                      [placeholder]="example(row.uid)"
                      [attr.aria-invalid]="problem ? true : null"
                      [attr.aria-describedby]="id + '-hints'"
                      [value]="row.pattern"
                      (input)="patch(index, { pattern: $any($event.target).value })"
                    />
                  </div>
                  <div hlmField>
                    <label hlmFieldLabel [for]="id + '-freq'">{{ t('seo.changefreq') }}</label>
                    <hlm-native-select
                      [selectId]="id + '-freq'"
                      [value]="row.changefreq"
                      (valueChange)="patch(index, { changefreq: toFreq($event) })"
                    >
                      <option hlmNativeSelectOption value="">{{ t('seo.changefreqNone') }}</option>
                      @for (freq of freqs; track freq) {
                        <option hlmNativeSelectOption [value]="freq">{{ freq }}</option>
                      }
                    </hlm-native-select>
                  </div>
                  <div hlmField [attr.data-invalid]="!priorityValid(row) ? true : null">
                    <label hlmFieldLabel [for]="id + '-priority'">{{ t('seo.priority') }}</label>
                    <input
                      hlmInput
                      type="number"
                      inputmode="decimal"
                      min="0"
                      max="1"
                      step="0.1"
                      placeholder="0.5"
                      [id]="id + '-priority'"
                      [attr.aria-invalid]="!priorityValid(row) ? true : null"
                      [value]="row.priority"
                      (input)="patch(index, { priority: $any($event.target).value })"
                    />
                  </div>
                </div>
                <div class="flex flex-wrap items-center gap-1" [id]="id + '-hints'">
                  <span class="text-muted-foreground text-xs">{{ t('seo.placeholders') }}</span>
                  @for (hint of hints(row.uid); track hint) {
                    <button
                      type="button"
                      class="bg-muted hover:bg-accent rounded px-1.5 py-0.5 font-mono text-xs"
                      [attr.aria-label]="t('seo.insert', { name: hint })"
                      (click)="insert(index, hint)"
                    >
                      {{ '{' + hint + '}' }}
                    </button>
                  } @empty {
                    <span class="text-muted-foreground text-xs">{{ t('seo.noPlaceholders') }}</span>
                  }
                </div>
                @if (problem) {
                  <p class="text-destructive text-xs" role="alert">{{ problemText(problem) }}</p>
                }
                @if (!priorityValid(row)) {
                  <p class="text-destructive text-xs" role="alert">
                    {{ t('seo.problem.priority') }}
                  </p>
                }
              </div>
            } @empty {
              <p class="text-muted-foreground text-sm">{{ t('seo.noTypes') }}</p>
            }
          </fieldset>

          <section
            class="bg-muted/40 flex flex-col gap-3 rounded-lg border p-3"
            aria-labelledby="seo-component-title"
          >
            <div class="flex flex-col gap-0.5">
              <h3 id="seo-component-title" class="text-sm font-medium">
                {{ t('seo.component.title') }}
              </h3>
              <p class="text-muted-foreground text-xs">{{ t('seo.component.hint') }}</p>
            </div>
            @if (componentExists()) {
              <p class="flex items-center gap-1.5 text-sm">
                <ng-icon name="lucideCircleCheck" class="text-primary" />
                {{ t('seo.component.exists') }}
              </p>
            } @else if (component(); as suggested) {
              <pre
                dir="ltr"
                class="bg-background max-h-56 overflow-auto rounded-md border p-3 font-mono text-xs"
                >{{ json(suggested) }}</pre>
              @if (canCreateComponent()) {
                <p class="text-muted-foreground text-xs">{{ t('seo.component.createHint') }}</p>
                <button
                  hlmBtn
                  type="button"
                  size="sm"
                  variant="outline"
                  class="self-start"
                  [disabled]="creating()"
                  (click)="createComponent(suggested)"
                >
                  @if (creating()) {
                    <hlm-spinner class="size-4" />
                  } @else {
                    <ng-icon name="lucideBlocks" />
                  }
                  {{ t('seo.component.create') }}
                </button>
              } @else {
                <p class="text-muted-foreground text-xs">{{ t('seo.component.manualHint') }}</p>
              }
            } @else {
              <button
                hlmBtn
                type="button"
                size="sm"
                variant="outline"
                class="self-start"
                [disabled]="loadingComponent()"
                (click)="loadComponent()"
              >
                @if (loadingComponent()) {
                  <hlm-spinner class="size-4" />
                } @else {
                  <ng-icon name="lucidePlus" />
                }
                {{ t('seo.component.show') }}
              </button>
            }
          </section>

          @if (error()) {
            <div hlmAlert variant="destructive" role="alert">
              <ng-icon hlmAlertIcon name="lucideCircleAlert" />
              <p hlmAlertTitle>{{ t('features.settingsRejected') }}</p>
              <p hlmAlertDescription>{{ error() }}</p>
            </div>
          }
        </form>
        <hlm-dialog-footer>
          <button hlmBtn type="button" variant="outline" (click)="closed.emit()">
            {{ t('common.cancel') }}
          </button>
          <button hlmBtn type="submit" form="seo-settings-form" [disabled]="saving() || invalid()">
            @if (saving()) {
              <hlm-spinner class="size-4" />
            }
            {{ t('common.save') }}
          </button>
        </hlm-dialog-footer>
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class SeoSettingsDialog {
  private readonly features = inject(Features);
  private readonly schema = inject(Schema);
  private readonly site = inject(Site);
  private readonly api = inject(Api);
  private readonly auth = inject(Auth);
  protected readonly t = inject(I18n).t;

  readonly open = input(false);
  readonly feature = input.required<Feature>();
  readonly closed = output<void>();

  protected readonly freqs = CHANGEFREQS;
  protected readonly baseUrl = signal('');
  protected readonly rows = signal<SeoRow[]>([]);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly component = signal<SeoComponent | null>(null);
  protected readonly loadingComponent = signal(false);
  protected readonly creating = signal(false);

  protected readonly baseUrlValid = computed(() => validBaseUrl(this.baseUrl()));
  protected readonly invalid = computed(
    () =>
      !this.baseUrlValid() ||
      this.rows().some((row) => !!this.problemOf(row) || !this.priorityValid(row)),
  );
  protected readonly componentExists = computed(
    () =>
      !!this.schema.component(
        `${this.component()?.category ?? 'shared'}.${this.component()?.name ?? 'seo'}`,
      ),
  );
  protected readonly canCreateComponent = computed(
    () => this.schema.devMode() && this.auth.can('schema.manage'),
  );

  constructor() {
    effect(() => {
      if (!this.open()) return;
      const feature = this.feature();
      untracked(() => {
        const settings = readSeoSettings(feature.settings);
        const types = [...this.schema.contentTypes()].sort((a, b) =>
          a.displayName.localeCompare(b.displayName),
        );
        const rows: SeoRow[] = types.map((type) => rowOf(type.uid, settings.types[type.uid]));
        // Types that no longer exist keep their settings (the server refuses them, so show them).
        for (const [uid, spec] of Object.entries(settings.types)) {
          if (!rows.some((row) => row.uid === uid)) rows.push(rowOf(uid, spec));
        }
        this.rows.set(rows);
        this.baseUrl.set(settings.baseUrl);
        this.error.set(null);
      });
    });
  }

  protected typeName(uid: string): string {
    return this.schema.type(uid)?.displayName ?? uid;
  }

  protected hints(uid: string): string[] {
    const type = this.schema.type(uid);
    return type ? placeholderHints(type.attributes, isLocalized(type)) : [];
  }

  protected example(uid: string): string {
    const type = this.schema.type(uid);
    return type ? examplePattern(type.pluralName, type.attributes, isLocalized(type)) : '/{slug}';
  }

  protected problemOf(row: SeoRow): PatternProblem | null {
    if (!row.pattern.trim()) return null;
    const type = this.schema.type(row.uid);
    if (!type) return { kind: 'unknown', name: row.uid };
    return patternProblem(row.pattern, type.attributes);
  }

  protected problemText(problem: PatternProblem): string {
    switch (problem.kind) {
      case 'slash':
        return this.t('seo.problem.slash');
      case 'braces':
        return this.t('seo.problem.braces');
      case 'empty':
        return this.t('seo.problem.empty');
      case 'unknown':
        return this.t('seo.problem.unknown', { name: problem.name });
    }
  }

  protected priorityValid(row: SeoRow): boolean {
    return validPriority(row.priority);
  }

  protected toFreq(value: string | null | undefined): Changefreq | '' {
    return CHANGEFREQS.includes(value as Changefreq) ? (value as Changefreq) : '';
  }

  protected patch(index: number, change: Partial<SeoRow>): void {
    this.rows.update((rows) => rows.map((row, i) => (i === index ? { ...row, ...change } : row)));
  }

  /** Appends a placeholder to the pattern (as a new segment when it ends with `/`). */
  protected insert(index: number, name: string): void {
    const row = this.rows()[index];
    const pattern = row.pattern || '/';
    const joined = pattern.endsWith('/') ? `${pattern}{${name}}` : `${pattern}/{${name}}`;
    this.patch(index, { pattern: joined });
    setTimeout(() => document.getElementById(`seo-${index}-pattern`)?.focus());
  }

  protected json(component: SeoComponent): string {
    return JSON.stringify(component.schema, null, 2);
  }

  protected async loadComponent(): Promise<void> {
    this.loadingComponent.set(true);
    try {
      this.component.set(await this.site.seoComponent());
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    } finally {
      this.loadingComponent.set(false);
    }
  }

  /** Adds the component through the schema builder's plan and apply (development only). */
  protected async createComponent(component: SeoComponent): Promise<void> {
    this.creating.set(true);
    const change = {
      contentTypes: {},
      components: { [`${component.category}.${component.name}`]: component.schema },
      renameTables: [],
      renameColumns: [],
    };
    try {
      const plan = await this.api.post<SchemaPlan>('/schema/plan', change);
      if (!plan.valid) {
        toast.error(this.t('seo.component.failed'), {
          description: (plan.errors ?? []).map((error) => error.message).join('\n'),
        });
        return;
      }
      await this.api.post('/schema/apply', { ...change, allow: plan.requires ?? 'safe' });
      await this.schema.load();
      toast.success(this.t('seo.component.created'));
    } catch (error) {
      toast.error(this.t('seo.component.failed'), {
        description: ApiFailure.from(error).message,
      });
    } finally {
      this.creating.set(false);
    }
  }

  protected async save(): Promise<void> {
    if (this.invalid() || this.saving()) return;
    const feature = this.feature();
    this.saving.set(true);
    this.error.set(null);
    try {
      const settings = seoSettingsFrom(this.baseUrl(), this.rows());
      await this.features.update(feature.id, feature.enabled, { ...settings });
      toast.success(this.t('features.settingsSaved', { name: this.t('features.seo.name') }));
      this.closed.emit();
    } catch (error) {
      this.error.set(ApiFailure.from(error).message);
    } finally {
      this.saving.set(false);
    }
  }
}

function rowOf(
  uid: string,
  spec: { pattern: string; changefreq?: Changefreq; priority?: number } | undefined,
): SeoRow {
  return {
    uid,
    pattern: spec?.pattern ?? '',
    changefreq: spec?.changefreq ?? '',
    priority: spec?.priority !== undefined ? String(spec.priority) : '',
  };
}
