import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';

/**
 * Helpers shared by the browser specs. This file is not a spec: Playwright only runs *.spec.ts.
 * Visible text comes from the real message catalogs (src/i18n/messages) so a copy edit never
 * leaves a stale string in a test, while a missing translation still fails.
 */

const BASE_URL = 'http://localhost:3000';

export const PRODUCT_NAME = 'Essential tee';
export const PRODUCT_SKU = 'NOMA-TEE-01';

/** A resource that a test knows will fail, such as the 404 document it opens on purpose. */
export interface ExpectedFailure { status: number; path: string }

/** Shorthand for the 404 documents a test opens to check a not-found page. */
export function expectNotFound(...paths: string[]): ExpectedFailure[] {
  return paths.map(path => ({ status: 404, path }));
}

/**
 * Collects uncaught exceptions, console errors from the app's own origin and hydration warnings.
 *
 * Chromium logs "Failed to load resource ... status of 404" for every failed request, including the
 * 404 document of a page the test opens deliberately, or the 401 that an anonymous visitor gets from
 * the auth API before being sent to sign-in. `expectedFailures` silences exactly that message (same
 * status, same URL path); any other failed script, image or API call is still reported.
 */
export function observeErrors(page: Page, { expectedFailures = [] }: { expectedFailures?: ExpectedFailure[] } = {}) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    const origin = message.location().url;
    const own = !origin || origin.startsWith(BASE_URL);
    const status = /status of (\d{3})/.exec(message.text())?.[1];
    const expected = status !== undefined && expectedFailures.some(failure => failure.status === Number(status) && origin === `${BASE_URL}${failure.path}`);
    if (message.type() === 'error' && own && !expected) errors.push(`console.error: ${message.text()}`);
    // React reports recoverable hydration mismatches as errors in development, but older paths warn.
    if (message.type() === 'warning' && /hydrat|did not match|server rendered/i.test(message.text())) errors.push(`console.warning: ${message.text()}`);
  });
  return errors;
}

export async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

type Tree = { [key: string]: string | Tree };
const catalogs = new Map<string, Tree>();

function catalog(locale: string, namespace: string): Tree {
  const id = `${locale}/${namespace}`;
  let tree = catalogs.get(id);
  if (!tree) {
    tree = JSON.parse(readFileSync(fileURLToPath(new URL(`../../src/i18n/messages/${id}.json`, import.meta.url)), 'utf8')) as Tree;
    catalogs.set(id, tree);
  }
  return tree;
}

/**
 * Text of a message key in a locale, with {placeholders} replaced. Plural keys are addressed with
 * their category, for example `header.bagCount.one`. Throws when the key does not exist.
 */
export function message(locale: 'en' | 'es', namespace: string, key: string, values: Record<string, string | number> = {}): string {
  let node: string | Tree | undefined = catalog(locale, namespace);
  for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined;
  if (typeof node !== 'string') throw new Error(`Missing message ${locale}/${namespace}:${key}`);
  return node.replace(/\{(\w+)\}/g, (token, name: string) => (name in values ? String(values[name]) : token));
}

/** Text in the visitor's language, plus a check that the Spanish catalog really differs from English. */
export function translated(namespace: string, key: string, values: Record<string, string | number> = {}) {
  const en = message('en', namespace, key, values);
  const es = message('es', namespace, key, values);
  expect(es, `${namespace}:${key} must be translated, not copied from English`).not.toBe(en);
  return { en, es };
}

/** Intl pads currency with no-break spaces (U+00A0, U+202F); compare with ordinary spaces. */
export function plainSpaces(text: string) {
  return text.replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Matches an accessible name that starts with `text`, for controls that append a badge ("My agent MCP"). */
export function startingWith(text: string) {
  return new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
}
