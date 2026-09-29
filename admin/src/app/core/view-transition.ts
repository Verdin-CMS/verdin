import { ActivatedRouteSnapshot, ViewTransitionInfo } from '@angular/router';

/** The path a route snapshot tree stands for (its primary segments). */
export function snapshotPath(root: ActivatedRouteSnapshot): string {
  const parts: string[] = [];
  for (let route: ActivatedRouteSnapshot | null = root; route; route = route.firstChild) {
    parts.push(...route.url.map((segment) => segment.path));
  }
  return parts.join('/');
}

function prefersReducedMotion(): boolean {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/**
 * The router's view transitions cross-fade only real page changes: not a query change
 * (a list's filters, its page) and never under `prefers-reduced-motion`.
 */
export function onViewTransitionCreated({ transition, from, to }: ViewTransitionInfo): void {
  if (prefersReducedMotion() || snapshotPath(from) === snapshotPath(to)) {
    transition.skipTransition();
  }
}
