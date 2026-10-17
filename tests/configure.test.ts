import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { tsImport } from 'tsx/esm/api';
import { LOCALE_DEFINITIONS, validateCurrencySettings, validateI18nSettings } from '../src/i18n/config';
import {
  CONFIGURE_USAGE,
  DEFAULT_CURRENCY,
  DEFAULT_LOCALE,
  PRICES_NOT_CONVERTED_NOTICE,
  applyConfigure,
  checkSettings,
  configureSource,
  describeConfig,
  parseConfigSource,
  parseList,
} from '../scripts/lib/configure';

const configUrl = new URL('../src/template.config.ts', import.meta.url);
const realSource = readFileSync(configUrl, 'utf8');
const real = parseConfigSource(realSource).config;

const baseSource = (config: object, suffix = ';\n') => `/** Doc comment kept as is. */\nexport interface TemplateConfig { name: string }\nexport const templateConfig:TemplateConfig = ${JSON.stringify(config, null, 2)}${suffix}`;
type RawConfig = Parameters<typeof applyConfigure>[0];
const sample: RawConfig = {
  name: 'Sample',
  description: { en: 'English tagline', es: 'Eslogan en español' },
  kind: 'ecommerce',
  currency: 'USD',
  currencies: ['USD', 'EUR', 'PYG'],
  i18n: { defaultLocale: 'en', locales: ['en', 'es'] },
  modules: { catalog: true, inventory: true, orders: true, mcp: true },
};

describe('configure defaults and shipped settings', () => {
  it('ships English and USD as the defaults and the committed config passes the app validators', () => {
    expect(DEFAULT_CURRENCY).toBe('USD');
    expect(DEFAULT_LOCALE).toBe('en');
    expect(real.currency).toBe('USD');
    expect(real.i18n?.defaultLocale).toBe('en');
    expect(() => validateI18nSettings(real.i18n!)).not.toThrow();
    expect(() => validateCurrencySettings(real as never)).not.toThrow();
  });

  it('changes nothing when no option is passed and keeps the file byte for byte', () => {
    const result = configureSource(realSource);
    expect(result.changed).toBe(false);
    expect(result.source).toBe(realSource);
    expect(result.notes).toEqual([]);
  });

  it('applies USD, English and a single language to a legacy config that lacks the new settings', () => {
    const legacy: RawConfig = { name: 'Old', description: 'Old tagline', kind: 'pos', locale: 'es-PY', modules: sample.modules };
    const { config, notes } = applyConfigure(legacy);
    expect(config.currency).toBe('USD');
    expect(config.currencies).toEqual(['USD']);
    expect(config.i18n).toEqual({ defaultLocale: 'en', locales: ['en'] });
    expect(config).not.toHaveProperty('locale');
    expect(notes.join(' ')).toMatch(/legacy "locale"/);
    expect(() => validateCurrencySettings(config)).not.toThrow();
  });

  it('parses comma separated lists, trimming blanks', () => {
    expect(parseList(' USD, EUR ,,gbp')).toEqual(['USD', 'EUR', 'gbp']);
    expect(parseList('')).toEqual([]);
  });
});

