import { describe, expect, it } from 'vitest';

import { ApiFailure } from '../../core/api';
import { failureReason, runLimited, summarize } from './list-bulk';

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('runLimited', () => {
  it('never runs more than the limit at once and reports progress', async () => {
    let running = 0;
    let peak = 0;
    const progress: number[] = [];
    const outcomes = await runLimited(
      [5, 1, 4, 2, 3, 1, 2],
      3,
      async (ms) => {
        running++;
        peak = Math.max(peak, running);
        await tick(ms);
        running--;
      },
      (done, total) => {
        expect(total).toBe(7);
        progress.push(done);
      },
    );
    expect(peak).toBe(3);
    expect(progress).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
  });

  it('keeps going after failures and reports outcomes in input order', async () => {
    const outcomes = await runLimited([1, 2, 3, 4], 2, async (n) => {
      await tick(5 - n);
      if (n % 2 === 0) throw new Error(`bad ${n}`);
    });
    expect(outcomes.map((outcome) => [outcome.item, outcome.ok])).toEqual([
      [1, true],
      [2, false],
      [3, true],
      [4, false],
    ]);
    const failed = outcomes[1];
    expect(!failed.ok && (failed.error as Error).message).toBe('bad 2');
  });

  it('handles no items and a limit above the item count', async () => {
    expect(await runLimited([], 4, async () => undefined)).toEqual([]);
    const outcomes = await runLimited(['a'], 10, async () => undefined);
    expect(outcomes).toEqual([{ item: 'a', ok: true }]);
  });
});

describe('summarize', () => {
  it('counts outcomes and lists the first few failures', () => {
    const outcomes = [
      { item: 'A', ok: true as const },
      { item: 'B', ok: false as const, error: new Error('no') },
      { item: 'C', ok: false as const, error: new Error('nope') },
      { item: 'D', ok: false as const, error: new Error('never') },
    ];
    const summary = summarize(
      outcomes,
      (item) => item,
      (error) => (error as Error).message,
      2,
    );
    expect(summary).toEqual({ succeeded: 1, failed: 3, details: ['B: no', 'C: nope'], more: 1 });
  });
});

describe('failureReason', () => {
  it('prefers the first validation issue', () => {
    const failure = new ApiFailure(400, 'ValidationError', '2 errors occurred', [
      { path: ['title'], message: 'title is required' },
      { path: ['slug'], message: 'slug is required' },
    ]);
    expect(failureReason(failure)).toBe('title: title is required');
    expect(failureReason(new ApiFailure(403, 'ForbiddenError', 'Forbidden'))).toBe('Forbidden');
    expect(failureReason(new Error('boom'))).toBe('boom');
  });
});
