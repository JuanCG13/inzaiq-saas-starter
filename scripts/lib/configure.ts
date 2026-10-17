import type { TemplateConfig } from '../../src/template.config';
import { LOCALE_DEFINITIONS, resolveLocalized, validateCurrencySettings, validateI18nSettings } from '../../src/i18n/config';

/**
 * Pure transformation behind `npm run configure`. Nothing here touches the file system, so the
 * rules are unit-tested (tests/configure.test.ts) and the CLI (scripts/configure.ts) only does I/O.
 * Language and currency are checked with the same validators the application runs at startup.
 */

export const DEFAULT_CURRENCY = 'USD';
export const DEFAULT_LOCALE = 'en';
export const PRICES_NOT_CONVERTED_NOTICE = 'Existing product prices and currencies were NOT converted.';

/** Raw command-line values; lists are comma separated strings. */
export interface ConfigureOptions {
  name?: string;
  description?: string;
  currency?: string;
  currencies?: string;
  locale?: string;
  locales?: string;
}

export const CONFIGURE_USAGE = `Usage: npm run configure -- [options]

  --name <text>           Brand name shown in the storefront and admin.
  --description <text>    Tagline. With a per-locale map it replaces the default language entry.
  --currency <ISO 4217>   Default currency for new products and empty totals (default USD), e.g. EUR.
  --currencies <list>     Comma separated codes offered in the product editor, e.g. USD,EUR,GBP.
                          Must include the default currency. If omitted, the current list is kept
                          and the default currency is added to it when missing.
  --locale <code>         Default language, e.g. en. Must be registered in src/i18n/config.ts.
  --locales <list>        Comma separated languages offered to visitors, e.g. en,es.
  --help                  Show this message.

Prices are integer minor units and are never converted when the currency changes.`;

export interface ParsedConfigSource {
  /** Everything before the object literal: doc comment, interface and the declaration. */
  prefix: string;
  config: Partial<TemplateConfig> & { locale?: unknown };
  /** Everything after the object literal, usually ";\n". */
  suffix: string;
}

const FORMAT_CHANGED = 'Configuration format changed. Edit src/template.config.ts directly.';

