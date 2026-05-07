// Password hashing (PBKDF2-SHA256 via Web Crypto) and opaque token utilities.
// We can't use bcrypt/argon2 on Workers — Web Crypto is the supported path.

const PBKDF2_ITERATIONS = 210_000; // OWASP 2023 recommendation for PBKDF2-SHA256
const PBKDF2_KEYLEN = 32; // bytes
const SALT_LEN = 16; // bytes

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    key,
    PBKDF2_KEYLEN * 8,
  );
  return new Uint8Array(bits);
}

/**
 * Hash a password for storage. Format: `pbkdf2$<iter>$<salt-b64>$<hash-b64>`.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(hash)}`;
}

/**
 * Constant-time comparison of two equal-length byte arrays.
 */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations) || iterations < 1) return false;
  const salt = base64ToBytes(parts[2]);
  const expected = base64ToBytes(parts[3]);
  const actual = await pbkdf2(password, salt, iterations);
  return timingSafeEqual(actual, expected);
}

/**
 * Generate an opaque token (32 random bytes, base64url). Suitable for session
 * tokens, password reset tokens, and email verification tokens.
 */
export function generateToken(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/**
 * SHA-256 hash of a token, base64url-encoded. Stored in DB so a database leak
 * doesn't expose live tokens.
 */
export async function hashToken(token: string): Promise<string> {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(token));
  return bytesToBase64Url(new Uint8Array(digest));
}

export function newId(): string {
  return crypto.randomUUID();
}
