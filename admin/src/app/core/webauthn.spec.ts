import { describe, expect, it } from 'vitest';

import {
  assertionJson,
  attestationJson,
  base64urlToBuffer,
  bufferToBase64url,
  creationOptions,
  isCancelled,
  requestOptions,
} from './webauthn';

const bytes = (...values: number[]) => new Uint8Array(values).buffer;
const view = (buffer: ArrayBuffer | BufferSource) =>
  Array.from(new Uint8Array(buffer as ArrayBuffer));

describe('base64url', () => {
  it('encodes without padding and with the URL-safe alphabet', () => {
    expect(bufferToBase64url(bytes())).toBe('');
    expect(bufferToBase64url(bytes(0xfb, 0xff))).toBe('-_8');
    expect(bufferToBase64url(bytes(1, 2, 3))).toBe('AQID');
    expect(bufferToBase64url(bytes(1, 2, 3, 4))).toBe('AQIDBA');
  });

  it('decodes with or without padding', () => {
    expect(view(base64urlToBuffer('-_8'))).toEqual([0xfb, 0xff]);
    expect(view(base64urlToBuffer('AQIDBA'))).toEqual([1, 2, 3, 4]);
    expect(view(base64urlToBuffer('AQIDBA=='))).toEqual([1, 2, 3, 4]);
  });

  it('round-trips every byte value', () => {
    const all = new Uint8Array(256).map((_, i) => i);
    expect(view(base64urlToBuffer(bufferToBase64url(all)))).toEqual(Array.from(all));
  });

  it('encodes a view of part of a buffer', () => {
    const buffer = new Uint8Array([9, 1, 2, 3, 9]);
    expect(bufferToBase64url(buffer.subarray(1, 4))).toBe('AQID');
  });
});

describe('options', () => {
  it('turns the creation options into buffers', () => {
    const options = creationOptions({
      challenge: 'AQID',
      rp: { id: 'example.com', name: 'Verdin' },
      user: { id: 'AAAAAAAAAAc', name: 'a@example.com', displayName: 'Ada' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      timeout: 60000,
      attestation: 'none',
      excludeCredentials: [{ type: 'public-key', id: '-_8' }],
    });
    expect(view(options.challenge)).toEqual([1, 2, 3]);
    expect(view(options.user.id)).toEqual([0, 0, 0, 0, 0, 0, 0, 7]);
    expect(options.user.name).toBe('a@example.com');
    expect(options.rp).toEqual({ id: 'example.com', name: 'Verdin' });
    expect(options.pubKeyCredParams).toEqual([{ type: 'public-key', alg: -7 }]);
    expect(options.excludeCredentials?.map((item) => view(item.id))).toEqual([[0xfb, 0xff]]);
  });

  it('turns the request options into buffers', () => {
    const options = requestOptions({
      challenge: 'AQIDBA',
      rpId: 'example.com',
      userVerification: 'preferred',
      allowCredentials: [{ type: 'public-key', id: 'AQID' }],
    });
    expect(view(options.challenge)).toEqual([1, 2, 3, 4]);
    expect(options.rpId).toBe('example.com');
    expect(options.allowCredentials?.[0].type).toBe('public-key');
    expect(view(options.allowCredentials![0].id)).toEqual([1, 2, 3]);
  });
});

describe('credentials', () => {
  it('serializes a new passkey', () => {
    const credential = {
      id: 'AQID',
      rawId: bytes(1, 2, 3),
      type: 'public-key',
      response: { clientDataJSON: bytes(123, 125), attestationObject: bytes(0xa0) },
    } as unknown as PublicKeyCredential;
    expect(attestationJson(credential)).toEqual({
      id: 'AQID',
      rawId: 'AQID',
      type: 'public-key',
      response: { clientDataJSON: 'e30', attestationObject: 'oA' },
    });
  });

  it('serializes an assertion, with or without a user handle', () => {
    const credential = (userHandle: ArrayBuffer | null) =>
      ({
        id: 'AQID',
        rawId: bytes(1, 2, 3),
        type: 'public-key',
        response: {
          clientDataJSON: bytes(123, 125),
          authenticatorData: bytes(1),
          signature: bytes(2),
          userHandle,
        },
      }) as unknown as PublicKeyCredential;
    expect(assertionJson(credential(bytes(7)))).toEqual({
      id: 'AQID',
      rawId: 'AQID',
      type: 'public-key',
      response: {
        clientDataJSON: 'e30',
        authenticatorData: 'AQ',
        signature: 'Ag',
        userHandle: 'Bw',
      },
    });
    expect(assertionJson(credential(null)).response.userHandle).toBeNull();
  });

  it('tells a cancelled prompt from other errors', () => {
    expect(isCancelled(new DOMException('', 'NotAllowedError'))).toBe(true);
    expect(isCancelled(new DOMException('', 'AbortError'))).toBe(true);
    expect(isCancelled(new DOMException('', 'InvalidStateError'))).toBe(false);
    expect(isCancelled(new Error('NotAllowedError'))).toBe(false);
  });
});
