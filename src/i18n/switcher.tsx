'use client';

import { usePathname } from 'next/navigation';
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, localeDefinition } from './config';
import { useLocale, useT } from './provider';
import { enabledLocales } from './runtime';
import { localizePath, splitLocale } from './routing';

/** Language selector. Renders nothing when the installation offers a single language. */
export function LocaleSwitcher({ className = '' }: { className?: string }) {
  const locale = useLocale();
  const pathname = usePathname();
  const t = useT('common');
  if (enabledLocales.length < 2) return null;

  function change(next: string) {
    const { rest } = splitLocale(pathname, enabledLocales);
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
    // A full navigation is deliberate: the root layout, <html lang> and every message namespace change together.
    window.location.assign(localizePath(`${rest}${window.location.search}${window.location.hash}`, next));
  }
  return <label className={`locale-switcher ${className}`.trim()}>
    <span className="locale-switcher-label">{t('language.label')}</span>
    <select value={locale} onChange={event => change(event.target.value)} aria-label={t('language.label')}>
      {enabledLocales.map(code => <option key={code} value={code} lang={code}>{localeDefinition(code)?.nativeName ?? code}</option>)}
    </select>
  </label>;
}
