import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Language } from './screens';

/**
 * Visible text of the interface, read from the real message catalogs (src/i18n/messages), so the tour
 * finds buttons and headings by the words a visitor sees in either language. A missing key throws.
 * Plural keys are addressed without their category: pass `count` and the right form is picked.
 */
type Tree = { [key: string]: string | Tree };
const catalogs = new Map<string, Tree>();

function catalog(locale: Language, namespace: string): Tree {
  const id = `${locale}/${namespace}`;
  let tree = catalogs.get(id);
  if (!tree) {
    tree = JSON.parse(readFileSync(fileURLToPath(new URL(`../../src/i18n/messages/${id}.json`, import.meta.url)), 'utf8')) as Tree;
    catalogs.set(id, tree);
  }
  return tree;
}

export type Translate = (namespace: string, key: string, values?: Record<string, string | number>) => string;

export function translator(locale: Language): Translate {
  const plural = new Intl.PluralRules(locale);
  return (namespace, key, values = {}) => {
    let node: string | Tree | undefined = catalog(locale, namespace);
    for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined;
    if (typeof node === 'object' && node && 'other' in node) node = node[plural.select(Number(values.count))] ?? node.other;
    if (typeof node !== 'string') throw new Error(`Missing message ${locale}/${namespace}:${key}`);
    return node.replace(/\{(\w+)\}/g, (token, name: string) => (name in values ? String(values[name]) : token));
  };
}

/** Escapes text for a RegExp, for accessible names that start with a message and add a badge or hint. */
export function startingWith(text: string): RegExp {
  return new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
}