/** Index of the "}" closing the object literal that opens at `start`, skipping braces in strings. */
function closingBrace(source: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (char === '\\') index += 1;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/** Splits src/template.config.ts into its untouched text and the JSON-compatible settings object. */
export function parseConfigSource(source: string): ParsedConfigSource {
  const declaration = /export\s+const\s+templateConfig\s*(?::\s*[A-Za-z_$][\w$]*)?\s*=\s*/.exec(source);
  if (!declaration) throw new Error(FORMAT_CHANGED);
  const start = declaration.index + declaration[0].length;
  if (source[start] !== '{') throw new Error(FORMAT_CHANGED);
  const end = closingBrace(source, start);
  if (end < 0) throw new Error(FORMAT_CHANGED);
  let config: unknown;
  try { config = JSON.parse(source.slice(start, end + 1)); } catch { throw new Error(FORMAT_CHANGED); }
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error(FORMAT_CHANGED);
  return { prefix: source.slice(0, start), config: config as ParsedConfigSource['config'], suffix: source.slice(end + 1) };
}

export function renderConfigSource(parsed: Pick<ParsedConfigSource, 'prefix' | 'suffix'>, config: TemplateConfig): string {
  return `${parsed.prefix}${JSON.stringify(config, null, 2)}${parsed.suffix}`;
}

/** Splits "USD, EUR,gbp" into trimmed items. Empty segments are dropped; validation happens later. */
export function parseList(value: string): string[] {
  return value.split(',').map(item => item.trim()).filter(Boolean);
}

function withDefaultFirst(list: readonly string[], value: string): string[] {
  return list.includes(value) ? [...list] : [value, ...list];
}

function requireText(value: string, flag: string): string {
  const text = value.trim();
  if (!text) throw new Error(`--${flag} must not be empty.`);
  if (/[\u0000-\u001f\u007f]/.test(text)) throw new Error(`--${flag} must not contain control characters.`);
  return text;
}

/** Adds the registered languages (and a "did you mean" hint) to a language validation error. */
function explainLocaleError(error: unknown, options: ConfigureOptions): Error {
  const message = error instanceof Error ? error.message : String(error);
  const registered = LOCALE_DEFINITIONS.map(definition => definition.code);
  const hints = [`Registered languages: ${registered.join(', ')}.`];
  for (const value of [options.locale, ...(options.locales ? parseList(options.locales) : [])]) {
    const primary = value?.split(/[-_]/)[0];
    if (value && primary && value !== primary && (registered as string[]).includes(primary)) hints.push(`Use "${primary}" instead of "${value}".`);
  }
  return new Error(`${message} ${hints.join(' ')}`);
}

/** First language the installation offers that would show no tagline at all, as an error message. */
function taglineProblem(config: Pick<TemplateConfig, 'description' | 'i18n'>): string | null {
  const { defaultLocale, locales } = config.i18n;
  const code = locales.find(locale => !resolveLocalized(config.description, locale, defaultLocale).trim());
  return code === undefined ? null : `description is empty for language "${code}".`;
}

export interface SettingsCheck {
  check: 'i18n.settings' | 'currency.settings';
  ok: boolean;
  /** Validator message, only set when `ok` is false. It names settings, never environment values. */
  message?: string;
}

/**
 * The two `npm run doctor` checks for language and currency. They run the same validators as the
 * application (src/i18n/runtime.ts) plus the tagline rule that `npm run configure` enforces.
 */
export function checkSettings(config: Pick<TemplateConfig, 'description' | 'i18n' | 'currency' | 'currencies'>): SettingsCheck[] {
  const run = (check: SettingsCheck['check'], fn: () => void): SettingsCheck => {
    try { fn(); return { check, ok: true }; } catch (error) { return { check, ok: false, message: error instanceof Error ? error.message : String(error) }; }
  };
  return [
    run('i18n.settings', () => {
      validateI18nSettings(config.i18n);
      const problem = taglineProblem(config);
      if (problem) throw new Error(problem);
    }),
    run('currency.settings', () => { validateCurrencySettings(config); }),
  ];
}

export interface ConfigureResult {
  config: TemplateConfig;
  /** Human-readable remarks about what was defaulted or removed. */
  notes: string[];
}

/**
 * Applies command-line options to the current settings and validates the result with the
 * application's own validators. Throws a descriptive Error and never returns an invalid config.
 */
export function applyConfigure(current: ParsedConfigSource['config'], options: ConfigureOptions = {}): ConfigureResult {
  const notes: string[] = [];
  const { locale: legacyLocale, ...base } = structuredClone(current);
  if (legacyLocale !== undefined) notes.push('Removed the legacy "locale" setting; use "i18n" (--locale and --locales) instead.');

  const name = options.name !== undefined ? requireText(options.name, 'name') : base.name ?? '';

  const currency = options.currency ?? base.currency ?? DEFAULT_CURRENCY;
  let currencies: string[];
  if (options.currencies !== undefined) currencies = parseList(options.currencies);
  else if (!Array.isArray(base.currencies)) currencies = [currency];
  else if (options.currency !== undefined) currencies = withDefaultFirst(base.currencies, currency);
  else currencies = base.currencies;

  const defaultLocale = options.locale ?? base.i18n?.defaultLocale ?? DEFAULT_LOCALE;
  let locales: string[];
  if (options.locales !== undefined) locales = parseList(options.locales);
  else if (!Array.isArray(base.i18n?.locales)) locales = [defaultLocale];
  else if (options.locale !== undefined) locales = withDefaultFirst(base.i18n.locales, defaultLocale);
  else locales = base.i18n.locales;

  let description = base.description ?? '';
  if (options.description !== undefined) {
    const text = requireText(options.description, 'description');
    description = typeof description === 'string' ? text : { ...description, [defaultLocale]: text };
  }

  const config = { ...base, name, description, currency, currencies, i18n: { defaultLocale, locales } } as TemplateConfig;

  try { validateI18nSettings(config.i18n); } catch (error) { throw explainLocaleError(error, options); }
  validateCurrencySettings(config);
  if (!config.name) throw new Error('name must not be empty. Pass --name.');
  const tagline = taglineProblem(config);
  if (tagline) throw new Error(`${tagline} Pass --description.`);
  return { config, notes };
}

export interface ConfigureSourceResult extends ConfigureResult {
  source: string;
  /** False when the file already had these settings, so the CLI can skip the write. */
  changed: boolean;
}

/** Rewrites the text of src/template.config.ts, keeping the interface and doc comment as they are. */
export function configureSource(source: string, options: ConfigureOptions = {}): ConfigureSourceResult {
  const parsed = parseConfigSource(source);
  const result = applyConfigure(parsed.config, options);
  const next = renderConfigSource(parsed, result.config);
  return { ...result, source: next, changed: next !== source };
}

/** Summary lines for the CLI. Contains only installation settings, never environment secrets. */
export function describeConfig(config: TemplateConfig): string[] {
  const { defaultLocale, locales } = config.i18n;
  const description = typeof config.description === 'string' ? config.description : resolveLocalized(config.description, defaultLocale, defaultLocale);
  return [
    `name:        ${config.name}`,
    `description: ${description}`,
    `currency:    ${config.currency} (product editor offers: ${config.currencies.join(', ')})`,
    `languages:   ${defaultLocale} (default)${locales.filter(code => code !== defaultLocale).map(code => `, ${code}`).join('')}`,
  ];
}
