import { templateConfig } from '@/template.config';
import { localeDefinition, resolveLocalized, validateCurrencySettings, validateI18nSettings, type LocaleCode } from './config';

/** Validated once at import so an invalid installation fails at build/start, not on a customer's request. */
const settings = validateI18nSettings(templateConfig.i18n);
validateCurrencySettings(templateConfig);

export const defaultLocale = settings.defaultLocale as LocaleCode;
/** Locales offered by this installation, default first. */
export const enabledLocales = [defaultLocale, ...settings.locales.filter(code => code !== defaultLocale)] as LocaleCode[];
/** Currency used for new products and zero totals; see docs/i18n.md. */
export const defaultCurrency = templateConfig.currency;
export const productCurrencies: readonly string[] = [templateConfig.currency, ...templateConfig.currencies.filter(code => code !== templateConfig.currency)];

export function isEnabledLocale(value: unknown): value is LocaleCode {
  return typeof value === 'string' && (enabledLocales as readonly string[]).includes(value);
}

export function formatLocaleOf(locale: string): string {
  return localeDefinition(locale)?.formatLocale ?? localeDefinition(defaultLocale)!.formatLocale;
}

export const defaultFormatLocale = formatLocaleOf(defaultLocale);

/** Brand tagline for a locale (config accepts one string or a per-locale map). */
export function brandDescription(locale: string): string {
  return resolveLocalized(templateConfig.description, locale, defaultLocale);
}
