import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LOCALE_DEFINITIONS, NAMESPACES, isRegisteredLocale, isSupportedCurrency, resolveLocalized, validateCurrencySettings, validateI18nSettings } from '../src/i18n/config';
import { PLURAL_CATEGORIES, isPluralForms } from '../src/i18n/translate';
import { templateConfig } from '../src/template.config';

/**
 * Parity gate for the message catalogs in src/i18n/messages/<locale>/<namespace>.json.
 * English is the reference: it defines the keys and the TypeScript types (see Messages in
 * src/i18n/translate.ts). Every registered language must carry the same keys and placeholders.
 * Adding a language: create its folder with all namespaces, register it in src/i18n/config.ts,
 * then list it in `i18n.locales` of src/template.config.ts. This file then checks it automatically.
 */
const MESSAGES_ROOT = fileURLToPath(new URL('../src/i18n/messages', import.meta.url));
const REFERENCE = 'en';
const SPANISH_ONLY = /[áéíóúñüÁÉÍÓÚÑÜ¿¡]/;
const MARKUP = /<\/?[a-z][^>]*>/i;
const PLACEHOLDER = /\{(\w+)\}/g; // the exact pattern interpolate() in src/i18n/translate.ts replaces

interface Leaf {
  plural: boolean;
  /** Plural categories present (empty for plain text). */
  categories: string[];
  /** Every string of the message: one for text, one per category for plurals. */
  texts: string[];
}
type Leaves = Map<string, Leaf>;

function placeholdersOf(leaf: Leaf): string[] {
  return [...new Set(leaf.texts.flatMap(text => [...text.matchAll(PLACEHOLDER)].map(match => match[1]!)))].sort();
}

/** Walks one namespace tree into `namespace:dotted.path` leaves and reports structural problems. */
function flatten(namespace: string, tree: unknown, where: string, leaves: Leaves, problems: string[]): void {
  const visit = (node: unknown, path: string): void => {
    const label = `${where} ${path || '(root)'}`;
    if (typeof node === 'string') {
      leaves.set(`${namespace}:${path}`, { plural: false, categories: [], texts: [node] });
      return;
    }
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      problems.push(`${label}: value must be a string, a plural object or a group of those, found ${node === null ? 'null' : Array.isArray(node) ? 'an array' : typeof node}.`);
      return;
    }
    const keys = Object.keys(node);
    if (isPluralForms(node)) {
      leaves.set(`${namespace}:${path}`, { plural: true, categories: keys.sort(), texts: keys.map(key => (node as Record<string, string>)[key]!) });
      return;
    }
    if (!keys.length) problems.push(`${label}: empty group; remove it or add messages.`);
    if (keys.length && keys.every(key => (PLURAL_CATEGORIES as readonly string[]).includes(key))) {
      problems.push(`${label}: looks like plural forms (${keys.join(', ')}) but has no "other" form, which is mandatory.`);
      return;
    }
    for (const key of keys) {
      if (key.includes('.')) problems.push(`${label}: key "${key}" contains a dot, so t() could never find it. Nest a group instead.`);
      visit((node as Record<string, unknown>)[key], path ? `${path}.${key}` : key);
    }
  };
  visit(tree, '');
}

interface LoadedLocale { leaves: Leaves; problems: string[] }

function analyzeTrees(code: string, trees: Record<string, unknown>, formatLocale: string): LoadedLocale {
  const leaves: Leaves = new Map();
  const problems: string[] = [];
  for (const [namespace, tree] of Object.entries(trees)) flatten(namespace, tree, `${code}/${namespace}.json`, leaves, problems);
  const required = new Intl.PluralRules(formatLocale).resolvedOptions().pluralCategories as string[];
  for (const [key, leaf] of leaves) {
    const where = `${code} ${key.replace(':', '/')}`;
    leaf.texts.forEach((text, index) => {
      const form = leaf.plural ? ` [${leaf.categories[index]}]` : '';
      if (!text.trim()) problems.push(`${where}${form}: message is empty.`);
      if (MARKUP.test(text)) problems.push(`${where}${form}: contains HTML/markup; split the sentence around the element into separate keys.`);
      if (/[{}]/.test(text.replace(PLACEHOLDER, ''))) problems.push(`${where}${form}: has a stray or malformed brace; placeholders look like {name}.`);
      if (code === REFERENCE && SPANISH_ONLY.test(text)) problems.push(`${where}${form}: "${text}" contains Spanish characters; the "${REFERENCE}" files must be English.`);
    });
    if (leaf.plural) {
      const missing = required.filter(category => !leaf.categories.includes(category));
      if (missing.length) problems.push(`${where}: plural forms lack ${missing.map(category => `"${category}"`).join(', ')}, required by Intl.PluralRules("${formatLocale}") (has ${leaf.categories.join(', ')}).`);
    }
  }
  return { leaves, problems };
}

