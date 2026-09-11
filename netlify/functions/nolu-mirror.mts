import { getStore } from "@netlify/blobs";
import { createHash, timingSafeEqual, webcrypto } from "node:crypto";

const { subtle } = webcrypto;
const ALLOWED_ORIGIN = "https://miiduoa.github.io";
const AUDIENCE = "nolu-provider-mesh";
const ISSUER = "nolu";
const KID = "mesh-20260911-1";
const MAX_BODY = 360_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX64 = /^[0-9a-f]{64}$/i;
const VERSION_KEY = /^(\d{1,16})-([0-9a-f]{64})$/i;
const PUBLIC_JWK = {
  kty: "EC",
  crv: "P-256",
  x: "4MhrmOPNbv2fphbk4Exsj9BLwyhIQnwK03Lj9uhXRds",
  y: "VWSU7m8SyzOsph0f9k70HOZj6-MBpcF7HF_6pwCnHqg",
  ext: true,
  key_ops: ["verify"],
  alg: "ES256",
  kid: KID,
};

let verifyKeyPromise: Promise<CryptoKey> | null = null;

function responseHeaders(origin: string) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    Vary: "Origin",
    "Access-Control-Allow-Headers": "authorization, content-type, x-nolu-mesh-version",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  if (origin === ALLOWED_ORIGIN) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

function json(status: number, body: unknown, origin = "") {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders(origin) });
}

function decodeJsonPart(value: string) {
  try {
    const bytes = Buffer.from(value || "", "base64url");
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    return null;
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digestSnapshot(snapshot: unknown) {
  return createHash("sha256").update(canonical(snapshot)).digest("hex");
}

function constantEqualText(a: string, b: string) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

async function verifyPortable(token: string) {
  const [headerPart, payloadPart, signaturePart, ...extra] = String(token || "").split(".");
  if (!headerPart || !payloadPart || !signaturePart || extra.length) throw new Error("invalid token");

  const header = decodeJsonPart(headerPart);
  const claims = decodeJsonPart(payloadPart);
  if (header?.alg !== "ES256" || header?.kid !== KID || header?.typ !== "NOLU") throw new Error("unsupported token");
  if (claims?.v !== 1 || claims?.iss !== ISSUER || claims?.aud !== AUDIENCE || !UUID.test(String(claims?.sub || ""))) {
    throw new Error("invalid claims");
  }

  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(claims?.iat) || !Number.isFinite(claims?.exp) || claims.exp <= now || claims.iat > now + 300 || claims.exp - claims.iat > 31 * 24 * 60 * 60) {
    throw new Error("expired token");
  }
  if (!claims.cv || String(claims.cv).length > 160) throw new Error("invalid credential version");

  verifyKeyPromise ||= subtle.importKey("jwk", PUBLIC_JWK, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const key = await verifyKeyPromise;
  const ok = await subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    Buffer.from(signaturePart, "base64url"),
    Buffer.from(`${headerPart}.${payloadPart}`),
  );
  if (!ok) throw new Error("bad signature");
  return claims;
}

async function readBody(request: Request) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_BODY) throw Object.assign(new Error("payload too large"), { status: 413 });
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_BODY) throw Object.assign(new Error("payload too large"), { status: 413 });
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid json");
    return parsed as Record<string, any>;
  } catch {
    throw Object.assign(new Error("invalid json"), { status: 400 });
  }
}

function validateSnapshot(snapshot: any, uid: string, revision: number, digest: string) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) throw Object.assign(new Error("invalid snapshot"), { status: 400 });
  if (String(snapshot.uid || "") !== uid) throw Object.assign(new Error("snapshot owner mismatch"), { status: 403 });
  if (!Number.isSafeInteger(revision) || revision <= 0) throw Object.assign(new Error("invalid revision"), { status: 400 });
  if (!HEX64.test(digest)) throw Object.assign(new Error("invalid digest"), { status: 400 });
  if (Buffer.byteLength(JSON.stringify(snapshot)) > 320_000) throw Object.assign(new Error("snapshot too large"), { status: 413 });
  const calculated = digestSnapshot(snapshot);
  if (!constantEqualText(calculated, digest)) throw Object.assign(new Error("digest mismatch"), { status: 400 });
}

function snapshotStore() {
  return getStore({ name: "nolu-snapshots", consistency: "strong" });
}

function versionKey(uid: string, revision: number, digest: string) {
  return `snapshot/${uid}/${String(revision).padStart(16, "0")}-${digest}`;
}

async function listVersions(uid: string) {
  const store = snapshotStore();
  const prefix = `snapshot/${uid}/`;
  const result = await store.list({ prefix });
  return result.blobs.map((item) => {
    const suffix = item.key.slice(prefix.length);
    const match = VERSION_KEY.exec(suffix);
    return match ? { key: item.key, revision: Number(match[1]), digest: match[2].toLowerCase() } : null;
  }).filter((item): item is { key: string; revision: number; digest: string } => !!item && Number.isSafeInteger(item.revision));
}

