import { negotiateLocale } from './negotiate';

/** Pure path helpers for locale-prefixed URLs (/en/cart, /es/admin). */

export function splitLocale(pathname: string, enabled: readonly string[]): { locale: string | null; rest: string } {
  for (const locale of enabled) {
    if (pathname === `/${locale}`) return { locale, rest: '/' };
    if (pathname.startsWith(`/${locale}/`)) return { locale, rest: pathname.slice(locale.length + 1) };
  }
  return { locale: null, rest: pathname };
}

function isInternalPath(path: string) {
  return path.startsWith('/') && !path.startsWith('//') && !path.includes('\\');
}

/**
 * Prefixes an internal path with the locale, keeping any query string and hash.
 * Anything that is not a plain same-origin path (absolute URLs, //host, mailto:) is returned unchanged.
 */
export function localizePath(path: string, locale: string): string {
  if (!isInternalPath(path)) return path;
  const suffixAt = path.search(/[?#]/);
  const pathname = suffixAt === -1 ? path : path.slice(0, suffixAt);
  const suffix = suffixAt === -1 ? '' : path.slice(suffixAt);
  return `/${locale}${pathname === '/' ? '' : pathname}${suffix}`;
}

export interface RedirectInput {
  pathname: string;
  search?: string;
  cookie?: string | null;
  acceptLanguage?: string | null;
}

/**
 * Where a request without a locale prefix should go, or null when it already has one.
 * The result is always a same-origin path: the pathname is never interpreted as a host.
 */
export function resolveLocaleRedirect(input: RedirectInput, enabled: readonly string[], fallback: string): { pathname: string; search: string } | null {
  if (splitLocale(input.pathname, enabled).locale) return null;
  const locale = negotiateLocale({ cookie: input.cookie, acceptLanguage: input.acceptLanguage, enabled, fallback });
  const clean = input.pathname.startsWith('/') ? input.pathname : `/${input.pathname}`;
  // Collapse leading slashes so "//host" can never become a protocol-relative target.
  const pathname = `/${locale}${clean === '/' ? '' : `/${clean.replace(/^\/+/, '')}`}`;
  return { pathname, search: input.search ?? '' };
}
