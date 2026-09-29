import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { toast } from '@spartan-ng/brain/sonner';

import { Api, ApiFailure } from '../../core/api';
import { I18n } from '../../core/i18n/i18n';
import { SimpleCondition, conditionsOf, simpleCondition } from '../../core/logic';
import { PluginExtensions, PluginField } from '../../core/plugin-extensions';
import { customFieldId, parseCustomField } from '../../core/plugins';
import { Schema } from '../../core/schema';
import { Attribute, AttributeType, MediaKind, RelationKind, SchemaPlan } from '../../core/types';
import { Confirm } from '../../shared/components/confirm';
import {
  AttributeDraft,
  COMPONENT_RELATIONS,
  CONDITION_TYPES,
  Change,
  INVERSE,
  MEDIA_KINDS,
  RELATIONS,
  SchemaFile,
  Sources,
  TYPE_INFO,
  allowsMedia,
  isBidirectional,
  kebab,
  plural,
} from './builder-model';
import { setAttributeLocalized, setTypeLocalized, typeLocalized } from './i18n-options';
import {
  SchemaFiles,
  compatibleOwnerFields,
  isInverseKind,
  morphIssue,
  morphOwnerOptions,
  suggestedOwnerField,
  typeKey,
  withRelationKind,
} from './morph-options';
import { offeredTypes } from './type-options';

/**
 * The content-type builder's state: the schema sources, the type or component being drafted,
 * the field being edited and the migration plan under review. Provided by `Builder`, so every
 * part of the page reads and edits the same draft.
 */
@Injectable()
export class BuilderStore {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly confirm = inject(Confirm);
  private readonly schema = inject(Schema);
  private readonly extensions = inject(PluginExtensions);
  private readonly t = inject(I18n).t;

  /** The route's name signal, set by `connect`. */
  private readonly route = signal<Signal<string | undefined>>(signal(undefined));
  /** A content type's singularName, `component:category.name`, `new` or `new-component`. */
  readonly name = computed(() => this.route()());

  readonly sources = signal<Sources | null>(null);
  readonly draft = signal<SchemaFile | null>(null);
  readonly componentUid = signal('');
  readonly attributeDraft = signal<AttributeDraft | null>(null);
  /** Inverse attributes to add to other types on save: `{ singularName: { name: attribute } }`. */
  private readonly inverseAdditions = signal<Record<string, Record<string, Attribute>>>({});
  readonly planResult = signal<SchemaPlan | null>(null);
  readonly acceptedHints = signal<string[]>([]);
  readonly busy = signal(false);

