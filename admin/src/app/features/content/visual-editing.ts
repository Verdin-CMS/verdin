/**
 * Visual editing: the site's overlay (`/admin/api/visual-editing.js`) asks the admin to open
 * a field, either with a `verdin:edit` message from the preview frame or with a link
 * `<admin>/content/<uid>/<documentId>?locale=<locale>&field=<path>`.
 */
import { isLocaleCode } from '../../core/content-locales';
import { Attribute, Attributes } from '../../core/types';
import { ComponentLookup, FormModel } from './fields/model';

/** Where to edit: an entry, its locale and (optionally) a field path like `seo.metaTitle`. */
export interface EditTarget {
  uid: string;
  documentId: string;
  locale: string | null;
  field: string | null;
}

/** A dotted field path: attribute names and list indexes (`sections.2.title`). */
const FIELD_PATH = /^[A-Za-z_][\w-]*(\.(\d+|[A-Za-z_][\w-]*))*$/;
const UID = /^[\w.:-]+$/;
const DOCUMENT_ID = /^[\w-]+$/;
/** Paths under `/content/<uid>/` that are pages, not documents. */
const RESERVED = new Set(['new', 'configure-view']);

/** A field path from the overlay, or `null` when it does not look like one. */
export function validFieldPath(path: string | null | undefined): string | null {
  return path && path.length <= 512 && FIELD_PATH.test(path) ? path : null;
}

/**
 * The entry an overlay link points to, when it belongs to this admin (`adminBase`: the
 * absolute URL of the admin's root, `document.baseURI`); `null` otherwise.
 */
export function parseEditHref(href: unknown, adminBase: string): EditTarget | null {
  if (typeof href !== 'string' || href.length > 2048) return null;
  let url: URL;
  let base: URL;
  try {
    url = new URL(href);
    base = new URL(adminBase);
  } catch {
    return null;
  }
  if (url.origin !== base.origin) return null;
  const root = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`;
  if (!url.pathname.startsWith(root)) return null;
  const segments = url.pathname.slice(root.length).split('/');
  if (segments.length !== 3 || segments[0] !== 'content') return null;
  let uid: string;
  let documentId: string;
  try {
    uid = decodeURIComponent(segments[1]);
    documentId = decodeURIComponent(segments[2]);
  } catch {
    return null;
  }
  if (!UID.test(uid) || !DOCUMENT_ID.test(documentId) || RESERVED.has(documentId)) return null;
  const locale = url.searchParams.get('locale');
  return {
    uid,
    documentId,
    locale: locale && isLocaleCode(locale) ? locale : null,
    field: validFieldPath(url.searchParams.get('field')),
  };
}

/**
 * The target of a `verdin:edit` message, when it comes from the preview site (its origin
 * is the preview URL's) and points into this admin; `null` for any other message.
 */
export function editMessage(
  event: { origin: string; data: unknown },
  previewUrl: string | null,
  adminBase: string,
): EditTarget | null {
  if (!previewUrl) return null;
  let site: string;
  try {
    site = new URL(previewUrl).origin;
  } catch {
    return null;
  }
  if (site === 'null' || event.origin !== site) return null;
  const data = event.data;
  if (typeof data !== 'object' || data === null) return null;
  const message = data as { type?: unknown; href?: unknown };
  if (message.type !== 'verdin:edit') return null;
  return parseEditHref(message.href, adminBase);
}

/**
 * The part of `path` that exists in the form: attribute names, then (in components and
 * dynamic zones) indexes and the attributes of their items. A path into a text of a
 * blocks field stops at the field; a missing item or attribute stops at its parent.
 */
export function resolveFieldPath(
  attributes: Attributes,
  model: FormModel,
  path: string,
  components: ComponentLookup,
): string[] {
  const parts = path.split('.');
  const found: string[] = [];
  let scope: Attributes | null = attributes;
  let value: unknown = model;
  for (let index = 0; index < parts.length && scope; index++) {
    const name = parts[index];
    const attribute: Attribute | undefined = Object.prototype.hasOwnProperty.call(scope, name)
      ? scope[name]
      : undefined;
    if (!attribute) break;
    found.push(name);
    const current = (value as FormModel | null)?.[name];
    scope = null;
    if (attribute.type === 'component' && !attribute.repeatable) {
      if (current && typeof current === 'object') {
        scope = components(attribute.component ?? '')?.attributes ?? null;
        value = current;
      }
    } else if (attribute.type === 'component' || attribute.type === 'dynamiczone') {
      const position = parts[index + 1];
      const list = Array.isArray(current) ? (current as FormModel[]) : [];
      if (position === undefined || !/^\d+$/.test(position) || Number(position) >= list.length)
        break;
      const item = list[Number(position)];
      found.push(position);
      index++;
      const uid: string | undefined =
        attribute.type === 'dynamiczone' ? String(item['__component']) : attribute.component;
      scope = components(uid ?? '')?.attributes ?? null;
      value = item;
    }
  }
  return found;
}

/**
 * Element ids to try for a resolved path, most precise first: `vd-fields` gives each
 * control the id `<prefix>-<name>` (`doc-seo-metaTitle`, `doc-sections-2-title`) and each
 * component or dynamic zone a heading `<id>-label`.
 */
export function fieldIds(prefix: string, segments: readonly string[]): string[] {
  const ids: string[] = [];
  for (let length = segments.length; length > 0; length--) {
    ids.push([prefix, ...segments.slice(0, length)].join('-'));
  }
  return ids;
}

const FOCUSABLE =
  'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), [contenteditable="true"], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The element for a path in the current page, or `null` while it is not rendered. */
export function findFieldElement(
  root: Document,
  prefix: string,
  segments: readonly string[],
): HTMLElement | null {
  for (const id of fieldIds(prefix, segments)) {
    const exact = root.getElementById(id);
    if (exact) return exact;
    // A component or dynamic zone: its group.
    const heading = root.getElementById(`${id}-label`);
    if (heading) return heading.closest<HTMLElement>('[role="group"]') ?? heading;
    // A list item: its first field.
    const inner = [...root.querySelectorAll<HTMLElement>('[id]')].find((element) =>
      element.id.startsWith(`${id}-`),
    );
    if (inner) return inner;
  }
  return null;
}

/**
 * Scrolls to a field, focuses it (or its first control) and highlights it briefly.
 * Returns whether something was focused.
 */
export function revealField(element: HTMLElement): boolean {
  const reduce = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const cell = element.closest<HTMLElement>('[data-field]') ?? element;
  const highlighted = element.getAttribute('role') === 'group' ? element : cell;
  highlighted.scrollIntoView?.({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  const focusable = element.matches(FOCUSABLE)
    ? element
    : element.querySelector<HTMLElement>(FOCUSABLE);
  let focused = false;
  if (focusable) {
    focusable.focus({ preventScroll: true });
    focused = true;
  } else {
    element.setAttribute('tabindex', '-1');
    element.focus({ preventScroll: true });
    focused = document.activeElement === element;
  }
  flash(highlighted);
  return focused;
}

/** Highlights an element for a moment (`[data-flash]` in styles.css). */
export function flash(element: HTMLElement): void {
  element.removeAttribute('data-flash');
  // Restart the animation when the same element flashes again.
  void element.offsetWidth;
  element.setAttribute('data-flash', '');
  setTimeout(() => element.removeAttribute('data-flash'), 2400);
}