describe('currency', () => {
  it('changing the default keeps the offered list valid by adding the new default first', () => {
    const { config } = applyConfigure(sample, { currency: 'GBP' });
    expect(config.currency).toBe('GBP');
    expect(config.currencies).toEqual(['GBP', 'USD', 'EUR', 'PYG']);
    expect(() => validateCurrencySettings(config)).not.toThrow();
  });

  it('keeps the list untouched when the new default is already offered', () => {
    const { config } = applyConfigure(sample, { currency: 'PYG' });
    expect(config.currencies).toEqual(['USD', 'EUR', 'PYG']);
  });

  it('replaces the offered list with --currencies and requires it to include the default', () => {
    expect(applyConfigure(sample, { currency: 'EUR', currencies: 'EUR, USD' }).config.currencies).toEqual(['EUR', 'USD']);
    expect(applyConfigure(sample, { currencies: 'USD,JPY' }).config.currencies).toEqual(['USD', 'JPY']);
    expect(() => applyConfigure(sample, { currency: 'GBP', currencies: 'USD,EUR' })).toThrow(/must include the default currency "GBP"/);
    expect(() => applyConfigure(sample, { currencies: 'EUR' })).toThrow(/must include the default currency "USD"/);
  });

  it('rejects lowercase, malformed and unknown codes without changing anything', () => {
    expect(() => applyConfigure(sample, { currency: 'usd' })).toThrow(/currency "usd"/);
    expect(() => applyConfigure(sample, { currency: 'US' })).toThrow(/ISO 4217/);
    expect(() => applyConfigure(sample, { currency: 'ZZZ' })).toThrow(/ISO 4217/);
    expect(() => applyConfigure(sample, { currency: '' })).toThrow(/ISO 4217/);
    expect(() => applyConfigure(sample, { currencies: 'USD,eur' })).toThrow(/"eur"/);
    expect(() => applyConfigure(sample, { currencies: 'USD,USD' })).toThrow(/repeat/);
    expect(() => applyConfigure(sample, { currencies: '' })).toThrow(/between 1 and 30/);
    const source = baseSource(sample);
    expect(() => configureSource(source, { currency: 'usd' })).toThrow();
    expect(parseConfigSource(source).config.currency).toBe('USD');
  });

  it('does not mutate the settings it was given', () => {
    const frozen = structuredClone(sample);
    applyConfigure(frozen, { currency: 'GBP', name: 'Other', description: 'x', locales: 'en' });
    expect(frozen).toEqual(sample);
  });
});

describe('languages', () => {
  it('accepts registered languages and sets the default', () => {
    const { config } = applyConfigure(sample, { locale: 'es' });
    expect(config.i18n).toEqual({ defaultLocale: 'es', locales: ['en', 'es'] });
    expect(applyConfigure(sample, { locale: 'es', locales: 'es' }).config.i18n).toEqual({ defaultLocale: 'es', locales: ['es'] });
    expect(applyConfigure(sample, { locales: 'en' }).config.i18n).toEqual({ defaultLocale: 'en', locales: ['en'] });
  });

  it('adds the default to the list when only --locale is given and the list lacks it', () => {
    const onlyEnglish = { ...sample, i18n: { defaultLocale: 'en', locales: ['en'] } };
    expect(applyConfigure(onlyEnglish, { locale: 'es' }).config.i18n).toEqual({ defaultLocale: 'es', locales: ['es', 'en'] });
  });

  it('rejects unregistered languages, naming the registered ones and suggesting the base language', () => {
    const registered = LOCALE_DEFINITIONS.map(definition => definition.code).join(', ');
    expect(() => applyConfigure(sample, { locale: 'fr' })).toThrow(/not registered in src\/i18n\/config\.ts/);
    expect(() => applyConfigure(sample, { locale: 'fr' })).toThrow(new RegExp(`Registered languages: ${registered}`));
    expect(() => applyConfigure(sample, { locales: 'en,de' })).toThrow(/"de"/);
    expect(() => applyConfigure(sample, { locale: 'es-PY' })).toThrow(/Use "es" instead of "es-PY"/);
    expect(() => applyConfigure(sample, { locale: 'EN' })).toThrow(/not registered/);
  });

  it('rejects a default that is not in the list, repeats and empty lists', () => {
    expect(() => applyConfigure(sample, { locale: 'es', locales: 'en' })).toThrow(/defaultLocale "es" must be one of/);
    expect(() => applyConfigure(sample, { locales: 'en,en' })).toThrow(/repeat/);
    expect(() => applyConfigure(sample, { locales: '' })).toThrow(/at least one/);
  });
});

describe('name and description', () => {
  it('replaces a plain string description', () => {
    const { config } = applyConfigure({ ...sample, description: 'Old tagline' }, { description: '  New tagline  ' });
    expect(config.description).toBe('New tagline');
  });

  it('updates only the default language entry of a per-language map', () => {
    const { config } = applyConfigure(sample, { description: 'Better tagline' });
    expect(config.description).toEqual({ en: 'Better tagline', es: 'Eslogan en español' });
    const spanishDefault = applyConfigure(sample, { locale: 'es', description: 'Nuevo eslogan' }).config;
    expect(spanishDefault.description).toEqual({ en: 'English tagline', es: 'Nuevo eslogan' });
  });

  it('adds the default language entry when the map does not have it', () => {
    const { config } = applyConfigure({ ...sample, description: { es: 'Solo español' } }, { description: 'Only English' });
    expect(config.description).toEqual({ es: 'Solo español', en: 'Only English' });
  });

  it('keeps the tagline untouched when --description is omitted', () => {
    expect(applyConfigure(sample, { name: 'Renamed' }).config.description).toEqual(sample.description);
  });

  it('trims the name and rejects empty or control-character text', () => {
    expect(applyConfigure(sample, { name: '  Acme Goods ' }).config.name).toBe('Acme Goods');
    expect(() => applyConfigure(sample, { name: '   ' })).toThrow(/--name must not be empty/);
    expect(() => applyConfigure(sample, { description: '' })).toThrow(/--description must not be empty/);
    expect(() => applyConfigure(sample, { description: 'two\nlines' })).toThrow(/control characters/);
  });

  it('refuses a configuration where an offered language would have no tagline at all', () => {
    expect(() => applyConfigure({ ...sample, description: {} }, {})).toThrow(/description is empty for language "en"/);
    expect(() => applyConfigure({ ...sample, name: undefined } as never, {})).toThrow(/name must not be empty/);
  });
});