  readonly isComponent = computed(() => {
    const name = this.name() ?? '';
    return name === 'new-component' || name.startsWith('component:');
  });
  readonly isNew = computed(() => ['new', 'new-component'].includes(this.name() ?? ''));
  /** The type of the field being edited (an existing one keeps it listed). */
  private readonly editedType = computed(() => {
    const draft = this.attributeDraft();
    return draft?.originalName ? draft.attribute.type : null;
  });
  /** The attribute types offered in the picker (no `password` inside components). */
  readonly availableTypes = computed(() =>
    offeredTypes(TYPE_INFO, this.isComponent(), this.editedType()),
  );
  /** The relation kinds offered (components only hold one-way relations). */
  readonly availableRelations = computed(() =>
    this.isComponent() ? COMPONENT_RELATIONS : RELATIONS,
  );
  readonly defaultRelation = computed<RelationKind>(() =>
    this.isComponent() ? 'oneWay' : 'manyToOne',
  );
  /** Content types as they will be saved: the sources, with the edited type as drafted. */
  private readonly morphTypes = computed<SchemaFiles>(() => {
    const types: SchemaFiles = { ...(this.sources()?.contentTypes ?? {}) };
    const file = this.draft();
    const self = String(file?.['singularName'] ?? '');
    if (file && self && !this.isComponent()) types[self] = file;
    return types;
  });
  /** Types an inverse polymorphic side can read from (with an owner field of its kind). */
  readonly morphOwners = computed(() => {
    const kind = this.attributeDraft()?.attribute.relation;
    return isInverseKind(kind) ? morphOwnerOptions(this.morphTypes(), kind) : [];
  });
  /** The chosen owner's fields an inverse side can name in `morphBy`. */
  readonly morphByOptions = computed(() => {
    const attribute = this.attributeDraft()?.attribute;
    const kind = attribute?.relation;
    if (!isInverseKind(kind)) return [];
    return compatibleOwnerFields(this.morphTypes()[typeKey(attribute?.target)], kind);
  });
  /** Why the field would be rejected on save (polymorphic relations), else `null`. */
  readonly fieldIssue = computed(() => {
    const attribute = this.attributeDraft()?.attribute;
    return attribute ? morphIssue(attribute, this.morphTypes(), this.isComponent()) : null;
  });
  readonly draftAndPublish = computed(
    () =>
      !!(this.draft()?.['options'] as { draftAndPublish?: boolean } | undefined)?.draftAndPublish,
  );
  /** Content types only: components follow the attribute that holds them. */
  readonly localized = computed(() => !this.isComponent() && typeLocalized(this.draft()));
  readonly typeEntries = computed(() =>
    Object.entries(this.sources()?.contentTypes ?? {}).map(([key, file]) => ({
      key,
      label: String(file['displayName'] ?? key),
      single: file['kind'] === 'singleType',
    })),
  );
  readonly componentEntries = computed(() =>
    Object.entries(this.sources()?.components ?? {}).map(([uid, file]) => ({
      key: `component:${uid}`,
      uid,
      displayName: String(file['displayName'] ?? uid),
      label: `${file['displayName'] ?? uid} (${uid})`,
    })),
  );
  readonly attributeEntries = computed(() =>
    Object.entries(this.draft()?.attributes ?? {}).map(([name, attribute]) => ({
      name,
      attribute,
    })),
  );
  /** Fields of the edited type a condition can compare (not the field being edited). */
  readonly conditionFields = computed(() => {
    const draft = this.attributeDraft();
    return this.attributeEntries().filter(
      (entry) =>
        entry.name !== draft?.originalName &&
        entry.name !== draft?.name &&
        CONDITION_TYPES.has(entry.attribute.type),
    );
  });
  /** The edited field's condition as a simple rule; `null` when absent or more complex. */
  readonly simpleRule = computed(() =>
    simpleCondition(this.attributeDraft()?.attribute.conditions),
  );

  /** The draft as opened or last saved, to tell unsaved edits. */
  private baseline = '';
  /** The type or component the draft belongs to (`null`: none opened yet). */
  private openedName: string | null = null;
  private pendingRemoval = false;

  /** Follows the route's `name`. */
  connect(name: Signal<string | undefined>): void {
    this.route.set(name);
  }

  private snapshot(): string {
    return JSON.stringify([this.draft(), this.componentUid(), this.inverseAdditions()]);
  }

  /** Edits to the type or component that are not applied yet. */
  hasUnsavedChanges(): boolean {
    return !!this.draft() && this.snapshot() !== this.baseline;
  }

  /**
   * Opens the draft for the route. Another type or component was already confirmed by the
   * route's guard; fresh sources for the same one would drop its edits, so they ask first.
   */
  async reopen(name: string | undefined, sources: Sources | null): Promise<void> {
    if (
      sources &&
      (name ?? null) === this.openedName &&
      this.hasUnsavedChanges() &&
      !(await this.confirm.discardChanges())
    )
      return;
    this.open(name, sources);
  }

  async reloadSources(): Promise<void> {
    try {
      this.sources.set(await this.api.get<Sources>('/schema'));
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    }
  }

