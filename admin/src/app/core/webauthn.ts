/**
 * Passkeys (WebAuthn): the server sends `navigator.credentials` options and expects the
 * credential back as JSON, both with binary fields as base64url strings.
 */

/** Options as the server sends them (binary fields in base64url). */
export interface CreationOptionsJson {
  challenge: string;
  rp: { id?: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { type: 'public-key'; alg: number }[];
  timeout?: number;
  attestation?: AttestationConveyancePreference;
  authenticatorSelection?: AuthenticatorSelectionCriteria;
  excludeCredentials?: { type: 'public-key'; id: string; transports?: string[] }[];
}

export interface RequestOptionsJson {
  challenge: string;
  rpId?: string;
  timeout?: number;
  userVerification?: UserVerificationRequirement;
  allowCredentials?: { type: 'public-key'; id: string; transports?: string[] }[];
}

/** A new passkey, as `POST /auth/two-factor/passkeys` takes it. */
export interface AttestationJson {
  id: string;
  rawId: string;
  type: string;
  response: { clientDataJSON: string; attestationObject: string };
}

/** A passkey assertion, as the second sign-in step takes it. */
export interface AssertionJson {
  id: string;
  rawId: string;
  type: string;
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle: string | null;
  };
}

export function base64urlToBuffer(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export function bufferToBase64url(value: ArrayBuffer | ArrayBufferView): string {
  const bytes =
    value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function descriptors(
  list: { type: 'public-key'; id: string; transports?: string[] }[] | undefined,
): PublicKeyCredentialDescriptor[] | undefined {
  return list?.map((item) => ({
    type: item.type,
    id: base64urlToBuffer(item.id),
    ...(item.transports ? { transports: item.transports as AuthenticatorTransport[] } : {}),
  }));
}

export function creationOptions(json: CreationOptionsJson): PublicKeyCredentialCreationOptions {
  return {
    ...json,
    challenge: base64urlToBuffer(json.challenge),
    user: { ...json.user, id: base64urlToBuffer(json.user.id) },
    excludeCredentials: descriptors(json.excludeCredentials),
  };
}

export function requestOptions(json: RequestOptionsJson): PublicKeyCredentialRequestOptions {
  return {
    ...json,
    challenge: base64urlToBuffer(json.challenge),
    allowCredentials: descriptors(json.allowCredentials),
  };
}

export function attestationJson(credential: PublicKeyCredential): AttestationJson {
  const response = credential.response as AuthenticatorAttestationResponse;
  return {
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bufferToBase64url(response.clientDataJSON),
      attestationObject: bufferToBase64url(response.attestationObject),
    },
  };
}

export function assertionJson(credential: PublicKeyCredential): AssertionJson {
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bufferToBase64url(response.clientDataJSON),
      authenticatorData: bufferToBase64url(response.authenticatorData),
      signature: bufferToBase64url(response.signature),
      userHandle: response.userHandle ? bufferToBase64url(response.userHandle) : null,
    },
  };
}

/** Whether this browser can use passkeys (WebAuthn needs a secure context). */
export function passkeysSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential === 'function' &&
    typeof navigator.credentials?.create === 'function'
  );
}

/** Creates a passkey with the browser (the admin confirms with their authenticator). */
export async function createPasskey(options: CreationOptionsJson): Promise<AttestationJson> {
  const credential = await navigator.credentials.create({ publicKey: creationOptions(options) });
  if (!(credential instanceof PublicKeyCredential)) throw new DOMException('', 'NotAllowedError');
  return attestationJson(credential);
}

/** Signs a challenge with one of the account's passkeys. */
export async function getPasskey(options: RequestOptionsJson): Promise<AssertionJson> {
  const credential = await navigator.credentials.get({ publicKey: requestOptions(options) });
  if (!(credential instanceof PublicKeyCredential)) throw new DOMException('', 'NotAllowedError');
  return assertionJson(credential);
}

/** The browser's prompt was cancelled or timed out (it does not tell which). */
export function isCancelled(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'NotAllowedError' || error.name === 'AbortError')
  );
}
