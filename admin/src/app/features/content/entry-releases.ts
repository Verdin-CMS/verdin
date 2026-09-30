import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';

import { ApiFailure } from '../../core/api';
import { I18n } from '../../core/i18n/i18n';
import { Release, ReleaseActionKind, Releases, hasEntry, sortReleases } from '../../core/releases';
import { ReleaseStatusBadge } from '../releases/release-parts';

/** The editor's "Releases" card: the releases with this entry, and adding it to one. */
@Component({
  selector: 'vd-entry-releases',
  imports: [
    NgIcon,
    RouterLink,
    HlmAlertImports,
    HlmButtonImports,
    HlmCardImports,
    HlmDialogImports,
    HlmFieldImports,
    HlmNativeSelectImports,
    HlmSkeletonImports,
    HlmSpinnerImports,
    ReleaseStatusBadge,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section hlmCard size="sm" aria-labelledby="entry-releases-title">
      <div hlmCardHeader>
        <h2 hlmCardTitle id="entry-releases-title">{{ t('releases.entryPanel.title') }}</h2>
        @if (canAdd()) {
          <div hlmCardAction>
            <button hlmBtn variant="outline" size="sm" type="button" (click)="openAdd()">
              <ng-icon name="lucideCalendarClock" /> {{ t('releases.entryPanel.add') }}
            </button>
          </div>
        }
      </div>
      <div hlmCardContent>
        @if (releases() === null) {
          <hlm-skeleton class="h-10 w-full" />
        } @else if (mine().length === 0) {
          <p class="text-muted-foreground text-sm">{{ t('releases.entryPanel.none') }}</p>
        } @else {
          <ul class="flex flex-col gap-2">
            @for (item of mine(); track item.release.id) {
              <li class="flex items-start justify-between gap-2 text-sm">
                <span class="flex min-w-0 flex-col">
                  <a
                    class="hover:text-primary truncate font-medium underline-offset-2 hover:underline"
                    [routerLink]="['/releases', item.release.id]"
                    >{{ item.release.name }}</a
                  >
                  <span class="text-muted-foreground text-xs">
                    {{
                      item.action === 'publish'
                        ? t('releases.action.publish')
                        : t('releases.action.unpublish')
                    }}
                    ·
                    {{
                      item.release.scheduledAt
                        ? i18n.formatDate(item.release.scheduledAt)
                        : t('releases.notScheduled')
                    }}
                  </span>
                </span>
                <vd-release-status [status]="item.release.status" />
              </li>
            }
          </ul>
        }
      </div>
    </section>

    <hlm-dialog [state]="adding() ? 'open' : 'closed'" (closed)="adding.set(false)">
      <hlm-dialog-content
        *hlmDialogPortal="let ctx"
        class="sm:max-w-md"
        [closeLabel]="t('common.close')"
      >
        <hlm-dialog-header>
          <h2 hlmDialogTitle>{{ t('releases.entryPanel.addTitle') }}</h2>
          <p hlmDialogDescription>{{ t('releases.entryPanel.addDescription') }}</p>
        </hlm-dialog-header>
        @if (pending() === null) {
          <hlm-skeleton class="h-20 w-full" />
        } @else if (pending()!.length === 0) {
          <div hlmAlert>
            <ng-icon hlmAlertIcon name="lucideInfo" />
            <p hlmAlertTitle>{{ t('releases.entryPanel.noPending') }}</p>
            <p hlmAlertDescription>
              <a
                class="underline underline-offset-2"
                routerLink="/releases"
                (click)="adding.set(false)"
                >{{ t('releases.entryPanel.createFirst') }}</a
              >
            </p>
          </div>
        } @else {
          <form class="flex flex-col gap-4" (submit)="$event.preventDefault(); add()">
            <div hlmField>
              <label hlmFieldLabel for="entry-release">{{
                t('releases.entryPanel.release')
              }}</label>
              <hlm-native-select
                selectId="entry-release"
                [value]="choice()"
                (valueChange)="choice.set($event ?? '')"
              >
                @for (release of pending(); track release.id) {
                  <option hlmNativeSelectOption [value]="'' + release.id">
                    {{ release.name }}
                    @if (release.scheduledAt) {
                      ({{ i18n.formatDate(release.scheduledAt) }})
                    }
                  </option>
                }
              </hlm-native-select>
            </div>
            <fieldset class="flex flex-col gap-2">
              <legend class="mb-1 text-sm font-medium">
                {{ t('releases.entryPanel.actionLabel') }}
              </legend>
              @for (option of actions; track option) {
                <label class="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="entry-release-action"
                    class="accent-primary size-4"
                    [value]="option"
                    [checked]="kind() === option"
                    (change)="kind.set(option)"
                  />
                  {{
                    option === 'publish'
                      ? t('releases.action.publish')
                      : t('releases.action.unpublish')
                  }}
                </label>
              }
            </fieldset>
            @if (locale()) {
              <p class="text-muted-foreground text-xs">
                {{ t('releases.entryPanel.localeHint', { locale: locale() }) }}
              </p>
            }
            @if (duplicate()) {
              <p class="text-muted-foreground text-xs" role="status">
                {{ t('releases.entryPanel.alreadyIn') }}
              </p>
            }
            @if (error()) {
              <div hlmAlert variant="destructive" role="alert">
                <ng-icon hlmAlertIcon name="lucideCircleAlert" />
                <p hlmAlertDescription>{{ error() }}</p>
              </div>
            }
            <hlm-dialog-footer>
              <button hlmBtn type="button" variant="outline" (click)="adding.set(false)">
                {{ t('common.cancel') }}
              </button>
              <button hlmBtn type="submit" [disabled]="!choice() || busy()">
                @if (busy()) {
                  <hlm-spinner class="size-4" />
                }
                {{ t('releases.entryPanel.confirm') }}
              </button>
            </hlm-dialog-footer>
          </form>
        }
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class EntryReleases {
  private readonly service = inject(Releases);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;

  readonly uid = input.required<string>();
  readonly documentId = input.required<string>();
  /** The edited locale (localized types). */
  readonly locale = input<string | null>(null);
  /** Needs `releases.manage` and publishing rights on the type. */
  readonly canAdd = input(false);

  protected readonly actions: ReleaseActionKind[] = ['publish', 'unpublish'];
  protected readonly releases = signal<Release[] | null>(null);
  protected readonly pending = signal<Release[] | null>(null);
  protected readonly adding = signal(false);
  protected readonly choice = signal('');
  protected readonly kind = signal<ReleaseActionKind>('publish');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  /** The releases with this entry, and what they do with it (in this locale first). */
  protected readonly mine = computed(() =>
    sortReleases(this.releases() ?? []).map((release) => {
      const action =
        hasEntry(release, this.uid(), this.documentId(), this.locale()) ??
        release.actions.find(
          (item) => item.uid === this.uid() && item.documentId === this.documentId(),
        );
      return { release, action: action?.action ?? 'publish' };
    }),
  );
  protected readonly duplicate = computed(() => {
    const release = this.pending()?.find((item) => String(item.id) === this.choice());
    return !!release && !!hasEntry(release, this.uid(), this.documentId(), this.locale());
  });

  constructor() {
    effect(() => {
      this.uid();
      this.documentId();
      untracked(() => void this.load());
    });
  }

  async load(): Promise<void> {
    try {
      this.releases.set(await this.service.forEntry(this.uid(), this.documentId()));
    } catch {
      this.releases.set([]);
    }
  }

  protected async openAdd(): Promise<void> {
    this.error.set(null);
    this.kind.set('publish');
    this.pending.set(null);
    this.adding.set(true);
    try {
      const pending = sortReleases(await this.service.all('pending'));
      this.pending.set(pending);
      this.choice.set(pending[0] ? String(pending[0].id) : '');
    } catch (error) {
      this.pending.set([]);
      this.error.set(ApiFailure.from(error).message);
    }
  }

  protected async add(): Promise<void> {
    const id = Number(this.choice());
    if (!id || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const release = await this.service.addAction(id, {
        uid: this.uid(),
        documentId: this.documentId(),
        locale: this.locale(),
        action: this.kind(),
      });
      this.adding.set(false);
      toast.success(this.t('releases.toast.entryAdded', { name: release.name }));
      await this.load();
    } catch (error) {
      this.error.set(ApiFailure.from(error).message);
    } finally {
      this.busy.set(false);
    }
  }
}
