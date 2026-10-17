/**
 * Locale registry and configuration validation. This file has no runtime imports so the
 * proxy, the configure script, tests and the client can all use it.
 *
 * Adding a language = a folder in ./messages/<code>/ (see docs/i18n.md), one entry below and
 * its code in `i18n.locales` of src/template.config.ts.
 */
export interface LocaleDefinition {
  /** BCP 47 language tag. Used for the URL prefix, the NEXT_LOCALE cookie and <html lang>. */
  readonly code: string;
  /** Name shown in the language switcher, written in that language. */
  readonly nativeName: string;
  /** Tag handed to Intl for numbers, currencies, dates and plural rules. */
  readonly formatLocale: string;
}

export const LOCALE_DEFINITIONS = [
  { code: 'en', nativeName: 'English', formatLocale: 'en-US' },
  { code: 'es', nativeName: 'Español', formatLocale: 'es-PY' },
] as const satisfies readonly LocaleDefinition[];

export type LocaleCode = (typeof LOCALE_DEFINITIONS)[number]['code'];

/** Message files, one per feature area. Each lives at messages/<locale>/<namespace>.json. */
export const NAMESPACES = ['common', 'errors', 'runtime', 'storefront', 'cart', 'admin', 'auth'] as const;
export type Namespace = (typeof NAMESPACES)[number];

export const LOCALE_COOKIE = 'NEXT_LOCALE';
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export interface I18nSettings {
  defaultLocale: string;
  /** Locales offered by this installation, default first. Subset of LOCALE_DEFINITIONS. */
  locales: string[];
}

export interface LocalizedText { [locale: string]: string | undefined }

export function localeDefinition(code: string): LocaleDefinition | undefined {
  return LOCALE_DEFINITIONS.find(definition => definition.code === code);
}

export function isRegisteredLocale(value: unknown): value is LocaleCode {
  return typeof value === 'string' && LOCALE_DEFINITIONS.some(definition => definition.code === value);
}

/** Throws a descriptive error when the installation's language settings cannot work. */
export function validateI18nSettings(settings: I18nSettings): I18nSettings {
  const { defaultLocale, locales } = settings ?? {};
  if (!Array.isArray(locales) || !locales.length) throw new Error('i18n.locales must list at least one locale.');
  for (const code of locales) {
    if (!isRegisteredLocale(code)) throw new Error(`i18n.locales contains "${String(code)}", which is not registered in src/i18n/config.ts.`);
  }
  if (new Set(locales).size !== locales.length) throw new Error('i18n.locales must not repeat a locale.');
  if (!locales.includes(defaultLocale)) throw new Error(`i18n.defaultLocale "${String(defaultLocale)}" must be one of i18n.locales.`);
  return settings;
}

/** Picks the text for a locale from a plain string or a per-locale map; falls back to the default. */
export function resolveLocalized(value: string | LocalizedText, locale: string, defaultLocale: string): string {
  if (typeof value === 'string') return value;
  return value[locale] ?? value[defaultLocale] ?? Object.values(value).find((item): item is string => typeof item === 'string') ?? '';
}

export interface CurrencySettings {
  /** ISO 4217 code used for new products and for empty-state totals. */
  currency: string;
  /** Currencies offered in the product editor; must include `currency`. */
  currencies: string[];
}

export function supportedCurrencyCodes(): ReadonlySet<string> {
  return new Set(Intl.supportedValuesOf('currency'));
}

export function isSupportedCurrency(code: unknown): code is string {
  return typeof code === 'string' && /^[A-Z]{3}$/.test(code) && supportedCurrencyCodes().has(code);
}

/** Throws a descriptive error when the currency settings are unusable. */
export function validateCurrencySettings(settings: CurrencySettings): CurrencySettings {
  const { currency, currencies } = settings ?? {};
  if (!isSupportedCurrency(currency)) throw new Error(`currency "${String(currency)}" must be an ISO 4217 code supported by this runtime (for example USD).`);
  if (!Array.isArray(currencies) || !currencies.length || currencies.length > 30) throw new Error('currencies must list between 1 and 30 ISO 4217 codes.');
  for (const code of currencies) if (!isSupportedCurrency(code)) throw new Error(`currencies contains "${String(code)}", which is not a supported ISO 4217 code.`);
  if (new Set(currencies).size !== currencies.length) throw new Error('currencies must not repeat a code.');
  if (!currencies.includes(currency)) throw new Error(`currencies must include the default currency "${currency}".`);
  return settings;
}