  private open(name: string | undefined, sources: Sources | null): void {
    this.inverseAdditions.set({});
    this.acceptedHints.set([]);
    if (!sources) return;
    if (!name) {
      const first = Object.keys(sources.contentTypes)[0];
      if (first) void this.router.navigate(['/builder', first], { replaceUrl: true });
      else void this.router.navigate(['/builder', 'new'], { replaceUrl: true });
      return;
    }
    if (name === 'new') {
      this.draft.set({
        kind: 'collectionType',
        displayName: '',
        singularName: '',
        pluralName: '',
        options: { draftAndPublish: true },
        attributes: {},
      });
    } else if (name === 'new-component') {
      this.componentUid.set('');
      this.draft.set({ displayName: '', attributes: {} });
    } else if (name.startsWith('component:')) {
      const uid = name.slice('component:'.length);
      this.componentUid.set(uid);
      this.draft.set(structuredClone(sources.components[uid] ?? null));
    } else {
      this.draft.set(structuredClone(sources.contentTypes[name] ?? null));
    }
    this.openedName = name;
    this.baseline = this.snapshot();
  }

  // Type settings

  setFileValue(key: string, value: unknown): void {
    this.draft.update((file) => (file ? { ...file, [key]: value } : file));
  }

  setDisplayName(value: string): void {
    this.setFileValue('displayName', value);
    if (!this.isNew()) return;
    if (this.isComponent()) {
      const current = this.componentUid();
      const category = current.includes('.') ? current.split('.')[0] : 'shared';
      this.componentUid.set(`${category}.${kebab(value)}`);
    } else {
      const singular = kebab(value);
      this.setFileValue('singularName', singular);
      this.setFileValue('pluralName', singular ? plural(singular) : '');
    }
  }

  setDraftAndPublish(value: boolean): void {
    const file = this.draft();
    if (file)
      this.setFileValue('options', {
        ...((file['options'] as object) ?? {}),
        draftAndPublish: value,
      });
  }

  setLocalized(value: boolean): void {
    this.draft.update((file) => (file ? setTypeLocalized(file, value) : file));
  }

  // The attribute list

  removeAttribute(name: string): void {
    const file = this.draft();
    if (!file) return;
    const { [name]: _removed, ...rest } = file.attributes;
    this.setFileValue('attributes', rest);
  }

  moveAttribute(index: number, delta: number): void {
    const file = this.draft();
    if (!file) return;
    const entries = Object.entries(file.attributes);
    const [entry] = entries.splice(index, 1);
    entries.splice(index + delta, 0, entry);
    this.setFileValue('attributes', Object.fromEntries(entries));
  }

  /** "Color (colors)" for a loaded field, else the plugin and id of `customField`. */
  customFieldName(customField: string): string {
    const field = this.extensions.field(customField);
    if (field) return `${field.title} (${field.plugin})`;
    const parsed = parseCustomField(customField);
    return parsed ? `${parsed.field} (${parsed.plugin})` : customField;
  }

  // The field dialog

  /** Opens the field dialog on an existing field, or on a new one (`null`). */
  editAttribute(name: string | null): void {
    const attribute = name ? this.draft()?.attributes[name] : undefined;
    this.attributeDraft.set({
      originalName: name,
      name: name ?? '',
      attribute: attribute ? structuredClone(attribute) : { type: 'string' },
      inverseName: '',
    });
  }

  closeAttribute(): void {
    this.attributeDraft.set(null);
  }

  patchField(changes: Partial<AttributeDraft>): void {
    this.attributeDraft.update((field) => (field ? { ...field, ...changes } : field));
  }

  patchAttribute(changes: Partial<Attribute>): void {
    this.attributeDraft.update((field) => {
      if (!field) return field;
      const attribute = { ...field.attribute, ...changes };
      for (const key of Object.keys(attribute) as (keyof Attribute)[])
        if (attribute[key] === undefined) delete attribute[key];
      return { ...field, attribute };
    });
  }

  setType(type: AttributeType): void {
    const base: Attribute = { type };
    if (type === 'relation') Object.assign(base, { relation: this.defaultRelation(), target: '' });
    if (type === 'enumeration') base.enum = ['option-a', 'option-b'];
    if (type === 'dynamiczone') base.components = [];
    this.attributeDraft.update((field) =>
      field
        ? {
            ...field,
            attribute: {
              ...base,
              required: field.attribute.required,
              pluginOptions: field.attribute.pluginOptions,
              conditions: field.attribute.conditions,
            },
          }
        : field,
    );
  }

