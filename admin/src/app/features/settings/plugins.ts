import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { HlmSwitchImports } from '@spartan-ng/helm/switch';
import { HlmTextareaImports } from '@spartan-ng/helm/textarea';

import { ApiFailure, RUNTIME_CONFIG } from '../../core/api';
import { I18n } from '../../core/i18n/i18n';
import { PluginExtensions } from '../../core/plugin-extensions';
import {
  CapabilityGroup,
  Plugin,
  PluginLoadError,
  PluginLog,
  Plugins,
  capabilityGroups,
  parseSettings,
  pluginRouteUrl,
} from '../../core/plugins';
import { Schema } from '../../core/schema';
import { PageHeader } from '../../shared/components/page-header';

/** Splits a message on backticks: odd segments are code. */
function segments(text: string): string[] {
  return text.split('`');
}

const GROUP_ICONS: Record<CapabilityGroup['kind'], string> = {
  read: 'lucideEye',
  write: 'lucidePencil',
  http: 'lucideGlobe',
  kv: 'lucideDatabase',
};

/** Settings → Plugins: installed WebAssembly plugins, their access, switches and settings. */
@Component({
  selector: 'vd-plugins',
  imports: [
    NgIcon,
    HlmAlertImports,
    HlmBadgeImports,
    HlmButtonImports,
    HlmCardImports,
    HlmDialogImports,
    HlmEmptyImports,
    HlmFieldImports,
    HlmSkeletonImports,
    HlmSpinnerImports,
    HlmSwitchImports,
    HlmTextareaImports,
    PageHeader,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-6">
      <vd-page-header
        [title]="t('settings.plugins.title')"
        [description]="t('settings.plugins.description')"
      >
        <span eyebrow class="text-primary flex items-center gap-1.5 text-xs font-medium">
          <ng-icon name="lucidePlug" size="14" /> {{ t('shell.settings') }}
        </span>
        <div actions>
          <button hlmBtn variant="outline" [disabled]="loading()" (click)="reload()">
            <ng-icon name="lucideRefreshCw" /> {{ t('settings.plugins.refresh') }}
          </button>
        </div>
      </vd-page-header>

      @if (error()) {
        <div hlmAlert variant="destructive">
          <ng-icon hlmAlertIcon name="lucideCircleAlert" />
          <p hlmAlertTitle>{{ t('settings.plugins.loadError') }}</p>
          <p hlmAlertDescription>{{ error() }}</p>
        </div>
      }

      @if (loadErrors().length) {
        <div hlmAlert variant="destructive">
          <ng-icon hlmAlertIcon name="lucideTriangleAlert" />
          <p hlmAlertTitle>
            {{ t('settings.plugins.brokenTitle', { count: loadErrors().length }) }}
          </p>
          <div hlmAlertDescription>
            <ul class="flex flex-col gap-1">
              @for (item of loadErrors(); track item.dir) {
                <li>
                  <code class="font-mono text-xs font-medium">{{ item.dir }}</code>
                  — {{ item.error }}
                </li>
              }
            </ul>
          </div>
        </div>
      }

      @if (plugins() === null) {
        @if (!error()) {
          <hlm-skeleton class="h-48 rounded-xl" />
        }
      } @else if (plugins()!.length === 0) {
        <div hlmEmpty class="rounded-xl border border-dashed py-16">
          <div hlmEmptyHeader>
            <div hlmEmptyMedia variant="icon"><ng-icon name="lucidePlug" /></div>
            <h2 hlmEmptyTitle>{{ t('settings.plugins.emptyTitle') }}</h2>
            <p hlmEmptyDescription>
              @for (part of segments(t('settings.plugins.emptyHint')); track $index) {
                @if ($odd) {
                  <code class="bg-muted rounded px-1 py-0.5 font-mono text-xs">{{ part }}</code>
                } @else {
                  {{ part }}
                }
              }
            </p>
          </div>
        </div>
      } @else {
        <div class="flex flex-col gap-4">
          @for (plugin of plugins(); track plugin.name) {
            <section hlmCard [attr.aria-labelledby]="'plugin-' + plugin.name">
              <div hlmCardHeader>
                <div class="flex min-w-0 items-start gap-3">
                  <span
                    class="flex size-9 shrink-0 items-center justify-center rounded-lg"
                    [class]="
                      plugin.enabled
                        ? 'bg-primary/10 text-primary'
                        : 'bg-muted text-muted-foreground'
                    "
                  >
                    <ng-icon name="lucidePlug" size="18" />
                  </span>
                  <div class="flex min-w-0 flex-col gap-1">
                    <h2
                      hlmCardTitle
                      class="flex flex-wrap items-center gap-2"
                      [id]="'plugin-' + plugin.name"
                    >
                      <span class="font-mono">{{ plugin.name }}</span>
                      <span hlmBadge variant="outline" class="font-mono font-normal"
                        >v{{ plugin.version }}</span
                      >
                      @if (!plugin.enabled) {
                        <span hlmBadge variant="secondary">{{ t('settings.plugins.off') }}</span>
                      }
                    </h2>
                    @if (plugin.description) {
                      <p hlmCardDescription>{{ plugin.description }}</p>
                    }
                  </div>
                </div>
                <div hlmCardAction>
                  <hlm-switch
                    [checked]="plugin.enabled"
                    [disabled]="busy() === plugin.name"
                    [aria-label]="t('settings.plugins.toggle', { name: plugin.name })"
                    (checkedChange)="setEnabled(plugin, $event)"
                  />
                </div>
              </div>
              <div hlmCardContent class="flex flex-col gap-4">
                <div class="flex flex-col gap-2">
                  <h3 class="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                    {{ t('settings.plugins.access') }}
                  </h3>
                  <div class="flex flex-wrap gap-1.5">
                    @for (group of groups(plugin); track group.kind) {
                      @if (group.risky) {
                        <span
                          class="inline-flex max-w-full items-center gap-1 rounded-4xl border border-amber-500/50 bg-amber-500/10 px-2 py-1 text-xs text-amber-800 dark:text-amber-300"
                        >
                          <ng-icon name="lucideTriangleAlert" size="12" aria-hidden="true" />
                          <span class="font-medium">{{ groupLabel(group) }}</span>
                          <span class="break-all">{{ groupItems(group) }}</span>
                        </span>
                      } @else {
                        <span
                          hlmBadge
                          variant="secondary"
                          class="h-auto max-w-full py-1 font-normal whitespace-normal"
                        >
                          <ng-icon [name]="groupIcons[group.kind]" aria-hidden="true" />
                          <span class="font-medium">{{ groupLabel(group) }}</span>
                          @if (group.items.length) {
                            <span class="break-all">{{ groupItems(group) }}</span>
                          }
                        </span>
                      }
                    } @empty {
                      <span class="text-muted-foreground text-sm">{{
                        t('settings.plugins.noAccess')
                      }}</span>
                    }
                  </div>
                </div>

                <dl class="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[auto_1fr]">
                  <dt class="text-muted-foreground flex items-center gap-1.5">
                    <ng-icon name="lucideZap" size="14" aria-hidden="true" />
                    {{ t('settings.plugins.hooks') }}
                  </dt>
                  <dd class="min-w-0">
                    @if (plugin.hooks.length) {
                      <ul class="flex flex-col gap-0.5">
                        @for (hook of plugin.hooks; track $index) {
                          <li class="font-mono text-xs break-all">
                            {{ hook.on }} · {{ hook.uid }} → {{ hook.function }}
                          </li>
                        }
                      </ul>
                    } @else {
                      <span class="text-muted-foreground">{{ t('common.none') }}</span>
                    }
                  </dd>
                  <dt class="text-muted-foreground flex items-center gap-1.5">
                    <ng-icon name="lucideRoute" size="14" aria-hidden="true" />
                    {{ t('settings.plugins.routes') }}
                  </dt>
                  <dd class="flex min-w-0 items-center gap-1">
                    @if (plugin.routes) {
                      @let url = routeUrl(plugin.routes);
                      <code class="min-w-0 font-mono text-xs break-all">{{ url }}/…</code>
                      <button
                        hlmBtn
                        size="icon-xs"
                        variant="ghost"
                        class="text-muted-foreground"
                        [attr.aria-label]="t('settings.plugins.copyUrl')"
                        [attr.title]="t('settings.plugins.copyUrl')"
                        (click)="copy(url)"
                      >
                        <ng-icon name="lucideCopy" />
                      </button>
                    } @else {
                      <span class="text-muted-foreground">{{ t('common.none') }}</span>
                    }
                  </dd>
                  <dt class="text-muted-foreground flex items-center gap-1.5">
                    <ng-icon name="lucideTimer" size="14" aria-hidden="true" />
                    {{ t('settings.plugins.jobs') }}
                  </dt>
                  <dd class="min-w-0">
                    @if (plugin.jobs.length) {
                      <ul class="flex flex-col gap-0.5">
                        @for (job of plugin.jobs; track $index) {
                          <li class="font-mono text-xs break-all">
                            {{ job.schedule }} → {{ job.function }}
                          </li>
                        }
                      </ul>
                    } @else {
                      <span class="text-muted-foreground">{{ t('common.none') }}</span>
                    }
                  </dd>
                  <dt class="text-muted-foreground flex items-center gap-1.5">
                    <ng-icon name="lucideLayoutDashboard" size="14" aria-hidden="true" />
                    {{ t('settings.plugins.admin') }}
                  </dt>
                  <dd class="min-w-0">
                    @if (plugin.admin.script) {
                      {{
                        t('settings.plugins.adminSummary', {
                          widgets: t('settings.plugins.adminWidgets', {
                            count: plugin.admin.widgets.length,
                          }),
                          fields: t('settings.plugins.adminFields', {
                            count: plugin.admin.fields.length,
                          }),
                        })
                      }}
                    } @else {
                      <span class="text-muted-foreground">{{ t('common.none') }}</span>
                    }
                  </dd>
                  <dt class="text-muted-foreground flex items-center gap-1.5">
                    <ng-icon name="lucideClock" size="14" aria-hidden="true" />
                    {{ t('settings.plugins.limits') }}
                  </dt>
                  <dd class="tabular-nums">
                    {{
                      t('settings.plugins.limitsValue', {
                        timeout: plugin.limits.timeout_ms,
                        memory: plugin.limits.memory_mb,
                      })
                    }}
                  </dd>
                </dl>
              </div>
              <div hlmCardFooter class="flex flex-wrap gap-2">
                <button hlmBtn variant="outline" size="sm" (click)="openSettings(plugin)">
                  <ng-icon name="lucideSettings" /> {{ t('settings.plugins.settings') }}
                </button>
                <button hlmBtn variant="outline" size="sm" (click)="openLogs(plugin)">
                  <ng-icon name="lucideScrollText" /> {{ t('settings.plugins.logs') }}
                </button>
              </div>
            </section>
          }
        </div>
      }
    </div>

    <!-- Settings dialog -->
    <hlm-dialog [state]="editing() ? 'open' : 'closed'" (closed)="editing.set(null)">
      <hlm-dialog-content
        *hlmDialogPortal="let ctx"
        class="sm:max-w-2xl"
        [closeLabel]="t('common.close')"
      >
        @if (editing(); as plugin) {
          <hlm-dialog-header>
            <h2 hlmDialogTitle>
              {{ t('settings.plugins.settingsTitle', { name: plugin.name }) }}
            </h2>
            <p hlmDialogDescription>{{ t('settings.plugins.settingsHint') }}</p>
          </hlm-dialog-header>
          <form class="flex flex-col gap-4" (submit)="$event.preventDefault(); saveSettings()">
            <div hlmField [attr.data-invalid]="!parsed().ok || null">
              <label hlmFieldLabel for="plugin-settings">{{
                t('settings.plugins.settingsJson')
              }}</label>
              <textarea
                hlmTextarea
                id="plugin-settings"
                rows="12"
                spellcheck="false"
                class="font-mono text-xs"
                [attr.aria-invalid]="!parsed().ok || null"
                [attr.aria-describedby]="parsed().ok ? null : 'plugin-settings-error'"
                [value]="settingsText()"
                (input)="settingsText.set($any($event.target).value)"
              ></textarea>
              @if (settingsError(); as message) {
                <p hlmFieldError id="plugin-settings-error">{{ message }}</p>
              }
            </div>
            <hlm-dialog-footer>
              <button hlmBtn type="button" variant="outline" (click)="editing.set(null)">
                {{ t('common.cancel') }}
              </button>
              <button hlmBtn type="submit" [disabled]="!parsed().ok || saving()">
                @if (saving()) {
                  <hlm-spinner class="size-4" />
                }
                {{ t('common.save') }}
              </button>
            </hlm-dialog-footer>
          </form>
        }
      </hlm-dialog-content>
    </hlm-dialog>

    <!-- Logs dialog -->
    <hlm-dialog [state]="logsOf() ? 'open' : 'closed'" (closed)="logsOf.set(null)">
      <hlm-dialog-content
        *hlmDialogPortal="let ctx"
        class="max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-3xl"
        [closeLabel]="t('common.close')"
      >
        @if (logsOf(); as plugin) {
          <hlm-dialog-header>
            <h2 hlmDialogTitle>{{ t('settings.plugins.logsTitle', { name: plugin.name }) }}</h2>
            <p hlmDialogDescription>{{ t('settings.plugins.logsHint') }}</p>
          </hlm-dialog-header>
          <div class="-mx-6 min-h-0 overflow-y-auto px-6" aria-live="polite">
            @if (logs() === null) {
              <div class="flex flex-col gap-2">
                <hlm-skeleton class="h-6 w-full" />
                <hlm-skeleton class="h-6 w-full" />
                <hlm-skeleton class="h-6 w-2/3" />
              </div>
            } @else if (logsError()) {
              <p class="text-destructive text-sm">{{ logsError() }}</p>
            } @else if (logs()!.length === 0) {
              <p class="text-muted-foreground py-8 text-center text-sm">
                {{ t('settings.plugins.noLogs') }}
              </p>
            } @else {
              <ol class="divide-y rounded-lg border font-mono text-xs">
                @for (entry of logs(); track $index) {
                  <li class="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2">
                    <span class="text-muted-foreground shrink-0 tabular-nums">{{
                      i18n.formatDate(entry.at, 'datetime')
                    }}</span>
                    <span
                      class="inline-flex h-5 shrink-0 items-center rounded-4xl px-2 text-[10px] font-medium uppercase"
                      [class]="levelClass(entry.level)"
                      >{{ entry.level }}</span
                    >
                    <span class="min-w-0 flex-1 break-words whitespace-pre-wrap">{{
                      entry.message
                    }}</span>
                  </li>
                }
              </ol>
            }
          </div>
          <hlm-dialog-footer>
            <button
              hlmBtn
              type="button"
              variant="outline"
              [disabled]="logs() === null"
              (click)="loadLogs(plugin)"
            >
              <ng-icon name="lucideRefreshCw" /> {{ t('settings.plugins.refresh') }}
            </button>
            <button hlmBtn type="button" (click)="logsOf.set(null)">
              {{ t('common.close') }}
            </button>
          </hlm-dialog-footer>
        }
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class PluginsPage implements OnInit {
  private readonly service = inject(Plugins);
  private readonly extensions = inject(PluginExtensions);
  private readonly schema = inject(Schema);
  private readonly config = inject(RUNTIME_CONFIG);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  protected readonly segments = segments;
  protected readonly groupIcons = GROUP_ICONS;

  protected readonly plugins = signal<Plugin[] | null>(null);
  protected readonly loadErrors = signal<PluginLoadError[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly busy = signal<string | null>(null);

  protected readonly editing = signal<Plugin | null>(null);
  protected readonly settingsText = signal('');
  protected readonly saving = signal(false);
  protected readonly parsed = computed(() => parseSettings(this.settingsText()));
  protected readonly settingsError = computed(() => {
    const parsed = this.parsed();
    if (parsed.ok) return null;
    return parsed.error === 'object'
      ? this.t('settings.plugins.settingsNotObject')
      : this.t('settings.plugins.settingsInvalid', { error: parsed.error });
  });

  protected readonly logsOf = signal<Plugin | null>(null);
  protected readonly logs = signal<PluginLog[] | null>(null);
  protected readonly logsError = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  protected async reload(): Promise<void> {
    this.loading.set(true);
    try {
      const { plugins, errors } = await this.service.list();
      this.plugins.set([...(plugins ?? [])].sort((a, b) => a.name.localeCompare(b.name)));
      this.loadErrors.set(errors ?? []);
      this.error.set(null);
    } catch (error) {
      this.error.set(ApiFailure.from(error).message);
    } finally {
      this.loading.set(false);
    }
  }

  protected levelClass(level: string): string {
    if (level === 'error') return 'bg-destructive/10 text-destructive';
    if (level === 'warn' || level === 'warning')
      return 'bg-amber-500/10 text-amber-800 dark:text-amber-300';
    return 'bg-secondary text-secondary-foreground';
  }

  protected groups(plugin: Plugin): CapabilityGroup[] {
    return capabilityGroups(plugin.capabilities);
  }

  protected groupLabel(group: CapabilityGroup): string {
    switch (group.kind) {
      case 'read':
        return this.t('settings.plugins.cap.read');
      case 'write':
        return this.t('settings.plugins.cap.write');
      case 'http':
        return this.t('settings.plugins.cap.http');
      case 'kv':
        return this.t('settings.plugins.cap.kv');
    }
  }

  /** Content types by name (`*`: every type); hosts as they are. */
  protected groupItems(group: CapabilityGroup): string {
    if (group.kind === 'http') return group.items.join(', ');
    return group.items
      .map((uid) =>
        uid === '*'
          ? this.t('settings.plugins.allTypes')
          : (this.schema.type(uid)?.displayName ?? uid),
      )
      .join(', ');
  }

  protected routeUrl(route: string): string {
    return pluginRouteUrl(this.config.contentApiBase, route, document.baseURI);
  }

  protected async copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(this.t('settings.plugins.copied'));
    } catch {
      toast.error(this.t('settings.plugins.copyFailed'));
    }
  }

  private replace(updated: Plugin): void {
    this.plugins.update((list) =>
      (list ?? []).map((item) => (item.name === updated.name ? { ...item, ...updated } : item)),
    );
  }

  protected async setEnabled(plugin: Plugin, enabled: boolean): Promise<void> {
    this.busy.set(plugin.name);
    try {
      this.replace(await this.service.update(plugin.name, { enabled }));
      toast.success(
        this.t(enabled ? 'settings.plugins.turnedOn' : 'settings.plugins.turnedOff', {
          name: plugin.name,
        }),
      );
      // New or removed widgets and fields.
      void this.extensions.load();
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
      // Put the switch back.
      this.plugins.update((list) => (list ? [...list] : list));
    } finally {
      this.busy.set(null);
    }
  }

  protected openSettings(plugin: Plugin): void {
    this.settingsText.set(JSON.stringify(plugin.settings ?? {}, null, 2));
    this.editing.set(plugin);
  }

  protected async saveSettings(): Promise<void> {
    const plugin = this.editing();
    const parsed = this.parsed();
    if (!plugin || !parsed.ok) return;
    // The switch may have changed since the dialog opened.
    const current = this.plugins()?.find((item) => item.name === plugin.name) ?? plugin;
    this.saving.set(true);
    try {
      this.replace(
        await this.service.update(plugin.name, {
          enabled: current.enabled,
          settings: parsed.value,
        }),
      );
      toast.success(this.t('settings.plugins.saved', { name: plugin.name }));
      this.editing.set(null);
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    } finally {
      this.saving.set(false);
    }
  }

  protected openLogs(plugin: Plugin): void {
    this.logsOf.set(plugin);
    void this.loadLogs(plugin);
  }

  protected async loadLogs(plugin: Plugin): Promise<void> {
    this.logs.set(null);
    this.logsError.set(null);
    try {
      const logs = await this.service.logs(plugin.name);
      if (this.logsOf()?.name === plugin.name) this.logs.set(logs ?? []);
    } catch (error) {
      this.logsError.set(ApiFailure.from(error).message);
      this.logs.set([]);
    }
  }
}
