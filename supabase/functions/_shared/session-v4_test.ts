import {
  assertCredentialCurrent,
  b64url,
  SessionError,
  signSessionV4,
  verifySignedSessionV4,
} from './session-v4.ts';

const encoder = new TextEncoder();
const SECRET = 'unit-test-service-secret';
const UID = '11111111-1111-4111-8111-111111111111';
const NOW = 2_000_000_000;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function expectCode(fn: () => Promise<unknown>, code: string) {
  try {
    await fn();
  } catch (error) {
    assert(error instanceof SessionError, `expected SessionError, got ${String(error)}`);
    assert(error.code === code, `expected ${code}, got ${error.code}`);
    return;
  }
  throw new Error(`expected ${code}`);
}

async function signLegacyV3(uid = UID, now = NOW, ttl = 3600) {
  const payloadPart = b64url(encoder.encode(JSON.stringify({ v: 3, uid, iat: now, exp: now + ttl })));
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payloadPart)));
  return `${payloadPart}.${b64url(signature)}`;
}

Deno.test('session v4 verifies and survives the same credential', async () => {
  const token = await signSessionV4(UID, 'salt-A', SECRET, NOW, 3600);
  const payload = await verifySignedSessionV4(token, SECRET, NOW + 10);
  assert(payload.v === 4, 'expected v4');
  assert(payload.uid === UID, 'uid changed');
  await assertCredentialCurrent(payload, 'salt-A');
});

Deno.test('rotating password salt immediately revokes an existing v4 session', async () => {
  const token = await signSessionV4(UID, 'salt-before-password-change', SECRET, NOW, 3600);
  const payload = await verifySignedSessionV4(token, SECRET, NOW + 10);
  await expectCode(
    () => assertCredentialCurrent(payload, 'salt-after-password-change'),
    'SESSION_REVOKED',
  );
});

Deno.test('a correctly signed legacy v3 token requires a one-time security upgrade', async () => {
  const token = await signLegacyV3();
  await expectCode(() => verifySignedSessionV4(token, SECRET, NOW + 10), 'SESSION_UPGRADE_REQUIRED');
});

Deno.test('expired v4 sessions are rejected', async () => {
  const token = await signSessionV4(UID, 'salt-A', SECRET, NOW, 30);
  await expectCode(() => verifySignedSessionV4(token, SECRET, NOW + 31), 'SESSION_EXPIRED');
});

Deno.test('future-issued and tampered sessions are rejected', async () => {
  const future = await signSessionV4(UID, 'salt-A', SECRET, NOW + 600, 3600);
  await expectCode(() => verifySignedSessionV4(future, SECRET, NOW), 'UNAUTHORIZED');

  const token = await signSessionV4(UID, 'salt-A', SECRET, NOW, 3600);
  const [payload, signature] = token.split('.');
  const tampered = `${payload.slice(0, -1)}${payload.endsWith('A') ? 'B' : 'A'}.${signature}`;
  await expectCode(() => verifySignedSessionV4(tampered, SECRET, NOW + 1), 'UNAUTHORIZED');
});