  /** A plugin's custom field: stored as the field's type, rendered by the plugin. */
  setCustomField(field: PluginField): void {
    this.attributeDraft.update((draft) =>
      draft
        ? {
            ...draft,
            attribute: {
              type: field.type as AttributeType,
              customField: customFieldId(field.plugin, field.id),
              required: draft.attribute.required,
              pluginOptions: draft.attribute.pluginOptions,
              conditions: draft.attribute.conditions,
            },
          }
        : draft,
    );
  }

  setFieldLocalized(value: boolean): void {
    this.attributeDraft.update((field) =>
      field ? { ...field, attribute: setAttributeLocalized(field.attribute, value) } : field,
    );
  }

  /** Changes the relation kind, keeping only the settings that kind takes. */
  setRelationKind(kind: RelationKind): void {
    this.attributeDraft.update((field) =>
      field ? { ...field, attribute: withRelationKind(field.attribute, kind) } : field,
    );
  }

  /** An inverse side's owner type; an obvious owner field is chosen at once. */
  setMorphTarget(target: string): void {
    const kind = this.attributeDraft()?.attribute.relation;
    if (!isInverseKind(kind)) return;
    this.patchAttribute({
      target: target || undefined,
      morphBy: target ? suggestedOwnerField(this.morphTypes()[typeKey(target)], kind) : undefined,
    });
  }

  setEnum(text: string): void {
    this.patchAttribute({
      enum: text
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    });
  }

  setNumber(key: 'min' | 'max' | 'minLength' | 'maxLength', text: string): void {
    const value = text.trim() === '' ? undefined : Number(text);
    this.patchAttribute({
      [key]: value !== undefined && Number.isFinite(value) ? value : undefined,
    });
  }

  toggleZoneComponent(uid: string, checked: boolean): void {
    const current = this.attributeDraft()?.attribute.components ?? [];
    this.patchAttribute({
      components: checked ? [...current, uid] : current.filter((item) => item !== uid),
    });
  }

  /** `allowedTypes` is omitted when every kind (or none) is checked. */
  toggleMediaKind(kind: MediaKind, checked: boolean): void {
    const attribute = this.attributeDraft()?.attribute;
    if (!attribute) return;
    const allowed = MEDIA_KINDS.map((media) => media.kind).filter((item) =>
      item === kind ? checked : allowsMedia(attribute, item),
    );
    this.patchAttribute({
      allowedTypes: allowed.length && allowed.length < MEDIA_KINDS.length ? allowed : undefined,
    });
  }

  // Conditions

  isConditionField(name: string): boolean {
    return this.conditionFields().some((entry) => entry.name === name);
  }

  conditionAttribute(name: string): Attribute | undefined {
    return this.draft()?.attributes[name];
  }

  /** "Show this field when <first field> is <its first value>". */
  addCondition(): void {
    const first = this.conditionFields()[0];
    if (!first) return;
    this.patchAttribute({
      conditions: conditionsOf({
        field: first.name,
        operator: '==',
        value: this.initialValue(first.attribute),
      }),
    });
  }

  private initialValue(attribute: Attribute): SimpleCondition['value'] {
    if (attribute.type === 'boolean') return true;
    if (attribute.type === 'enumeration') return attribute.enum?.[0] ?? '';
    return '';
  }

  setCondition(changes: Partial<SimpleCondition>): void {
    const rule = this.simpleRule();
    if (!rule) return;
    const next = { ...rule, ...changes };
    // A new field starts from a value of its kind.
    if (changes.field !== undefined && changes.field !== rule.field) {
      const attribute = this.conditionAttribute(changes.field);
      if (attribute) next.value = this.initialValue(attribute);
    }
    this.patchAttribute({ conditions: conditionsOf(next) });
  }

  /** Typed text: numbers for numeric fields, text otherwise. */
  setConditionText(field: string, text: string): void {
    const type = this.conditionAttribute(field)?.type ?? 'string';
    const number = Number(text);
    const numeric = ['integer', 'float', 'decimal'].includes(type);
    this.setCondition({
      value: numeric && text.trim() !== '' && Number.isFinite(number) ? number : text,
    });
  }

