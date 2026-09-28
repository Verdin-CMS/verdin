import { describe, expect, it } from 'vitest';

import { ApiFailure } from './api';
import {
  TwoFactorStatus,
  firstMethod,
  isTwoFactorRequired,
  passkeyIsLastFactor,
  recoveryCodesFile,
  secondStepOf,
  secondStepProblem,
  totpDigits,
  totpIsLastFactor,
} from './two-factor';

const status = (changes: Partial<TwoFactorStatus>): TwoFactorStatus => ({
  totp: false,
  passkeys: [],
  recoveryCodesLeft: 10,
  required: false,
  ...changes,
});
const passkey = { id: 1, name: 'Key', createdAt: null, lastUsedAt: null };

describe('two-factor helpers', () => {
  it('reads the second step of a login answer', () => {
    expect(
      secondStepOf({
        twoFactorRequired: true,
        twoFactorToken: 'tok',
        methods: ['totp', 'recovery'],
      }),
    ).toEqual({ twoFactorToken: 'tok', methods: ['totp', 'recovery'] });
    expect(
      secondStepOf({ twoFactorRequired: true, twoFactorToken: 'tok', methods: ['sms', 'passkey'] }),
    ).toEqual({ twoFactorToken: 'tok', methods: ['passkey'] });
    expect(secondStepOf({ user: {}, accessToken: 'a' })).toBeNull();
    expect(secondStepOf({ twoFactorRequired: true })).toBeNull();
    expect(secondStepOf(null)).toBeNull();
  });

  it('starts with the app, then a passkey, then a recovery code', () => {
    expect(firstMethod(['totp', 'passkey', 'recovery'], true)).toBe('totp');
    expect(firstMethod(['passkey', 'recovery'], true)).toBe('passkey');
    expect(firstMethod(['passkey', 'recovery'], false)).toBe('recovery');
    expect(firstMethod(['passkey'], false)).toBe('passkey');
    expect(firstMethod(['recovery'], true)).toBe('recovery');
  });

  it('keeps at most six digits of a typed code', () => {
    expect(totpDigits('123 456')).toBe('123456');
    expect(totpDigits('12a3-4')).toBe('1234');
    expect(totpDigits('12345678')).toBe('123456');
    expect(totpDigits('')).toBe('');
  });

  it('classifies second step failures', () => {
    expect(secondStepProblem(new ApiFailure(401, 'UnauthorizedError', 'Unauthorized'))).toBe(
      'expired',
    );
    expect(secondStepProblem(new ApiFailure(400, 'ValidationError', 'Invalid credentials'))).toBe(
      'invalid',
    );
    expect(secondStepProblem(new ApiFailure(429, 'RateLimitError', 'Too many'))).toBe('tooMany');
    expect(secondStepProblem(new ApiFailure(400, 'ValidationError', 'something else'))).toBe(
      'other',
    );
  });

  it('recognizes TwoFactorRequiredError bodies', () => {
    const body = { error: { status: 403, name: 'TwoFactorRequiredError', message: '…' } };
    expect(isTwoFactorRequired(403, body)).toBe(true);
    expect(isTwoFactorRequired(401, body)).toBe(false);
    expect(isTwoFactorRequired(403, { error: { name: 'ForbiddenError' } })).toBe(false);
    expect(isTwoFactorRequired(403, 'Forbidden')).toBe(false);
    expect(isTwoFactorRequired(403, null)).toBe(false);
  });

  it('knows when a factor is the last one a role requires', () => {
    expect(totpIsLastFactor(status({ totp: true, required: true }))).toBe(true);
    expect(totpIsLastFactor(status({ totp: true, required: false }))).toBe(false);
    expect(totpIsLastFactor(status({ totp: true, required: true, passkeys: [passkey] }))).toBe(
      false,
    );
    expect(passkeyIsLastFactor(status({ required: true, passkeys: [passkey] }))).toBe(true);
    expect(passkeyIsLastFactor(status({ required: true, passkeys: [passkey, passkey] }))).toBe(
      false,
    );
    expect(passkeyIsLastFactor(status({ required: true, totp: true, passkeys: [passkey] }))).toBe(
      false,
    );
  });

  it('writes recovery codes one per line', () => {
    expect(recoveryCodesFile(['aaaa-bbbb', 'cccc-dddd'], 'a@example.com')).toBe(
      'Verdin recovery codes — a@example.com\n\naaaa-bbbb\ncccc-dddd\n',
    );
  });
});
