import type { ReactNode } from 'react';
import { lang } from 'next/root-params';
import { notFound } from 'next/navigation';
import type { Namespace } from './config';
import { loadMessages } from './messages';
import { I18nProvider } from './provider';
import { formatLocaleOf, isEnabledLocale } from './runtime';

/**
 * Server Component that loads message namespaces for the current `[lang]` segment and hands them
 * to Client Components below. Route layouts use it so a page ships only the text it needs.
 */
export async function I18nScope({ namespaces, children }: { namespaces: readonly Namespace[]; children: ReactNode }) {
  const locale = await lang();
  if (!isEnabledLocale(locale)) notFound();
  return <I18nProvider locale={locale} formatLocale={formatLocaleOf(locale)} messages={await loadMessages(locale, namespaces)}>{children}</I18nProvider>;
}
