import type { LocaleCode, Namespace } from './config';
import { defaultLocale, formatLocaleOf } from './runtime';
import { createTranslator, mergeMessages, type LoadedMessages, type MessageTree, type Translator } from './translate';

async function read(locale: string, namespace: Namespace): Promise<MessageTree> {
  const module = await import(`./messages/${locale}/${namespace}.json`) as { default: MessageTree };
  return module.default;
}

/**
 * Loads the requested namespaces for a locale on the server. Missing keys in a non-default locale
 * fall back to the default language, so a partially translated locale never shows raw keys.
 */
export async function loadMessages(locale: LocaleCode, namespaces: readonly Namespace[]): Promise<LoadedMessages> {
  const entries = await Promise.all(namespaces.map(async namespace => {
    const base = locale === defaultLocale ? undefined : await read(defaultLocale, namespace);
    return [namespace, mergeMessages(base, await read(locale, namespace))] as const;
  }));
  return Object.fromEntries(entries) as LoadedMessages;
}

/** Translator for Server Components, route metadata and server-rendered pages. */
export async function getTranslator<N extends Namespace>(locale: LocaleCode, namespace: N): Promise<Translator<N>> {
  const messages = await loadMessages(locale, [namespace]);
  return createTranslator<N>(messages[namespace] as MessageTree | undefined, formatLocaleOf(locale));
}
