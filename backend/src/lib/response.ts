import type { Context } from "hono";

export function jsonError(c: Context, status: number, code: string, message: string) {
  return c.json({ error: { code, message } }, status as never);
}

export function isEmail(value: unknown): value is string {
  if (typeof value !== "string") return false;
  // Pragmatic email check — full RFC 5322 is overkill; provider validates on send.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

export function isNonEmptyString(value: unknown, max = 255): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}
