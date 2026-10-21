/**
 * Where to go after sign-in. Only a path on this origin is allowed: the value is resolved the way the browser
 * would resolve it (so "//host" and "/\host" count as other hosts), and anything that leaves the origin, or is
 * not an absolute path to begin with, falls back to "/".
 */
export function safeNext(next: string | null | undefined, origin: string): string {
  if (!next || !next.startsWith("/") || /[\u0000-\u001f\\]/.test(next)) return "/";
  try {
    const url = new URL(next, origin);
    if (url.origin !== origin) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}
