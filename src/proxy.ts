import { NextResponse, type NextRequest } from 'next/server';
import { LOCALE_COOKIE } from '@/i18n/config';
import { defaultLocale, enabledLocales } from '@/i18n/runtime';
import { resolveLocaleRedirect } from '@/i18n/routing';

/**
 * Sends a request without a language prefix to /<locale>/…, choosing the saved cookie, then the
 * browser's Accept-Language, then the installation default. Query strings (including signed OAuth
 * parameters) are preserved. Prefixed URLs, APIs and static files pass through untouched.
 */
export function proxy(request: NextRequest) {
  const target = resolveLocaleRedirect({
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
    cookie: request.cookies.get(LOCALE_COOKIE)?.value,
    acceptLanguage: request.headers.get('accept-language'),
  }, enabledLocales, defaultLocale);
  if (!target) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = target.pathname;
  const response = NextResponse.redirect(url, 307);
  // The destination depends on the visitor, so shared caches must not reuse it.
  response.headers.set('Vary', 'Accept-Language, Cookie');
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export const config = {
  // Skip API routes, Next internals, OAuth discovery and any file with an extension (images, icons).
  matcher: ['/((?!api(?:/|$)|_next/|\\.well-known/|.*\\..*).*)'],
};