async function putSnapshot(uid: string, body: Record<string, any>) {
  const snapshot = body.snapshot;
  const revision = Number(body.revision ?? snapshot?.revision);
  const digest = String(body.digest || "").toLowerCase();
  validateSnapshot(snapshot, uid, revision, digest);

  const versions = await listVersions(uid);
  const sameRevision = versions.filter((item) => item.revision === revision);
  if (sameRevision.some((item) => !constantEqualText(item.digest, digest))) {
    throw Object.assign(new Error("revision conflict"), { status: 409 });
  }
  const newest = versions.reduce((best, item) => item.revision > best ? item.revision : best, 0);
  if (newest > revision) return { ok: true, stored: false, reason: "older_revision", revision: newest };

  const store = snapshotStore();
  const key = versionKey(uid, revision, digest);
  const existing = await store.get(key, { type: "json" }) as any;
  if (!existing) {
    await store.setJSON(key, {
      uid,
      revision,
      digest,
      snapshot,
      updated_at: new Date().toISOString(),
    });
  }
  return { ok: true, stored: true, revision, digest };
}

async function getSnapshot(uid: string) {
  const versions = await listVersions(uid);
  if (!versions.length) return { ok: true, snapshot: null, digest: "", revision: 0 };

  const highestRevision = Math.max(...versions.map((item) => item.revision));
  const highest = versions.filter((item) => item.revision === highestRevision);
  const uniqueDigests = [...new Set(highest.map((item) => item.digest))];
  if (uniqueDigests.length !== 1) throw Object.assign(new Error("revision conflict"), { status: 409 });

  const row = await snapshotStore().get(highest[0].key, { type: "json" }) as any;
  if (!row?.snapshot || Number(row.revision) !== highestRevision || !constantEqualText(String(row.digest || ""), uniqueDigests[0])) {
    throw Object.assign(new Error("stored snapshot integrity failure"), { status: 503 });
  }
  const calculated = digestSnapshot(row.snapshot);
  if (!constantEqualText(calculated, uniqueDigests[0])) throw Object.assign(new Error("stored snapshot integrity failure"), { status: 503 });
  return { ok: true, snapshot: row.snapshot, digest: uniqueDigests[0], revision: highestRevision, updated_at: row.updated_at || null };
}

async function health() {
  try {
    await snapshotStore().list({ prefix: "__health__/" });
    return { ok: true, provider: "netlify", storage: "netlify-blobs", consistency: "strong", status: "available" };
  } catch {
    return { ok: false, provider: "netlify", storage: "netlify-blobs", consistency: "strong", status: "unavailable" };
  }
}

export default async (request: Request) => {
  const origin = request.headers.get("origin") || "";
  const pathname = new URL(request.url).pathname;

  if (request.method === "OPTIONS") {
    if (origin && origin !== ALLOWED_ORIGIN) return json(403, { error: "ORIGIN_NOT_ALLOWED" }, origin);
    return new Response(null, { status: 204, headers: responseHeaders(origin) });
  }

  if (request.method === "GET" && pathname === "/health") {
    const result = await health();
    return json(result.ok ? 200 : 503, result, origin);
  }

  if (request.method !== "POST" || pathname !== "/mirror") return json(404, { error: "NOT_FOUND" }, origin);
  if (origin !== ALLOWED_ORIGIN) return json(403, { error: "ORIGIN_NOT_ALLOWED" }, origin);

  try {
    const authorization = request.headers.get("authorization") || "";
    if (!authorization.startsWith("Bearer ")) throw Object.assign(new Error("missing bearer token"), { status: 401 });
    const claims = await verifyPortable(authorization.slice(7));
    const body = await readBody(request);
    const action = String(body.action || "");

    let result: Record<string, unknown>;
    if (action === "put_snapshot") result = await putSnapshot(String(claims.sub), body);
    else if (action === "get_snapshot") result = await getSnapshot(String(claims.sub));
    else throw Object.assign(new Error("unsupported action"), { status: 400 });

    return json(200, { ...result, provider: "netlify" }, origin);
  } catch (error: any) {
    const inferredAuth = /token|signature|claims|bearer|expired/i.test(String(error?.message || ""));
    const status = Number(error?.status) || (inferredAuth ? 401 : 500);
    const safeMessage = status >= 500 ? "mirror temporarily unavailable" : String(error?.message || "request failed");
    return json(status, {
      ok: false,
      provider: "netlify",
      error: status === 401 ? "UNAUTHORIZED" : "MIRROR_ERROR",
      message: safeMessage,
    }, origin);
  }
};

export const config = {
  path: ["/mirror", "/health"],
};