describe('rewriting src/template.config.ts', () => {
  it('is idempotent: a second run with the same options changes nothing', () => {
    const options = { name: 'Acme Goods', description: 'Hello', currency: 'EUR', currencies: 'EUR,USD', locale: 'es', locales: 'es,en' };
    const first = configureSource(realSource, options);
    expect(first.changed).toBe(true);
    const second = configureSource(first.source, options);
    expect(second.changed).toBe(false);
    expect(second.source).toBe(first.source);
  });

  it('preserves the interface, the doc comment and the declaration while rewriting values', () => {
    const { source } = configureSource(realSource, { currency: 'EUR' });
    const before = parseConfigSource(realSource);
    const after = parseConfigSource(source);
    expect(after.prefix).toBe(before.prefix);
    expect(after.suffix).toBe(before.suffix);
    expect(source).toContain('npm run configure');
    expect(source).toContain('export interface TemplateConfig');
    expect(after.config.currency).toBe('EUR');
    expect(after.config.currencies).toEqual(before.config.currencies);
    expect(after.config.modules).toEqual(before.config.modules);
  });

  it('keeps a trailing "as const" and braces inside strings intact', () => {
    const tricky = baseSource({ ...sample, name: 'Brace } shop {', description: 'Say "hi" } now' }, ' as const;\n// trailing } comment\n');
    const result = configureSource(tricky, { currency: 'EUR' });
    const parsed = parseConfigSource(result.source);
    expect(parsed.suffix).toBe(' as const;\n// trailing } comment\n');
    expect(parsed.config.name).toBe('Brace } shop {');
    expect(parsed.config.description).toBe('Say "hi" } now');
    expect(parsed.config.currency).toBe('EUR');
  });

  it('refuses a file it cannot parse as plain JSON instead of guessing', () => {
    const message = /Configuration format changed/;
    expect(() => parseConfigSource('export const other = {};')).toThrow(message);
    expect(() => parseConfigSource('export const templateConfig = { name: "unquoted keys" };')).toThrow(message);
    expect(() => parseConfigSource('export const templateConfig = {')).toThrow(message);
    expect(() => parseConfigSource('export const templateConfig = makeConfig();')).toThrow(message);
  });

  it('writes a TypeScript module that evaluates to the new settings', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'configure-'));
    try {
      const { source } = configureSource(realSource, { name: 'Acme', currency: 'GBP', locales: 'en' });
      const file = join(directory, 'template.config.ts');
      await writeFile(file, source);
      const loaded = await tsImport(file, import.meta.url) as { templateConfig: Record<string, unknown> };
      expect(loaded.templateConfig).toMatchObject({ name: 'Acme', currency: 'GBP', i18n: { defaultLocale: 'en', locales: ['en'] } });
      expect(() => validateCurrencySettings(loaded.templateConfig as never)).not.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('CLI output helpers', () => {
  it('describes only installation settings', () => {
    const lines = describeConfig(applyConfigure(sample, { currency: 'GBP' }).config).join('\n');
    expect(lines).toContain('GBP');
    expect(lines).toContain('en (default), es');
    expect(lines).toContain('English tagline');
  });

  it('documents every option and states that prices are not converted', () => {
    for (const flag of ['--name', '--description', '--currency', '--currencies', '--locale', '--locales']) expect(CONFIGURE_USAGE).toContain(flag);
    expect(PRICES_NOT_CONVERTED_NOTICE).toMatch(/NOT converted/);
  });
});

describe('doctor settings checks', () => {
  const failing = (config: Parameters<typeof checkSettings>[0]) => checkSettings(config).filter(result => !result.ok);

  it('passes for the shipped settings with the check names doctor prints', () => {
    expect(checkSettings(real as never)).toEqual([{ check: 'i18n.settings', ok: true }, { check: 'currency.settings', ok: true }]);
  });

  it('fails the language check for unregistered, missing or untitled languages and says why', () => {
    const base = sample as never as Parameters<typeof checkSettings>[0];
    expect(failing({ ...base, i18n: { defaultLocale: 'en', locales: ['en', 'fr'] } })).toEqual([{ check: 'i18n.settings', ok: false, message: expect.stringContaining('"fr"') }]);
    expect(failing({ ...base, i18n: { defaultLocale: 'es', locales: ['en'] } })).toEqual([{ check: 'i18n.settings', ok: false, message: expect.stringContaining('defaultLocale') }]);
    expect(failing({ ...base, i18n: { defaultLocale: 'en', locales: [] } })[0]?.message).toMatch(/at least one/);
    expect(failing({ ...base, description: {} })[0]).toMatchObject({ check: 'i18n.settings', message: 'description is empty for language "en".' });
    expect(failing({ ...base, description: { en: '   ' } })[0]?.check).toBe('i18n.settings');
  });

  it('falls back to the default language tagline, so a one-language map still passes', () => {
    const base = sample as never as Parameters<typeof checkSettings>[0];
    expect(failing({ ...base, description: { en: 'Only English' } })).toEqual([]);
    expect(failing({ ...base, description: 'Plain tagline' })).toEqual([]);
  });

  it('fails the currency check for an unsupported default or an offered list without it', () => {
    const base = sample as never as Parameters<typeof checkSettings>[0];
    expect(failing({ ...base, currency: 'usd' })).toEqual([{ check: 'currency.settings', ok: false, message: expect.stringContaining('"usd"') }]);
    expect(failing({ ...base, currency: 'EUR', currencies: ['USD'] })[0]?.message).toMatch(/must include the default currency "EUR"/);
    expect(failing({ ...base, currencies: [] })[0]?.message).toMatch(/between 1 and 30/);
  });

  it('reports both checks independently', () => {
    const base = sample as never as Parameters<typeof checkSettings>[0];
    expect(checkSettings({ ...base, currency: 'ZZZ', i18n: { defaultLocale: 'de', locales: ['de'] } }).map(result => [result.check, result.ok])).toEqual([['i18n.settings', false], ['currency.settings', false]]);
  });
});

describe('npm run configure (process)', () => {
  const cli = fileURLToPath(new URL('../scripts/configure.ts', import.meta.url));
  const root = fileURLToPath(new URL('..', import.meta.url));
  // Every case below must leave the committed settings alone; restore them even if one regresses.
  afterEach(() => { if (readFileSync(configUrl, 'utf8') !== realSource) writeFileSync(configUrl, realSource); });
  const run = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', cli, ...args], { cwd: root, encoding: 'utf8', timeout: 60_000 });

  it('prints the usage and exits 0 for --help without touching the file', () => {
    const result = run('--help');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('--currencies');
    expect(readFileSync(configUrl, 'utf8')).toBe(realSource);
  });

  it('exits 1 with one readable line, no stack trace and no write, for invalid values', () => {
    for (const args of [['--currency', 'usd'], ['--locale', 'es-PY'], ['--locales', 'en,fr'], ['--currencies', 'EUR'], ['--bogus']]) {
      const result = run(...args);
      expect(result.status, args.join(' ')).toBe(1);
      expect(result.stdout, args.join(' ')).toBe('');
      expect(result.stderr.split('\n')[0], args.join(' ')).toMatch(/^configure: \S/);
      expect(result.stderr, args.join(' ')).not.toMatch(/\n\s+at /);
      expect(readFileSync(configUrl, 'utf8'), args.join(' ')).toBe(realSource);
    }
  });

  it('reports "already up to date" and does not rewrite the file when nothing changes', () => {
    const result = run('--currency', real.currency!, '--locale', real.i18n!.defaultLocale);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/already up to date/);
    expect(result.stdout).toContain(PRICES_NOT_CONVERTED_NOTICE);
    expect(readFileSync(configUrl, 'utf8')).toBe(realSource);
  });
});
