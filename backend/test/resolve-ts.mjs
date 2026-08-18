// The backend's own imports leave the extension off — "./cors", not
// "./cors.ts" — which the bundler is happy with and Node is not. This adds the
// extension when a plain import cannot be found, so the real source can be run
// here unmodified.
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (e) {
    if (specifier.startsWith('.') && !/\.(ts|js|mjs|json)$/.test(specifier)) {
      try { return await next(`${specifier}.ts`, context); } catch { /* fall through */ }
      try { return await next(`${specifier}/index.ts`, context); } catch { /* fall through */ }
    }
    throw e;
  }
}
