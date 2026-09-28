import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  Deployment,
  DeploymentPoller,
  DeploymentStatus,
  inProgress,
  statusLook,
  validHookUrl,
} from './deploy';

function deployment(status: DeploymentStatus, id = 1): Deployment {
  return {
    id,
    targetId: 7,
    status,
    httpStatus: 200,
    message: null,
    url: null,
    triggeredBy: 1,
    createdAt: null,
    updatedAt: null,
  };
}

/** Lets pending promise callbacks run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('deployment status', () => {
  it('is in progress while triggered or building', () => {
    expect(inProgress('triggered')).toBe(true);
    expect(inProgress('building')).toBe(true);
    for (const status of ['ready', 'error', 'failed'] as const)
      expect(inProgress(status)).toBe(false);
    expect(inProgress(null)).toBe(false);
  });

  it('looks destructive when it failed', () => {
    expect(statusLook('error').variant).toBe('destructive');
    expect(statusLook('failed').variant).toBe('destructive');
    expect(statusLook('ready').icon).toBe('lucideCircleCheck');
  });

  it('accepts http(s) hook URLs only', () => {
    expect(validHookUrl('https://api.netlify.com/build_hooks/abc')).toBe(true);
    expect(validHookUrl('ftp://example.com')).toBe(false);
    expect(validHookUrl('not a url')).toBe(false);
  });
});

describe('DeploymentPoller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('polls while the deployment is in progress, then stops', async () => {
    const answers = [deployment('building'), deployment('ready')];
    const fetch = vi.fn(async () => answers.shift() ?? null);
    const updates: (DeploymentStatus | undefined)[] = [];
    const poller = new DeploymentPoller(fetch, (_, d) => updates.push(d?.status), 1000);

    poller.watch(7, deployment('triggered'));
    expect(poller.watching(7)).toBe(true);
    expect(fetch).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(updates).toEqual(['building']);
    expect(poller.watching(7)).toBe(true);

    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(updates).toEqual(['building', 'ready']);
    expect(poller.watching(7)).toBe(false);

    await vi.advanceTimersByTimeAsync(5000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not watch settled deployments, and watching twice polls once', async () => {
    const fetch = vi.fn(async () => deployment('building'));
    const poller = new DeploymentPoller(fetch, () => undefined, 1000);
    poller.watch(1, deployment('ready'));
    poller.watch(2, null);
    expect(poller.watching(1)).toBe(false);
    expect(poller.watching(2)).toBe(false);

    poller.watch(3, deployment('building'));
    poller.watch(3, deployment('building'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetch).toHaveBeenCalledTimes(1);
    poller.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries after a failed poll and gives up after the limit', async () => {
    let now = 0;
    let fail = true;
    const fetch = vi.fn(async () => {
      if (fail) {
        fail = false;
        throw new Error('offline');
      }
      return deployment('building');
    });
    const update = vi.fn();
    const poller = new DeploymentPoller(fetch, update, 1000, 3000, () => now);
    poller.watch(7, deployment('triggered'));

    now = 1000;
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(update).not.toHaveBeenCalled();
    expect(poller.watching(7)).toBe(true);

    now = 2000;
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(update).toHaveBeenCalledTimes(1);
    expect(poller.watching(7)).toBe(true);

    now = 3000;
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(update).toHaveBeenCalledTimes(2);
    expect(poller.watching(7)).toBe(false);
  });

  it('stops following a target that is unwatched while a poll is in flight', async () => {
    let resolve: (value: Deployment) => void = () => undefined;
    const fetch = vi.fn(() => new Promise<Deployment>((done) => (resolve = done)));
    const update = vi.fn();
    const poller = new DeploymentPoller(fetch, update, 1000);
    poller.watch(7, deployment('building'));
    await vi.advanceTimersByTimeAsync(1000);
    poller.unwatch(7);
    resolve(deployment('building'));
    await settle();
    expect(update).not.toHaveBeenCalled();
    expect(poller.watching(7)).toBe(false);
  });
});
