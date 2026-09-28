import { Injectable, inject } from '@angular/core';

import { Api, ApiFailure } from './api';
import { AttestationJson, CreationOptionsJson } from './webauthn';

/** A second factor an account signs in with. */
export type TwoFactorMethod = 'totp' | 'passkey' | 'recovery';

/** What `POST /auth/login` answers instead of a session when the account has a factor. */
export interface SecondStep {
  twoFactorToken: string;
  methods: TwoFactorMethod[];
}

export interface Passkey {
  id: number;
  name: string;
  createdAt: string | null;
  lastUsedAt: string | null;
}

/** `GET /auth/two-factor`. */
export interface TwoFactorStatus {
  totp: boolean;
  passkeys: Passkey[];
  recoveryCodesLeft: number;
  /** One of the admin's roles requires a second factor. */
  required: boolean;
}

/** A TOTP secret being set up, shown once. */
export interface TotpSetup {
  /** Base32, for manual entry. */
  secret: string;
  otpauthUrl: string;
}

/** The error of admin routes while the admin's role waits for a second factor. */
export const TWO_FACTOR_REQUIRED = 'TwoFactorRequiredError';

/** Whether an HTTP error body (`{ error: { name } }`) is `TwoFactorRequiredError`. */
export function isTwoFactorRequired(status: number, body: unknown): boolean {
  if (status !== 403 || !body || typeof body !== 'object') return false;
  const error = (body as { error?: { name?: unknown } }).error;
  return !!error && typeof error === 'object' && error.name === TWO_FACTOR_REQUIRED;
}

/** Reads the login answer: the second step, or `null` for a session. */
export function secondStepOf(data: unknown): SecondStep | null {
  if (!data || typeof data !== 'object') return null;
  const value = data as {
    twoFactorRequired?: unknown;
    twoFactorToken?: unknown;
    methods?: unknown;
  };
  if (value.twoFactorRequired !== true || typeof value.twoFactorToken !== 'string') return null;
  const methods = Array.isArray(value.methods)
    ? value.methods.filter((method): method is TwoFactorMethod =>
        ['totp', 'passkey', 'recovery'].includes(method),
      )
    : [];
  return { twoFactorToken: value.twoFactorToken, methods };
}

/** How the second step starts: the authenticator app, else a passkey, else a recovery code. */
export function firstMethod(
  methods: readonly TwoFactorMethod[],
  passkeys: boolean,
): TwoFactorMethod {
  if (methods.includes('totp')) return 'totp';
  if (methods.includes('passkey') && passkeys) return 'passkey';
  if (methods.includes('recovery')) return 'recovery';
  return methods.includes('passkey') ? 'passkey' : 'totp';
}

/** The digits of what was typed in a code field, at most six. */
export function totpDigits(value: string): string {
  return value.replace(/\D/g, '').slice(0, 6);
}

/** Why a second step failed. */
export type SecondStepProblem = 'expired' | 'invalid' | 'tooMany' | 'other';

export function secondStepProblem(failure: ApiFailure): SecondStepProblem {
  if (failure.status === 401) return 'expired';
  if (failure.status === 429) return 'tooMany';
  if (failure.status === 400 && /invalid credentials/i.test(failure.message)) return 'invalid';
  return 'other';
}

/** Recovery codes as a text file, one per line. */
export function recoveryCodesFile(codes: readonly string[], account: string): string {
  return [`Verdin recovery codes — ${account}`, '', ...codes, ''].join('\n');
}

/** Whether turning TOTP off would leave an admin whose role requires a factor without any. */
export function totpIsLastFactor(status: TwoFactorStatus): boolean {
  return status.required && status.totp && status.passkeys.length === 0;
}

export function passkeyIsLastFactor(status: TwoFactorStatus): boolean {
  return status.required && !status.totp && status.passkeys.length === 1;
}

/** The signed-in admin's second factors (`/auth/two-factor…`) and resetting another's. */
@Injectable({ providedIn: 'root' })
export class TwoFactor {
  private readonly api = inject(Api);

  status(): Promise<TwoFactorStatus> {
    return this.api.get<TwoFactorStatus>('/auth/two-factor');
  }

  totpSetup(password: string): Promise<TotpSetup> {
    return this.api.post<TotpSetup>('/auth/two-factor/totp/setup', { password });
  }

  async totpEnable(code: string): Promise<string[]> {
    const { recoveryCodes } = await this.api.post<{ recoveryCodes: string[] }>(
      '/auth/two-factor/totp/enable',
      { code },
    );
    return recoveryCodes;
  }

  async totpDisable(password: string): Promise<void> {
    await this.api.post('/auth/two-factor/totp/disable', { password });
  }

  async regenerateRecoveryCodes(password: string): Promise<string[]> {
    const { recoveryCodes } = await this.api.post<{ recoveryCodes: string[] }>(
      '/auth/two-factor/recovery-codes',
      { password },
    );
    return recoveryCodes;
  }

  passkeyOptions(
    password: string,
  ): Promise<{ challengeToken: string; publicKey: CreationOptionsJson }> {
    return this.api.post('/auth/two-factor/passkeys/options', { password });
  }

  addPasskey(input: {
    challengeToken: string;
    name: string;
    credential: AttestationJson;
  }): Promise<{ passkey: Passkey; recoveryCodes: string[] | null }> {
    return this.api.post('/auth/two-factor/passkeys', input);
  }

  async removePasskey(id: number, password: string): Promise<void> {
    await this.api.request<void>('DELETE', `/auth/two-factor/passkeys/${id}`, { password });
  }

  /** Removes every factor of another admin (`users.manage`). */
  reset(userId: number): Promise<void> {
    return this.api.delete(`/users/${userId}/two-factor`);
  }
}
