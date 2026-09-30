import { Injectable, inject } from '@angular/core';

import { Api, ListResponse } from './api';
import { PAGE_SIZE } from './paging';

/**
 * `triggered` (the hook accepted the call), `failed` (it refused), then what the provider
 * reports to the callback URL: `building`, `ready` or `error`.
 */
export type DeploymentStatus = 'triggered' | 'failed' | 'building' | 'ready' | 'error';

export interface Deployment {
  id: number;
  targetId: number;
  status: DeploymentStatus;
  httpStatus: number | null;
  message: string | null;
  /** The deployed site, when the provider sends it. */
  url: string | null;
  triggeredBy: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/** A build hook. Its URL is a secret: only the host is shown. */
export interface DeployTarget {
  id: number;
  name: string;
  host: string;
  /** Where providers report states (full URL); deploy managers only. */
  callbackPath?: string;
  lastDeployment: Deployment | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export type CdnProvider = 'none' | 'cloudflare' | 'fastly' | 'webhook';

export interface CdnPurge {
  at: string;
  tags: string[];
  ok: boolean;
  message: string | null;
}

export interface CdnStatus {
  provider: CdnProvider;
  recent: CdnPurge[];
}

/** Deploy targets, deployments and CDN purges (`/deploy`). */
@Injectable({ providedIn: 'root' })
export class Deploys {
  private readonly api = inject(Api);

  /** Every target, oldest first. */
  targets(): Promise<DeployTarget[]> {
    return this.api.listAll<DeployTarget>('/deploy/targets');
  }

  create(name: string, url: string): Promise<DeployTarget> {
    return this.api.post<DeployTarget>('/deploy/targets', { name, url });
  }

  /** Renames a target, and points it at another hook when `url` is given. */
  update(id: number, name: string, url?: string): Promise<DeployTarget> {
    return this.api.put<DeployTarget>(`/deploy/targets/${id}`, url ? { name, url } : { name });
  }

  remove(id: number): Promise<void> {
    return this.api.delete(`/deploy/targets/${id}`);
  }

  /** Calls the hook; 429 when the target deployed less than 10 seconds ago. */
  trigger(id: number): Promise<Deployment> {
    return this.api.post<Deployment>(`/deploy/targets/${id}/trigger`);
  }

  /** A page of deployments, newest first, of one target or all. */
  deployments(
    targetId: number | undefined,
    page: number,
    pageSize = PAGE_SIZE,
  ): Promise<ListResponse<Deployment>> {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (targetId !== undefined) params.set('targetId', String(targetId));
    return this.api.list<Deployment>('/deploy/deployments', params.toString());
  }

  /** The latest deployment of a target (`null` when it never deployed). */
  async latest(targetId: number): Promise<Deployment | null> {
    return (await this.deployments(targetId, 1, 1)).data[0] ?? null;
  }

  cdn(): Promise<CdnStatus> {
    return this.api.get<CdnStatus>('/deploy/cdn');
  }

  /** Purges everything Verdin served through the CDN; answers the purge (if any). */
  purgeAll(): Promise<CdnPurge | null> {
    return this.api.post<CdnPurge | null>('/deploy/cdn/purge');
  }
}

/** Whether a deployment may still change (the provider has not reported an outcome). */
export function inProgress(status: DeploymentStatus | null | undefined): boolean {
  return status === 'triggered' || status === 'building';
}

/** How a status is shown: a badge variant and an icon. */
export function statusLook(status: DeploymentStatus): {
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
  icon: string;
} {
  switch (status) {
    case 'ready':
      return { variant: 'default', icon: 'lucideCircleCheck' };
    case 'failed':
    case 'error':
      return { variant: 'destructive', icon: 'lucideCircleX' };
    case 'building':
      return { variant: 'secondary', icon: 'lucideLoaderCircle' };
    default:
      return { variant: 'outline', icon: 'lucideCircleDashed' };
  }
}

/** Poll interval while a deployment is in progress. */
export const POLL_INTERVAL = 4000;
/** Polling stops after this long, whatever the provider reports (it may never call back). */
export const POLL_LIMIT = 30 * 60 * 1000;

/**
 * Follows the latest deployment of targets while they are `triggered` or `building`:
 * `fetch` is called every `interval` ms per watched target until the status settles (or
 * after `limit` ms), and `update` receives every answer.
 */
export class DeploymentPoller {
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly started = new Map<number, number>();

  constructor(
    private readonly fetch: (targetId: number) => Promise<Deployment | null>,
    private readonly update: (targetId: number, deployment: Deployment | null) => void,
    private readonly interval = POLL_INTERVAL,
    private readonly limit = POLL_LIMIT,
    private readonly now: () => number = Date.now,
  ) {}

  /** Starts (or keeps) following `targetId` when `deployment` is in progress. */
  watch(targetId: number, deployment: Deployment | null): void {
    if (!inProgress(deployment?.status)) {
      this.unwatch(targetId);
      return;
    }
    if (this.timers.has(targetId)) return;
    if (!this.started.has(targetId)) this.started.set(targetId, this.now());
    this.schedule(targetId);
  }

  watching(targetId: number): boolean {
    return this.timers.has(targetId);
  }

  unwatch(targetId: number): void {
    const timer = this.timers.get(targetId);
    if (timer !== undefined) clearTimeout(timer);
    this.timers.delete(targetId);
    this.started.delete(targetId);
  }

  stop(): void {
    for (const id of [...this.timers.keys()]) this.unwatch(id);
  }

  private schedule(targetId: number): void {
    const timer = setTimeout(() => void this.tick(targetId), this.interval);
    this.timers.set(targetId, timer);
  }

  private async tick(targetId: number): Promise<void> {
    if (!this.timers.has(targetId)) return;
    let deployment: Deployment | null;
    try {
      deployment = await this.fetch(targetId);
    } catch {
      // A failed poll is retried at the next tick.
      if (this.timers.has(targetId)) this.schedule(targetId);
      return;
    }
    if (!this.timers.has(targetId)) return;
    this.update(targetId, deployment);
    const expired = this.now() - (this.started.get(targetId) ?? this.now()) >= this.limit;
    if (inProgress(deployment?.status) && !expired) this.schedule(targetId);
    else this.unwatch(targetId);
  }
}

/** Where to paste the callback URL, per provider. */
export const CALLBACK_PROVIDERS = ['netlify', 'vercel', 'generic'] as const;
export type CallbackProvider = (typeof CALLBACK_PROVIDERS)[number];

/** The body a generic CI sends to the callback URL. */
export function genericCallback(url: string): string {
  return `curl -X POST '${url}' \\\n  -H 'content-type: application/json' \\\n  -d '{ "status": "ready", "url": "https://example.com" }'`;
}

/** Whether `url` can be a build hook (http(s), with a host). */
export function validHookUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && !!parsed.hostname;
  } catch {
    return false;
  }
}
