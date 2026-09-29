import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';

import { I18n } from '../../core/i18n/i18n';
import { isMorph } from '../../core/morph';
import { Attribute } from '../../core/types';
import { MEDIA_KINDS, TYPE_BY_NAME } from './builder-model';
import { BuilderStore } from './builder-store';
import { attributeLocalized } from './i18n-options';

/** The drafted type's fields card: badges and a summary per field, reorder, edit and remove. */
@Component({
  selector: 'section[vdAttributeList]',
  imports: [NgIcon, HlmBadgeImports, HlmButtonImports, HlmCardImports, HlmEmptyImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div hlmCardHeader>
      <h2 hlmCardTitle>{{ t('builder.fields.title') }}</h2>
      <p hlmCardDescription>
        {{ t('builder.fields.count', { count: store.attributeEntries().length }) }}
      </p>
      <div hlmCardAction>
        <button hlmBtn size="sm" variant="outline" (click)="store.editAttribute(null)">
          <ng-icon name="lucidePlus" /> {{ t('builder.fields.add') }}
        </button>
      </div>
    </div>
    <div hlmCardContent>
      @if (store.attributeEntries().length) {
        <ul class="divide-y rounded-lg border">
          @for (entry of store.attributeEntries(); track entry.name; let index = $index) {
            @let info = typeInfo.get(entry.attribute.type);
            <li class="hover:bg-muted/40 flex items-center gap-3 px-3 py-2.5">
              <span
                class="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-md"
              >
                <ng-icon [name]="info?.icon ?? 'lucideType'" size="16" />
              </span>
              <div class="flex min-w-0 flex-1 flex-col">
                <span class="flex flex-wrap items-center gap-1.5">
                  <span class="truncate font-mono text-sm font-medium">{{ entry.name }}</span>
                  <span hlmBadge variant="secondary">{{
                    info ? t(info.label) : entry.attribute.type
                  }}</span>
                  @if (entry.attribute.customField) {
                    <span hlmBadge variant="outline">
                      <ng-icon name="lucidePlug" />
                      {{ store.customFieldName(entry.attribute.customField) }}
                    </span>
                  }
                  @if (entry.attribute.required) {
                    <span hlmBadge variant="outline">{{ t('builder.fields.required') }}</span>
                  }
                  @if (entry.attribute.unique) {
                    <span hlmBadge variant="outline">{{ t('builder.fields.unique') }}</span>
                  }
                  @if (entry.attribute.private) {
                    <span hlmBadge variant="outline">
                      <ng-icon name="lucideEyeOff" />
                      {{ t('builder.fields.private') }}
                    </span>
                  }
                  @if (entry.attribute.multiple) {
                    <span hlmBadge variant="outline">{{ t('builder.fields.multiple') }}</span>
                  }
                  @if (entry.attribute.repeatable) {
                    <span hlmBadge variant="outline">{{ t('builder.fields.repeatable') }}</span>
                  }
                  @if (entry.attribute.configurable === false) {
                    <span hlmBadge variant="outline">
                      <ng-icon name="lucideLock" />
                      {{ t('builder.fields.locked') }}
                    </span>
                  }
                  @if (isMorph(entry.attribute)) {
                    <span hlmBadge variant="outline" data-morph-badge>
                      <ng-icon name="lucideWaypoints" />
                      {{ t('builder.fields.polymorphic') }}
                    </span>
                  }
                  @if (entry.attribute.conditions) {
                    <span hlmBadge variant="outline">
                      <ng-icon name="lucideSplit" />
                      {{ t('builder.fields.conditional') }}
                    </span>
                  }
                  @if (store.localized() && !attributeLocalized(entry.attribute)) {
                    <span hlmBadge variant="outline">
                      <ng-icon name="lucideGlobe" />
                      {{ t('builder.fields.shared') }}
                    </span>
                  }
                </span>
                @if (summary(entry.attribute); as text) {
                  <span class="text-muted-foreground truncate text-xs">{{ text }}</span>
                }
                @if (entry.attribute.configurable === false) {
                  <span class="text-muted-foreground text-xs">{{
                    t('builder.fields.lockedHint')
                  }}</span>
                }
              </div>
              <div class="flex shrink-0 items-center gap-0.5">
                <button
                  hlmBtn
                  size="icon-xs"
                  variant="ghost"
                  [attr.aria-label]="t('builder.fields.moveUp')"
                  [attr.title]="t('builder.fields.moveUp')"
                  [disabled]="index === 0"
                  (click)="store.moveAttribute(index, -1)"
                >
                  <ng-icon name="lucideArrowUp" />
                </button>
                <button
                  hlmBtn
                  size="icon-xs"
                  variant="ghost"
                  [attr.aria-label]="t('builder.fields.moveDown')"
                  [attr.title]="t('builder.fields.moveDown')"
                  [disabled]="index === store.attributeEntries().length - 1"
                  (click)="store.moveAttribute(index, 1)"
                >
                  <ng-icon name="lucideArrowDown" />
                </button>
                @if (entry.attribute.configurable !== false) {
                  <button
                    hlmBtn
                    size="icon-xs"
                    variant="ghost"
                    [attr.aria-label]="t('builder.fields.edit', { name: entry.name })"
                    [attr.title]="t('builder.fields.edit', { name: entry.name })"
                    (click)="store.editAttribute(entry.name)"
                  >
                    <ng-icon name="lucidePencil" />
                  </button>
                  <button
                    hlmBtn
                    size="icon-xs"
                    variant="ghost"
                    class="hover:text-destructive"
                    [attr.aria-label]="t('builder.fields.remove', { name: entry.name })"
                    [attr.title]="t('builder.fields.remove', { name: entry.name })"
                    (click)="store.removeAttribute(entry.name)"
                  >
                    <ng-icon name="lucideTrash2" />
                  </button>
                }
              </div>
            </li>
          }
        </ul>
      } @else {
        <div hlmEmpty class="rounded-lg border border-dashed">
          <div hlmEmptyHeader>
            <div hlmEmptyMedia variant="icon"><ng-icon name="lucideLayers" /></div>
            <p hlmEmptyTitle>{{ t('builder.fields.empty') }}</p>
            <p hlmEmptyDescription>{{ t('builder.fields.emptyHint') }}</p>
          </div>
        </div>
      }
    </div>
  `,
})
export class AttributeList {
  protected readonly store = inject(BuilderStore);
  protected readonly t = inject(I18n).t;
  protected readonly typeInfo = TYPE_BY_NAME;
  protected readonly isMorph = isMorph;
  protected readonly attributeLocalized = attributeLocalized;

  /** One line on what the field holds: its relation, components, options or limits. */
  protected summary(attribute: Attribute): string {
    const parts: string[] = [];
    if (attribute.relation) {
      const by = attribute.mappedBy ?? attribute.morphBy;
      const via = by ? ` ${this.t('builder.summary.via', { field: by })}` : '';
      // Polymorphic owners have no target: they link entries of any type.
      parts.push(
        attribute.target ? `${attribute.relation} → ${attribute.target}${via}` : attribute.relation,
      );
    }
    if (attribute.component) parts.push(attribute.component);
    if (attribute.components) parts.push(attribute.components.join(', '));
    if (attribute.enum) parts.push(attribute.enum.join(' | '));
    if (attribute.allowedTypes)
      parts.push(
        MEDIA_KINDS.filter((media) => attribute.allowedTypes?.includes(media.kind))
          .map((media) => this.t(media.label))
          .join(', '),
      );
    if (attribute.maxLength !== undefined)
      parts.push(this.t('builder.summary.maxLength', { count: attribute.maxLength }));
    if (attribute.targetField)
      parts.push(this.t('builder.summary.from', { field: attribute.targetField }));
    return parts.join(' · ');
  }
}
