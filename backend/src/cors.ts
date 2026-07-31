// Shared CORS origin policy.
//
// Previously both call sites reflected whatever Origin the caller sent while
// also setting Allow-Credentials, which tells ANY website it may make
// authenticated requests to this API. This restricts that to origins we own.

/** Exact hosts we serve the app from. */
const ALLOWED_HOSTS = new Set([
  "framehow.app",
  "www.framehow.app",
  "framehow.com",      // future production domain
  "www.framehow.com",
  "framehow-react.pages.dev",
  "dev.framehow-react.pages.dev",
]);

/** Cloudflare Pages preview deploys: <hash>.framehow-react.pages.dev */
const PAGES_PREVIEW = /^[a-z0-9-]+\.framehow-react\.pages\.dev$/i;

/**
 * Returns the origin to echo back, or null when it is not one of ours.
 * Falling back to APP_URL keeps non-browser callers (curl, native apps,
 * which send no Origin header) working exactly as before.
 */
export function resolveAllowedOrigin(origin: string | undefined, appUrl: string): string | null {
  if (!origin) return appUrl;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  // Local development on any port.
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return origin;
  if (url.protocol !== "https:") return null;
  if (ALLOWED_HOSTS.has(url.hostname)) return origin;
  if (PAGES_PREVIEW.test(url.hostname)) return origin;
  return null;
}