function compareToReference(code: string, reference: Leaves, candidate: Leaves): string[] {
  const problems: string[] = [];
  const label = (key: string) => key.replace(':', '/');
  for (const [key, expected] of reference) {
    const actual = candidate.get(key);
    if (!actual) { problems.push(`${code} is missing ${label(key)} (present in ${REFERENCE}).`); continue; }
    if (expected.plural !== actual.plural) problems.push(`${code} ${label(key)}: must be ${expected.plural ? 'plural forms' : 'plain text'} like in ${REFERENCE}.`);
    const wanted = placeholdersOf(expected).join(', ');
    const found = placeholdersOf(actual).join(', ');
    if (wanted !== found) problems.push(`${code} ${label(key)}: placeholders {${found}} differ from ${REFERENCE} {${wanted}}.`);
  }
  for (const key of candidate.keys()) if (!reference.has(key)) problems.push(`${code} has ${label(key)}, which does not exist in ${REFERENCE}; add it there first (it defines the keys).`);
  return problems.sort();
}

function checkFolders(code: string, existing: readonly string[]): string[] {
  const problems: string[] = [];
  const expected = NAMESPACES.map(namespace => `${namespace}.json`);
  for (const file of expected) if (!existing.includes(file)) problems.push(`Locale "${code}" lacks src/i18n/messages/${code}/${file}.`);
  for (const file of existing) if (!expected.includes(file)) problems.push(`src/i18n/messages/${code}/${file} is not a known namespace. Add the namespace to NAMESPACES in src/i18n/config.ts or remove the file.`);
  return problems;
}

function loadLocale(code: string, formatLocale: string): LoadedLocale {
  const trees: Record<string, unknown> = {};
  const problems: string[] = [];
  for (const namespace of NAMESPACES) {
    const file = join(MESSAGES_ROOT, code, `${namespace}.json`);
    if (!existsSync(file)) continue;
    try { trees[namespace] = JSON.parse(readFileSync(file, 'utf8')); }
    catch (error) { problems.push(`${code}/${namespace}.json is not valid JSON: ${(error as Error).message}`); }
  }
  const analyzed = analyzeTrees(code, trees, formatLocale);
  return { leaves: analyzed.leaves, problems: [...problems, ...analyzed.problems] };
}

function expectNoProblems(problems: string[], hint: string): void {
  expect(problems, `${hint}\n  - ${problems.join('\n  - ')}`).toEqual([]);
}

const loaded = new Map(LOCALE_DEFINITIONS.map(definition => [definition.code as string, loadLocale(definition.code, definition.formatLocale)]));

describe('message folders match the registered locales', () => {
  const folders = existsSync(MESSAGES_ROOT) ? readdirSync(MESSAGES_ROOT, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name) : [];

  it('has a folder for every registered locale with every namespace and nothing else', () => {
    const problems: string[] = [];
    for (const { code } of LOCALE_DEFINITIONS) {
      if (!folders.includes(code)) { problems.push(`Locale "${code}" is registered in src/i18n/config.ts but src/i18n/messages/${code}/ does not exist.`); continue; }
      problems.push(...checkFolders(code, readdirSync(join(MESSAGES_ROOT, code))));
    }
    expectNoProblems(problems, 'Every registered locale needs src/i18n/messages/<code>/<namespace>.json for all namespaces:');
  });

  it('has no folder for a locale that is not registered', () => {
    const problems = folders.filter(folder => !isRegisteredLocale(folder)).map(folder => `src/i18n/messages/${folder}/ exists but "${folder}" is not registered. Register it in src/i18n/config.ts (LOCALE_DEFINITIONS) or delete the folder.`);
    expectNoProblems(problems, 'Unregistered message folders:');
  });

  it('uses the reference locale and parses every file as JSON', () => {
    expect(isRegisteredLocale(REFERENCE)).toBe(true);
    expectNoProblems([...loaded.values()].flatMap(locale => locale.problems).filter(problem => problem.includes('not valid JSON')), 'Invalid JSON:');
  });
});

describe('every locale has the same messages as the reference', () => {
  const reference = loaded.get(REFERENCE)!;
  for (const { code } of LOCALE_DEFINITIONS) {
    if (code === REFERENCE) continue;
    it(`${code} has exactly the keys, plural shape and placeholders of ${REFERENCE}`, () => {
      expectNoProblems(compareToReference(code, reference.leaves, loaded.get(code)!.leaves), `Fix src/i18n/messages/${code} so it mirrors src/i18n/messages/${REFERENCE}:`);
    });
  }

  it('has a non-trivial reference catalog', () => {
    expect(reference.leaves.size).toBeGreaterThan(100);
    for (const namespace of NAMESPACES) expect([...reference.leaves.keys()].some(key => key.startsWith(`${namespace}:`)), `${namespace} namespace is empty`).toBe(true);
  });
});