  /** Writes the field into the draft (renames keep position), and plans its inverse side. */
  commitAttribute(): void {
    const field = this.attributeDraft();
    const file = this.draft();
    if (!field || !file) return;
    const attribute = { ...field.attribute };
    const entries = Object.entries(file.attributes);
    const index = field.originalName
      ? entries.findIndex(([name]) => name === field.originalName)
      : -1;
    if (
      attribute.type === 'relation' &&
      field.inverseName &&
      isBidirectional(attribute) &&
      attribute.target
    ) {
      attribute.inversedBy = field.inverseName;
      const targetName = attribute.target.replace(/^api::/, '');
      const selfName = this.isComponent() ? '' : String(file['singularName']);
      this.inverseAdditions.update((additions) => ({
        ...additions,
        [targetName]: {
          ...(additions[targetName] ?? {}),
          [field.inverseName]: {
            type: 'relation',
            relation: INVERSE[attribute.relation as RelationKind],
            target: `api::${selfName}`,
            mappedBy: field.name,
          },
        },
      }));
    }
    if (index >= 0) entries[index] = [field.name, attribute];
    else entries.push([field.name, attribute]);
    this.setFileValue('attributes', Object.fromEntries(entries));
    this.attributeDraft.set(null);
  }

  // The migration plan

  toggleHint(hint: string, checked: boolean): void {
    this.acceptedHints.update((hints) =>
      checked ? [...hints, hint] : hints.filter((item) => item !== hint),
    );
  }

  private change(remove = false): Change {
    const file = this.draft();
    const sources = this.sources();
    const change: Change = {
      contentTypes: {},
      components: {},
      renameTables: [],
      renameColumns: [],
    };
    for (const hint of this.acceptedHints()) {
      if (hint.startsWith('--rename-column '))
        change.renameColumns.push(hint.slice('--rename-column '.length));
      if (hint.startsWith('--rename-table '))
        change.renameTables.push(hint.slice('--rename-table '.length));
    }
    if (!file || !sources) return change;
    if (this.isComponent()) {
      change.components[this.componentUid()] = remove ? null : file;
    } else {
      change.contentTypes[String(file['singularName'])] = remove ? null : file;
    }
    for (const [target, attributes] of Object.entries(this.inverseAdditions())) {
      const existing = change.contentTypes[target] ?? sources.contentTypes[target];
      if (existing)
        change.contentTypes[target] = {
          ...existing,
          attributes: { ...existing.attributes, ...attributes },
        };
    }
    return change;
  }

  /** Plans the draft's migration (or the type's removal) for review. */
  async plan(remove = this.pendingRemoval): Promise<void> {
    this.pendingRemoval = remove;
    this.busy.set(true);
    try {
      this.planResult.set(await this.api.post<SchemaPlan>('/schema/plan', this.change(remove)));
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    } finally {
      this.busy.set(false);
    }
  }

  remove(): void {
    void this.plan(true);
  }

  closePlan(): void {
    this.planResult.set(null);
  }

  async apply(result: SchemaPlan): Promise<void> {
    this.busy.set(true);
    try {
      await this.api.post('/schema/apply', {
        ...this.change(this.pendingRemoval),
        allow: result.requires ?? 'safe',
      });
      toast.success(this.t('builder.toast.updated'));
      // Applied: the draft is what the schema now holds.
      this.baseline = this.snapshot();
      const removed = this.pendingRemoval;
      this.pendingRemoval = false;
      this.planResult.set(null);
      await Promise.all([this.schema.load(), this.reloadSources()]);
      const file = this.draft();
      if (removed) await this.router.navigate(['/builder']);
      else if (this.isComponent())
        await this.router.navigate(['/builder', `component:${this.componentUid()}`]);
      else if (file) await this.router.navigate(['/builder', String(file['singularName'])]);
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    } finally {
      this.busy.set(false);
    }
  }
}
