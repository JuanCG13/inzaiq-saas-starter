'use client';

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { ApiError } from '@/lib/api-client';
import { localizePath } from './routing';
import { formatDateTime, formatMoney, formatNumber } from './format';
import { createTranslator, mergeMessages, type LoadedMessages, type MessageTree, type Translator } from './translate';
import type { Namespace } from './config';

interface I18nContextValue { locale: string; formatLocale: string; messages: LoadedMessages }
const I18nContext = createContext<I18nContextValue | null>(null);

function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error('I18nProvider is required');
  return context;
}

/**
 * Supplies the active locale and the namespaces loaded by the server. Providers nest: a page can add
 * its own namespaces to the ones the layout already provided.
 */
export function I18nProvider({ locale, formatLocale, messages, children }: { locale: string; formatLocale: string; messages: LoadedMessages; children: ReactNode }) {
  const parent = useContext(I18nContext);
  const value = useMemo<I18nContextValue>(() => ({
    locale, formatLocale,
    messages: parent?.locale === locale ? (mergeMessages(parent.messages as MessageTree, messages as MessageTree) as LoadedMessages) : messages,
  }), [parent, locale, formatLocale, messages]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Active locale code, for example "en". */
export function useLocale(): string { return useI18n().locale; }

/** Translator for one namespace: `const t = useT("cart"); t("summary.title")`. */
export function useT<N extends Namespace>(namespace: N): Translator<N> {
  const { messages, formatLocale } = useI18n();
  return useMemo(() => createTranslator<N>(messages[namespace] as MessageTree | undefined, formatLocale), [messages, formatLocale, namespace]);
}

/** Money, number and date formatting in the active locale. */
export function useFormat() {
  const { formatLocale } = useI18n();
  return useMemo(() => ({
    money: (minor: number, currency: string) => formatMoney(minor, currency, formatLocale),
    number: (value: number) => formatNumber(value, formatLocale),
    dateTime: (value: string | number | Date, options?: Intl.DateTimeFormatOptions) => formatDateTime(value, formatLocale, options),
  }), [formatLocale]);
}

/** Prefixes an internal path with the active locale; use for hrefs, redirects and window.location. */
export function useLocalePath() {
  const locale = useLocale();
  return useCallback((path: string) => localizePath(path, locale), [locale]);
}

/**
 * User-facing text for a failed request. Server messages are English for logs and agents, so the
 * visible text is chosen by the stable error code; unknown codes use the caller's translated fallback.
 */
export function useErrorMessage() {
  const t = useT('errors');
  return useCallback((error: unknown, fallback?: string): string => {
    const code = error instanceof ApiError ? error.code : undefined;
    const message = code && t.has(`codes.${code}`) ? t(`codes.${code}` as never) : fallback ?? t('generic');
    const requestId = error instanceof Error && 'requestId' in error && typeof error.requestId === 'string' ? error.requestId : null;
    return requestId ? `${message} ${t('reference', { id: requestId })}` : message;
  }, [t]);
}
