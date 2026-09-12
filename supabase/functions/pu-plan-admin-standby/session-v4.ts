const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const SESSION_VERSION = 4;
export const DEFAULT_SESSION_SECONDS = 60 * 60 * 24 * 30;

export class SessionError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export type SessionV4Payload = {
  v: 4;
  uid: string;
  iat: number;
  exp: number;
  cv: string;
};

export function b64url(bytes: Uint8Array) {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function fromB64url(value: string) {
  let normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  while (normalized.length % 4) normalized += '=';
  const raw = atob(normalized);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function equalBytes(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function hmac(secret: string, message: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

export async function credentialVersion(passwordSalt: string) {
  if (!passwordSalt) throw new SessionError('SESSION_REVOKED', '登入憑證已變更，請重新登入');
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', encoder.encode(`nolu-session-v4:${passwordSalt}`)),
  );
  return b64url(digest).slice(0, 22);
}

export async function signSessionV4(
  uid: string,
  passwordSalt: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  ttlSeconds = DEFAULT_SESSION_SECONDS,
) {
  if (!uid || !secret) throw new SessionError('UNAUTHORIZED', '無法建立登入狀態');
  const payload: SessionV4Payload = {
    v: SESSION_VERSION,
    uid,
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds,
    cv: await credentialVersion(passwordSalt),
  };
  const encoded = b64url(encoder.encode(JSON.stringify(payload)));
  return `${encoded}.${b64url(await hmac(secret, encoded))}`;
}

export async function verifySignedSessionV4(
  token: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<SessionV4Payload> {
  const [payloadPart, signaturePart, ...extra] = String(token || '').split('.');
  if (!payloadPart || !signaturePart || extra.length) {
    throw new SessionError('UNAUTHORIZED', '請重新登入');
  }

  let payload: SessionV4Payload;
  try {
    const actual = fromB64url(signaturePart);
    const expected = await hmac(secret, payloadPart);
    if (!equalBytes(expected, actual)) throw new Error('bad signature');
    payload = JSON.parse(decoder.decode(fromB64url(payloadPart)));
  } catch {
    throw new SessionError('UNAUTHORIZED', '登入狀態無效，請重新登入');
  }

  if (payload?.v !== SESSION_VERSION || !payload.uid || !payload.iat || !payload.exp || !payload.cv) {
    throw new SessionError('SESSION_UPGRADE_REQUIRED', '登入安全性已更新，請重新登入');
  }
  if (!Number.isFinite(payload.iat) || !Number.isFinite(payload.exp) || payload.exp <= payload.iat) {
    throw new SessionError('UNAUTHORIZED', '登入狀態無效，請重新登入');
  }
  if (payload.exp < nowSeconds) {
    throw new SessionError('SESSION_EXPIRED', '登入已過期，請重新登入');
  }
  if (payload.iat > nowSeconds + 300) {
    throw new SessionError('UNAUTHORIZED', '登入狀態無效，請重新登入');
  }
  return payload;
}

export async function assertCredentialCurrent(payload: SessionV4Payload, currentPasswordSalt: string) {
  const current = await credentialVersion(currentPasswordSalt);
  if (payload.cv !== current) {
    throw new SessionError('SESSION_REVOKED', '登入憑證已變更，請重新登入');
  }
}
