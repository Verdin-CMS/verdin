import { Resource, Signal, computed } from '@angular/core';

import { ApiFailure } from './api';

/**
 * The message of a resource's failed load, for `vd-load-error` (`null` while it loads or
 * once it has a value). Loaders throw `ApiFailure`s, so the server's message shows.
 */
export function loadErrorOf(resource: Resource<unknown>): Signal<string | null> {
  return computed(() => {
    const error = resource.error();
    return error ? ApiFailure.from(error).message : null;
  });
}
