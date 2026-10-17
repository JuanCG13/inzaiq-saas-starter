import type { Namespace } from './config';

/** Plural categories understood by Intl.PluralRules. `other` is mandatory. */
export const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;
export type PluralCategory = (typeof PLURAL_CATEGORIES)[number];
export type PluralForms = { other: string } & Partial<Record<Exclude<PluralCategory, 'other'>, string>>;

export type MessageNode = string | PluralForms | { [key: string]: MessageNode };
export type MessageTree = { [key: string]: MessageNode };
export type MessageValues = Record<string, string | number>;

/** Shape of every namespace file; the English files are the source of truth for keys. */
export interface Messages {
  common: typeof import('./messages/en/common.json');
  errors: typeof import('./messages/en/errors.json');
  runtime: typeof import('./messages/en/runtime.json');
  storefront: typeof import('./messages/en/storefront.json');
  cart: typeof import('./messages/en/cart.json');
  admin: typeof import('./messages/en/admin.json');
  auth: typeof import('./messages/en/auth.json');
}
export type LoadedMessages = Partial<{ [N in Namespace]: Messages[N] }>;

type IsPluralKeys<T> = keyof T extends PluralCategory ? true : false;
/** Dot-separated paths to every string or plural leaf of a namespace. */
export type KeyPath<T> = {
  [K in keyof T & string]: T[K] extends string
    ? K
    : T[K] extends PluralForms
      ? IsPluralKeys<T[K]> extends true ? K : `${K}.${KeyPath<T[K]>}`
      : T[K] extends object ? `${K}.${KeyPath<T[K]>}` : never;
}[keyof T & string];

export interface Translator<N extends Namespace = Namespace> {
  (key: KeyPath<Messages[N]>, values?: MessageValues): string;
  /** True when the key exists; use for keys built at runtime, such as error codes. */
  has(key: string): boolean;
}

export function isPluralForms(node: unknown): node is PluralForms {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return false;
  const keys = Object.keys(node);
  return keys.length > 0 && 'other' in node && keys.every(key => (PLURAL_CATEGORIES as readonly string[]).includes(key) && typeof (node as Record<string, unknown>)[key] === 'string');
}

export function lookup(tree: MessageTree | undefined, key: string): MessageNode | undefined {
  let node: MessageNode | undefined = tree;
  for (const part of key.split('.')) {
    if (!node || typeof node === 'string' || isPluralForms(node)) return undefined;
    node = (node as MessageTree)[part];
  }
  return node;
}

/**
 * Replaces {name} placeholders. Numbers are grouped for the locale (1500 -> 1,500 or 1.500); pass a string
 * for a value that must stay verbatim. An unknown placeholder stays visible instead of printing "undefined".
 */
export function interpolate(template: string, values?: MessageValues, formatLocale?: string): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (token, name: string) => {
    if (!(name in values)) return token;
    const value = values[name]!;
    return typeof value === 'number' && formatLocale ? new Intl.NumberFormat(formatLocale).format(value) : String(value);
  });
}

export function render(node: MessageNode | undefined, key: string, formatLocale: string, values?: MessageValues): string {
  if (typeof node === 'string') return interpolate(node, values, formatLocale);
  if (isPluralForms(node)) {
    const count = Number(values?.count);
    const category = Number.isFinite(count) ? new Intl.PluralRules(formatLocale).select(count) : 'other';
    return interpolate(node[category] ?? node.other, values, formatLocale);
  }
  return key;
}

export function createTranslator<N extends Namespace>(tree: MessageTree | undefined, formatLocale: string): Translator<N> {
  const has = (key: string) => { const node = lookup(tree, key); return typeof node === 'string' || isPluralForms(node); };
  const translate = (key: string, values?: MessageValues) => render(lookup(tree, key), key, formatLocale, values);
  return Object.assign(translate, { has }) as unknown as Translator<N>;
}

/** Overlays `override` on `base` key by key, so a partially translated locale falls back to the default language. */
export function mergeMessages<T extends MessageTree>(base: T | undefined, override: MessageTree | undefined): T {
  if (!base) return (override ?? {}) as T;
  if (!override) return base;
  const merged: MessageTree = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = merged[key];
    merged[key] = current && typeof current === 'object' && !isPluralForms(current) && typeof value === 'object' && !isPluralForms(value)
      ? mergeMessages(current as MessageTree, value as MessageTree)
      : value;
  }
  return merged as T;
}
