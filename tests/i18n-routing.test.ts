import { describe, expect, it } from 'vitest';
import { matchLocale, negotiateLocale, parseAcceptLanguage } from '@/i18n/negotiate';
import { localizePath, resolveLocaleRedirect, splitLocale } from '@/i18n/routing';

const enabled = ['en', 'es'] as const;

describe('Accept-Language negotiation', () => {
  it('orders tags by quality and ignores wildcards, zero quality and malformed tags', () => {
    expect(parseAcceptLanguage('es-AR,es;q=0.9,en;q=0.8,*;q=0.1')).toEqual(['es-ar', 'es', 'en']);
    expect(parseAcceptLanguage('fr;q=0, de;q=0.4, en;q=0.9')).toEqual(['en', 'de']);
    expect(parseAcceptLanguage('en_US, <script>, ;q=1')).toEqual([]);
  });

  it('bounds hostile headers', () => {
    expect(parseAcceptLanguage('en,'.repeat(600))).toEqual([]);
    const many = Array.from({ length: 50 }, (_, index) => `l${String.fromCharCode(97 + (index % 26))}${String.fromCharCode(97 + Math.floor(index / 26))}`).join(',');
    expect(parseAcceptLanguage(many).length).toBe(20);
  });

  it('matches an exact tag, then the same language, otherwise nothing', () => {
    expect(matchLocale(['es-ar'], enabled)).toBe('es');
    expect(matchLocale(['fr', 'en-gb'], enabled)).toBe('en');
    expect(matchLocale(['fr', 'de'], enabled)).toBeUndefined();
  });

  it('prefers a saved choice, then the browser, then the default', () => {
    expect(negotiateLocale({ cookie: 'es', acceptLanguage: 'en', enabled, fallback: 'en' })).toBe('es');
    expect(negotiateLocale({ cookie: 'xx', acceptLanguage: 'es-PY', enabled, fallback: 'en' })).toBe('es');
    expect(negotiateLocale({ cookie: null, acceptLanguage: 'de', enabled, fallback: 'en' })).toBe('en');
    expect(negotiateLocale({ enabled, fallback: 'en' })).toBe('en');
  });
});

describe('locale-prefixed paths', () => {
  it('splits only whole path segments', () => {
    expect(splitLocale('/en', enabled)).toEqual({ locale: 'en', rest: '/' });
    expect(splitLocale('/es/cart', enabled)).toEqual({ locale: 'es', rest: '/cart' });
    expect(splitLocale('/english', enabled)).toEqual({ locale: null, rest: '/english' });
    expect(splitLocale('/cart/en', enabled)).toEqual({ locale: null, rest: '/cart/en' });
  });

  it('prefixes internal paths and keeps query and hash', () => {
    expect(localizePath('/', 'es')).toBe('/es');
    expect(localizePath('/cart', 'en')).toBe('/en/cart');
    expect(localizePath('/#collection', 'es')).toBe('/es#collection');
    expect(localizePath('/onboarding?client_id=a&sig=b%3D', 'en')).toBe('/en/onboarding?client_id=a&sig=b%3D');
  });

  it('never rewrites external or protocol-relative targets', () => {
    for (const target of ['https://example.com/a', '//example.com/a', '/\\example.com', 'mailto:a@b.co', 'cart']) expect(localizePath(target, 'en')).toBe(target);
  });
});

describe('proxy redirect decision', () => {
  it('does nothing when the locale is already in the path', () => {
    expect(resolveLocaleRedirect({ pathname: '/es/admin' }, enabled, 'en')).toBeNull();
    expect(resolveLocaleRedirect({ pathname: '/en' }, enabled, 'en')).toBeNull();
  });

  it('adds the negotiated locale and preserves the query string', () => {
    expect(resolveLocaleRedirect({ pathname: '/', acceptLanguage: 'es-PY,es;q=0.9' }, enabled, 'en')).toEqual({ pathname: '/es', search: '' });
    expect(resolveLocaleRedirect({ pathname: '/consent', search: '?client_id=x&sig=y', cookie: 'es' }, enabled, 'en')).toEqual({ pathname: '/es/consent', search: '?client_id=x&sig=y' });
    expect(resolveLocaleRedirect({ pathname: '/sign-in' }, enabled, 'en')).toEqual({ pathname: '/en/sign-in', search: '' });
  });

  it('cannot be turned into an open redirect', () => {
    for (const pathname of ['//evil.example', '///evil.example/a', '/\\evil.example']) {
      const target = resolveLocaleRedirect({ pathname }, enabled, 'en');
      expect(target?.pathname.startsWith('/en/')).toBe(true);
      expect(target?.pathname.startsWith('//')).toBe(false);
    }
  });

  it('treats unregistered language prefixes as ordinary paths', () => {
    expect(resolveLocaleRedirect({ pathname: '/fr/cart' }, enabled, 'en')?.pathname).toBe('/en/fr/cart');
  });
});