describe('message quality', () => {
  for (const { code, formatLocale } of LOCALE_DEFINITIONS) {
    it(`${code}: no empty text, valid plural categories for ${formatLocale}, no markup, no stray braces`, () => {
      expectNoProblems(loaded.get(code)!.problems, `Problems in src/i18n/messages/${code}:`);
    });
  }
});

describe('installation settings use registered languages and supported currencies', () => {
  const { i18n, description, currency, currencies } = templateConfig;

  it('registers every language the template offers', () => {
    const problems: string[] = [];
    for (const code of [i18n.defaultLocale, ...i18n.locales]) if (!isRegisteredLocale(code)) problems.push(`src/template.config.ts uses language "${code}", which is not registered. Add it to LOCALE_DEFINITIONS in src/i18n/config.ts with its messages folder.`);
    if (typeof description === 'object') {
      for (const code of Object.keys(description)) if (!isRegisteredLocale(code)) problems.push(`src/template.config.ts description has an entry for "${code}", which is not a registered language.`);
    }
    expectNoProblems(problems, 'Unregistered languages in src/template.config.ts:');
    expect(() => validateI18nSettings(i18n)).not.toThrow();
  });

  it('has a tagline for every offered language, with a fallback to the default', () => {
    const problems = i18n.locales.filter(code => !resolveLocalized(description, code, i18n.defaultLocale).trim()).map(code => `description resolves to empty text for "${code}".`);
    expectNoProblems(problems, 'Missing taglines:');
  });

  it('supports every product currency in Intl', () => {
    const problems: string[] = [];
    for (const code of [currency, ...currencies]) {
      if (!isSupportedCurrency(code)) { problems.push(`currency "${code}" is not an ISO 4217 code supported by Intl in this runtime.`); continue; }
      const digits = new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits;
      if (typeof digits !== 'number' || !Number.isInteger(digits) || digits < 0) problems.push(`currency "${code}" has no usable minor-unit digits (${String(digits)}).`);
    }
    expectNoProblems(problems, 'Unsupported currencies in src/template.config.ts:');
    expect(() => validateCurrencySettings(templateConfig)).not.toThrow();
    expect(currencies).toContain(currency);
  });
});

describe('the gate itself detects broken catalogs', () => {
  const analyze = (code: string, tree: unknown, formatLocale = 'en-US') => analyzeTrees(code, { common: tree }, formatLocale);
  const reference = analyze('en', { title: 'Hello {name}', bag: { one: '{count} item', other: '{count} items' } });

  it('accepts a faithful translation', () => {
    const es = analyze('es', { title: 'Hola {name}', bag: { one: '{count} artículo', many: '{count} de artículos', other: '{count} artículos' } }, 'es-PY');
    expect(es.problems).toEqual([]);
    expect(compareToReference('es', reference.leaves, es.leaves)).toEqual([]);
  });

  it('reports missing keys, extra keys, changed placeholders and plural/text mismatches', () => {
    const broken = analyze('xx', { title: 'Hola {nombre}', extra: 'Sobra', bag: 'solo texto' });
    const problems = compareToReference('xx', reference.leaves, broken.leaves).join('\n');
    expect(problems).toContain('placeholders {nombre} differ from en {name}');
    expect(problems).toContain('xx has common/extra, which does not exist in en');
    expect(problems).toContain('must be plural forms like in en');
    expect(compareToReference('xx', reference.leaves, analyze('xx', { title: 'x {name}' }).leaves).join('\n')).toContain('xx is missing common/bag');
  });

  it('reports empty text, markup, stray braces, Spanish characters in English and bad plurals', () => {
    const problems = analyze('en', {
      blank: '  ', markup: 'Click <b>here</b>', brace: 'Hi {name', accent: 'Añadir', dotted: { 'a.b': 'x' },
      noOther: { one: 'a', few: 'b' }, russian: { one: 'a', other: 'b' }, number: 5, list: ['a'], nothing: {},
    }, 'ru').problems.join('\n');
    expect(problems).toContain('message is empty');
    expect(problems).toContain('contains HTML/markup');
    expect(problems).toContain('stray or malformed brace');
    expect(problems).toContain('contains Spanish characters');
    expect(problems).toContain('contains a dot');
    expect(problems).toContain('has no "other" form');
    expect(problems).toContain('lack "few", "many"');
    expect(problems).toContain('found number');
    expect(problems).toContain('found an array');
    expect(problems).toContain('empty group');
  });

  it('reports unknown and missing namespace files and registers folders explicitly', () => {
    expect(checkFolders('xx', ['common.json', 'stray.json']).join('\n')).toMatch(/lacks src\/i18n\/messages\/xx\/errors\.json[\s\S]*stray\.json is not a known namespace/);
    expect(checkFolders('xx', NAMESPACES.map(namespace => `${namespace}.json`))).toEqual([]);
    expect(isRegisteredLocale('xx')).toBe(false);
  });
});
