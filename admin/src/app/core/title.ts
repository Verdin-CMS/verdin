import { DOCUMENT } from '@angular/common';
import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRouteSnapshot, RouterStateSnapshot, TitleStrategy } from '@angular/router';

import { BrandingService } from './branding';
import { I18n } from './i18n/i18n';
import { MessageKey } from './i18n/keys';
import { Schema } from './schema';

/**
 * How a route's title is built, from the most specific part to the least:
 * `[detail] · page · [content type] · …sections · brand`, e.g. "Articles · Content · Verdin"
 * or "Launch post · Articles · Content · Verdin". Set with `titled()`.
 */
export interface TitleSpec {
  /** The page's own name. */
  page?: MessageKey;
  /**
   * The page shows one record: its name, from `PageTitle.setDetail`, comes first; until
   * the page sets it (or when the `id` parameter is `new`) this generic label stands in.
   */
  detail?: MessageKey;
  /** The `uid` parameter's content type display name follows the page. */
  type?: boolean;
  /** The areas the page belongs to, innermost first (e.g. `['title.settings']`). */
  sections?: MessageKey[];
}

const TITLE_DATA = 'vdTitle';

/** The route properties that give a route its title (`{ path, ...titled({…}), … }`). */
export function titled(spec: TitleSpec): { title: string; data: Record<string, TitleSpec> } {
  // Angular's own `title` holds a plain label; the strategy reads the whole spec from `data`.
  return { title: spec.page ?? spec.detail ?? '', data: { [TITLE_DATA]: spec } };
}

/** The parts of a title, joined, with the empty ones left out. */
export function composeTitle(parts: readonly (string | null | undefined)[]): string {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => !!part)
    .join(' · ');
}

/** The title spec and parameters of the deepest activated route. */
interface CurrentRoute {
  spec: TitleSpec | null;
  params: Record<string, string>;
}

function deepest(snapshot: ActivatedRouteSnapshot): CurrentRoute {
  let route = snapshot;
  let spec: TitleSpec | null = (route.data[TITLE_DATA] as TitleSpec | undefined) ?? null;
  const params: Record<string, string> = { ...route.params };
  while (route.firstChild) {
    route = route.firstChild;
    spec = (route.data[TITLE_DATA] as TitleSpec | undefined) ?? spec;
    Object.assign(params, route.params);
  }
  return { spec, params };
}

/**
 * The name of the record a page shows, for the document title ("Launch post · Articles ·
 * Content · Verdin"). Pages set it once the record is loaded; every completed navigation
 * clears it (a cancelled one, say by the unsaved-changes question, keeps it).
 */
@Injectable({ providedIn: 'root' })
export class PageTitle {
  readonly detail = signal<string | null>(null);

  setDetail(name: string | null | undefined): void {
    this.detail.set(name?.trim() || null);
  }
}

/**
 * Titles every route in the interface language (and again when it changes), with the
 * content type's display name and the page's record where they apply, ending with the
 * branding's title (`[admin.branding] title`, else "Verdin").
 */
@Injectable({ providedIn: 'root' })
export class VerdinTitleStrategy extends TitleStrategy {
  private readonly document = inject(DOCUMENT);
  private readonly i18n = inject(I18n);
  private readonly schema = inject(Schema);
  private readonly branding = inject(BrandingService);
  private readonly pageTitle = inject(PageTitle);
  private readonly current = signal<CurrentRoute | null>(null);

  /** The document title of the current route. */
  readonly title = computed(() => {
    const brand = this.branding.title;
    const current = this.current();
    if (!current?.spec) return brand;
    const { spec, params } = current;
    const t = this.i18n.t;
    let detail: string | null = null;
    if (spec.detail) {
      detail =
        params['id'] === 'new' ? t('title.new') : (this.pageTitle.detail() ?? t(spec.detail));
    }
    const type = spec.type && params['uid'] ? this.typeName(params['uid']) : null;
    return composeTitle([
      detail,
      spec.page ? t(spec.page) : null,
      type,
      ...(spec.sections ?? []).map((key) => t(key)),
      brand,
    ]);
  });

  constructor() {
    super();
    effect(() => {
      this.document.title = this.title();
    });
  }

  override updateTitle(snapshot: RouterStateSnapshot): void {
    this.pageTitle.detail.set(null);
    this.current.set(deepest(snapshot.root));
    // The effect writes it too, but only once change detection runs: set it now, so the
    // title is right as soon as the navigation ends.
    this.document.title = this.title();
  }

  /** The type's display name once the schema is loaded, else its uid's last part. */
  private typeName(uid: string): string {
    return this.schema.type(uid)?.displayName ?? uid.split('.').pop() ?? uid;
  }
}
