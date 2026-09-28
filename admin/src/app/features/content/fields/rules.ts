import { SchemaPath, disabled, hidden, validate } from '@angular/forms/signals';

import { I18n } from '../../../core/i18n/i18n';
import { visible } from '../../../core/logic';
import { Attributes } from '../../../core/types';
import { FormModel } from './model';

type Translate = I18n['t'];

/** How the edit view and conditions shape the form (top level). */
export interface RuleOptions {
  /** The form's current values, for `conditions.visible`. */
  scope?: () => FormModel;
  /** Fields the edit view shows read-only. */
  readOnly?: (name: string) => boolean;
}

/**
 * Client-side checks mirroring the schema. `required` is left to the server: drafts may be
 * incomplete. Fields hidden by their condition are not checked (the server skips them too),
 * and read-only fields are disabled.
 */
export function applyRules(
  path: SchemaPath<FormModel>,
  attributes: Attributes,
  t: Translate,
  options: RuleOptions = {},
): void {
  for (const [name, attribute] of Object.entries(attributes)) {
    const field = (path as unknown as Record<string, SchemaPath<unknown>>)[name];
    const { scope, readOnly } = options;
    if (attribute.conditions && scope) hidden(field, () => !visible(attribute.conditions, scope()));
    if (readOnly) disabled(field, () => readOnly(name));
    validate(field, ({ value }) => {
      const current = value();
      if (current === null || current === undefined || current === '') return undefined;
      if (typeof current === 'string') {
        const length = [...current].length;
        if (attribute.maxLength !== undefined && length > attribute.maxLength) {
          return {
            kind: 'maxLength',
            message: t('content.validation.maxLength', { count: attribute.maxLength }),
          };
        }
        if (attribute.minLength !== undefined && length < attribute.minLength) {
          return {
            kind: 'minLength',
            message: t('content.validation.minLength', { count: attribute.minLength }),
          };
        }
        if (attribute.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(current)) {
          return { kind: 'email', message: t('content.validation.email') };
        }
        if (attribute.regex && !new RegExp(attribute.regex).test(current)) {
          return {
            kind: 'pattern',
            message: t('content.validation.pattern', { pattern: attribute.regex }),
          };
        }
      }
      if (typeof current === 'number') {
        if (attribute.min !== undefined && current < attribute.min) {
          return { kind: 'min', message: t('content.validation.min', { min: attribute.min }) };
        }
        if (attribute.max !== undefined && current > attribute.max) {
          return { kind: 'max', message: t('content.validation.max', { max: attribute.max }) };
        }
      }
      return undefined;
    });
  }
}
