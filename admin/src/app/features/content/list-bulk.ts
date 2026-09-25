import { ApiFailure } from '../../core/api';

/** Bulk actions the content list runs on its selected entries. */
export type BulkAction = 'publish' | 'unpublish' | 'delete';

export type Outcome<T> = { item: T; ok: true } | { item: T; ok: false; error: unknown };

/** Requests a bulk action keeps in flight at once. */
export const BULK_CONCURRENCY = 4;

/**
 * Runs `task` for every item with at most `limit` running at a time. Never rejects: each
 * item's outcome is reported in input order. `onProgress` is called after each one settles.
 */
export async function runLimited<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<unknown>,
  onProgress?: (done: number, total: number) => void,
): Promise<Outcome<T>[]> {
  const outcomes: Outcome<T>[] = new Array(items.length);
  let next = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      const item = items[index];
      try {
        await task(item);
        outcomes[index] = { item, ok: true };
      } catch (error) {
        outcomes[index] = { item, ok: false, error };
      }
      onProgress?.(++done, items.length);
    }
  };
  const workers = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return outcomes;
}

export interface BulkSummary {
  succeeded: number;
  failed: number;
  /** Up to `max` failures as `label: reason` lines. */
  details: string[];
  /** Failures beyond `details`. */
  more: number;
}

/** Counts outcomes and describes the first few failures. */
export function summarize<T>(
  outcomes: readonly Outcome<T>[],
  label: (item: T) => string,
  reason: (error: unknown) => string,
  max = 3,
): BulkSummary {
  const failures = outcomes.filter((outcome) => !outcome.ok);
  return {
    succeeded: outcomes.length - failures.length,
    failed: failures.length,
    details: failures
      .slice(0, max)
      .map((failure) => `${label(failure.item)}: ${reason((failure as { error: unknown }).error)}`),
    more: Math.max(0, failures.length - max),
  };
}

/** A short reason for a failed request: the first validation issue when there is one. */
export function failureReason(error: unknown): string {
  const failure = ApiFailure.from(error);
  const issue = failure.issues[0];
  if (!issue) return failure.message;
  const path = issue.path.join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}
