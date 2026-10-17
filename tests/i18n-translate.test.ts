import { describe, expect, it } from 'vitest';
import { createTranslator, interpolate, isPluralForms, mergeMessages, type MessageTree } from '@/i18n/translate';
import { resolveLocalized, validateCurrencySettings, validateI18nSettings } from '@/i18n/config';
import { currencyFactor, formatMoney } from '@/i18n/format';

const tree: MessageTree = {
  title: 'Hello {name}',
  items: { one: '{count} item', other: '{count} items' },
  group: { nested: 'Nested' },
};

describe('translator', () => {
  const t = createTranslator<'common'>(tree, 'en-US') as unknown as (key: string, values?: Record<string, string | number>) => string;

  it('interpolates placeholders and leaves unknown ones visible', () => {
    expect(t('title', { name: 'Ana' })).toBe('Hello Ana');
    expect(interpolate('Hi {who}', { name: 'x' })).toBe('Hi {who}');
  });

  it('selects plural forms with the locale rules', () => {
    expect(t('items', { count: 1 })).toBe('1 item');
    expect(t('items', { count: 3 })).toBe('3 items');
    const russian = createTranslator<'common'>({ n: { one: '{count} товар', few: '{count} товара', many: '{count} товаров', other: '{count} товара' } }, 'ru') as unknown as typeof t;
    expect([1, 3, 5, 21].map(count => russian('n', { count }))).toEqual(['1 товар', '3 товара', '5 товаров', '21 товар']);
  });

  it('reports missing keys by returning the key and exposes has()', () => {
    expect(t('missing.key')).toBe('missing.key');
    expect(t('group')).toBe('group');
    const translator = createTranslator<'common'>(tree, 'en-US');
    expect(translator.has('group.nested')).toBe(true);
    expect(translator.has('group')).toBe(false);
    expect(translator.has('items')).toBe(true);
  });

  it('does not mistake a group with an "other" key for a plural', () => {
    expect(isPluralForms({ other: 'x', label: 'y' })).toBe(false);
    expect(isPluralForms({ one: 'a', other: 'b' })).toBe(true);
  });

  it('overlays a partial locale on the default language', () => {
    const merged = mergeMessages(tree, { title: 'Hola {name}', group: {} });
    expect(merged).toEqual({ title: 'Hola {name}', items: tree.items, group: { nested: 'Nested' } });
  });
});

describe('installation settings', () => {
  it('requires registered locales and a default that is offered', () => {
    expect(() => validateI18nSettings({ defaultLocale: 'en', locales: ['en', 'es'] })).not.toThrow();
    expect(() => validateI18nSettings({ defaultLocale: 'en', locales: [] })).toThrow(/at least one/);
    expect(() => validateI18nSettings({ defaultLocale: 'fr', locales: ['fr'] })).toThrow(/not registered/);
    expect(() => validateI18nSettings({ defaultLocale: 'es', locales: ['en'] })).toThrow(/defaultLocale/);
    expect(() => validateI18nSettings({ defaultLocale: 'en', locales: ['en', 'en'] })).toThrow(/repeat/);
  });

  it('resolves a tagline from a string or per-locale map', () => {
    expect(resolveLocalized('One', 'es', 'en')).toBe('One');
    expect(resolveLocalized({ en: 'Hello', es: 'Hola' }, 'es', 'en')).toBe('Hola');
    expect(resolveLocalized({ en: 'Hello' }, 'es', 'en')).toBe('Hello');
  });
});

describe('currency settings and formatting', () => {
  it('accepts supported ISO codes that include the default', () => {
    expect(() => validateCurrencySettings({ currency: 'USD', currencies: ['USD', 'EUR'] })).not.toThrow();
    expect(() => validateCurrencySettings({ currency: 'EUR', currencies: ['USD'] })).toThrow(/must include/);
    expect(() => validateCurrencySettings({ currency: 'usd', currencies: ['usd'] })).toThrow(/ISO 4217/);
    expect(() => validateCurrencySettings({ currency: 'ZZZ', currencies: ['ZZZ'] })).toThrow(/ISO 4217/);
    expect(() => validateCurrencySettings({ currency: 'USD', currencies: ['USD', 'USD'] })).toThrow(/repeat/);
    expect(() => validateCurrencySettings({ currency: 'USD', currencies: [] })).toThrow(/between 1 and 30/);
  });

  it('keeps minor units exact for 0-, 2- and 3-decimal currencies', () => {
    expect([currencyFactor('USD'), currencyFactor('PYG'), currencyFactor('JPY'), currencyFactor('KWD')]).toEqual([100, 1, 1, 1000]);
    expect(formatMoney(2900, 'USD', 'en-US')).toBe('$29.00');
    expect(formatMoney(32000, 'PYG', 'en-US').replace(/\u00a0/g, ' ')).toBe('PYG 32,000');
    expect(formatMoney(2900, 'EUR', 'en-US')).toBe('€29.00');
  });
});

describe('number interpolation', () => {
  it('groups numbers for the locale and leaves strings verbatim', () => {
    const english = createTranslator<'common'>({ units: { one: '{count} unit', other: '{count} units' }, ref: 'Ref {id}' }, 'en-US') as unknown as (key: string, values?: Record<string, string | number>) => string;
    const spanish = createTranslator<'common'>({ units: { one: '{count} unidad', other: '{count} unidades' } }, 'es-PY') as unknown as typeof english;
    expect(english('units', { count: 1500 })).toBe('1,500 units');
    expect(english('units', { count: 1 })).toBe('1 unit');
    expect(spanish('units', { count: 1500 })).toBe('1.500 unidades');
    expect(english('ref', { id: '0012345' })).toBe('Ref 0012345');
    expect(interpolate('{n}', { n: 1500 })).toBe('1500');
  });
});
