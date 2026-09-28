import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { Api, ApiFailure, RUNTIME_CONFIG } from './api';
import { Auth, SessionResponse } from './auth';
import { AdminUser, ApiToken } from './types';

/** What creating an admin without a password (or a new invitation) answers. */
export interface Invitation {
  inviteUrl: string;
  /** Whether the link was emailed (an email provider is set up and sending worked). */
  emailed: boolean;
}

/** Who an invitation link is for (`GET /auth/invitation`). */
export interface InvitationInfo {
  email: string;
  firstname: string | null;
  lastname: string | null;
}

/** One signed-in device of the admin (`GET /auth/sessions`). */
export interface AdminSession {
  id: string;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  /** The session of this browser. */
  current: boolean;
}

/** Body of `PUT /users/me`. */
export interface ProfileUpdate {
  firstname?: string | null;
  lastname?: string | null;
  email?: string;
  password?: string;
  /** Needed to change the email or the password. */
  currentPassword?: string;
}

/** A browser and system read from a user agent, for the sessions list. */
export interface DeviceInfo {
  browser: string | null;
  os: string | null;
  mobile: boolean;
}

/** The server's password length rule. */
export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 128;

export type PasswordProblem = 'short' | 'long' | 'mismatch';

/** What is wrong with a new password and its confirmation (`null`: nothing). */
export function passwordProblem(password: string, confirmation: string): PasswordProblem | null {
  if ([...password].length < MIN_PASSWORD) return 'short';
  if (new TextEncoder().encode(password).length > MAX_PASSWORD) return 'long';
  return password === confirmation ? null : 'mismatch';
}

/**
 * Whether a failure of a one-time link route means the link is invalid or expired (a
 * 400 about something other than the password).
 */
export function isLinkError(failure: ApiFailure): boolean {
  return failure.status === 400 && !/password/i.test(failure.message);
}

const BROWSERS: [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\bOPR\/|\bOpera\//, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\bFirefox\/|\bFxiOS\//, 'Firefox'],
  [/\bCriOS\/|\bChrome\//, 'Chrome'],
  [/\bVersion\/[\d.]+.*\bSafari\//, 'Safari'],
  [/\bcurl\//, 'curl'],
  [/\bHeadlessChrome\//, 'Chrome'],
];

const SYSTEMS: [RegExp, string][] = [
  [/\biPhone\b|\biPad\b|\biPod\b/, 'iOS'],
  [/\bAndroid\b/, 'Android'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bWindows\b/, 'Windows'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bLinux\b/, 'Linux'],
];

/** The browser and system of a user agent (`null` parts when unknown). */
export function describeUserAgent(userAgent: string | null | undefined): DeviceInfo {
  const agent = userAgent ?? '';
  const browser = BROWSERS.find(([pattern]) => pattern.test(agent))?.[1] ?? null;
  const os = SYSTEMS.find(([pattern]) => pattern.test(agent))?.[1] ?? null;
  return { browser, os, mobile: /\bMobile\b|\biPhone\b|\bAndroid\b.*\bMobile\b/.test(agent) };
}

/** Sessions sorted for display: this device first, then the most recently used. */
export function sortSessions(sessions: readonly AdminSession[]): AdminSession[] {
  return [...sessions].sort(
    (a, b) => Number(b.current) - Number(a.current) || b.lastUsedAt.localeCompare(a.lastUsedAt),
  );
}

/**
 * An invitation link opened on this server: the server builds it from its public URL,
 * which may differ from the address the admin panel is reached at (e.g. behind a proxy).
 */
export function localLink(url: string, origin: string): string {
  try {
    const link = new URL(url);
    const local = new URL(origin);
    return `${local.origin}${link.pathname}${link.search}${link.hash}`;
  } catch {
    return url;
  }
}

/** Admins' accounts: invitations, password resets, the profile and its sessions. */
@Injectable({ providedIn: 'root' })
export class Account {
  private readonly api = inject(Api);
  private readonly http = inject(HttpClient);
  private readonly auth = inject(Auth);
  private readonly config = inject(RUNTIME_CONFIG);

  private url(path: string): string {
    return `${this.config.apiBase}${path}`;
  }

  /** Creates an admin; without a password, an invitation link comes back too. */
  async createUser(
    body: Record<string, unknown>,
  ): Promise<{ user: AdminUser; invitation: Invitation | null }> {
    const response = await this.api.postWithMeta<AdminUser, Partial<Invitation> | undefined>(
      '/users',
      body,
    );
    const meta = response.meta;
    return {
      user: response.data,
      invitation: meta?.inviteUrl ? { inviteUrl: meta.inviteUrl, emailed: !!meta.emailed } : null,
    };
  }

  /** A new invitation link for an admin (earlier links stop working). */
  reinvite(id: number): Promise<Invitation> {
    return this.api.post<Invitation>(`/users/${id}/invite`);
  }

  async invitation(token: string): Promise<InvitationInfo> {
    try {
      const response = await firstValueFrom(
        this.http.get<{ data: InvitationInfo }>(this.url('/auth/invitation'), {
          params: { token },
        }),
      );
      return response.data;
    } catch (error) {
      throw ApiFailure.from(error);
    }
  }

  /** Always succeeds for well-formed emails, whether an account exists or not. */
  async forgotPassword(email: string): Promise<void> {
    try {
      await firstValueFrom(this.http.post(this.url('/auth/forgot-password'), { email }));
    } catch (error) {
      throw ApiFailure.from(error);
    }
  }

  async resetPassword(token: string, password: string): Promise<void> {
    try {
      await firstValueFrom(this.http.post(this.url('/auth/reset-password'), { token, password }));
    } catch (error) {
      throw ApiFailure.from(error);
    }
  }

  profile(): Promise<AdminUser> {
    return this.api.get<AdminUser>('/users/me');
  }

  /**
   * Saves the profile. A new password ends every session: the answer is a new one, which
   * signs this browser in again.
   */
  async updateProfile(update: ProfileUpdate): Promise<void> {
    if (update.password) {
      await this.auth.adopt(
        this.http.put<SessionResponse>(this.url('/users/me'), update, { withCredentials: true }),
      );
      return;
    }
    const user = await this.api.put<AdminUser>('/users/me', update);
    this.auth.user.set(user);
  }

  sessions(): Promise<AdminSession[]> {
    return this.api.get<AdminSession[]>('/auth/sessions');
  }

  revokeSession(id: string): Promise<void> {
    return this.api.delete(`/auth/sessions/${encodeURIComponent(id)}`);
  }

  /** A new secret for an API token (the old one stops working); `accessKey` is set once. */
  regenerateToken(id: number): Promise<ApiToken> {
    return this.api.post<ApiToken>(`/api-tokens/${id}/regenerate`);
  }
}
