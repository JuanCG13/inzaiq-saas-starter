import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { localeDefinition } from '../../src/i18n/config';
import { templateConfig } from '../../src/template.config';
import { PRODUCT_NAME, PRODUCT_SKU, expectNotFound, message, observeErrors, plainSpaces, startingWith, translated } from './support';

/**
 * Real-browser scenarios for the English/Spanish interface: locale negotiation in the proxy,
 * the language switcher, 404 pages, money formatting, translated admin screens and the rule that
 * APIs always answer in English with stable error codes while the UI words them per language.
 * Visible text comes from the message catalogs (see support.ts), never from copies in this file.
 */

const BASE_URL = 'http://localhost:3000';
const LOCALES = ['en', 'es'] as const;
type Locale = (typeof LOCALES)[number];
const CART_KEY = 'commerce.cart.v1';

interface ApiProduct { id: string; sku: string; priceMinor: number; currency: string; stock: number }

async function storeProduct(request: APIRequestContext): Promise<ApiProduct> {
  const { data } = await (await request.get('/api/store/products')).json();
  const product = data.products.find((item: ApiProduct) => item.sku === PRODUCT_SKU);
  expect(product, `${PRODUCT_SKU} must exist in the demo catalog`).toBeTruthy();
  return product;
}

/** First hop only: the proxy answers with a redirect that is inspected, never followed. */
async function firstHop(request: APIRequestContext, path: string, headers: Record<string, string> = {}) {
  const response = await request.get(path, { maxRedirects: 0, headers });
  const location = response.headers()['location'];
  return { response, location: location ? new URL(location, BASE_URL) : null };
}

async function placeOrder(request: APIRequestContext, product: ApiProduct, label: string) {
  const response = await request.post('/api/store/orders', {
    data: { items: [{ productId: product.id, quantity: 1 }], idempotencyKey: randomUUID(), expectedTotalMinor: product.priceMinor, expectedCurrency: product.currency, customer: { name: `I18n QA ${label}`, email: 'i18n-qa@example.invalid' } },
    headers: { 'x-checkout-protocol': 'hosted-v1' },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).data.order as { id: string };
}

async function addToBagFromCard(page: Page, locale: Locale) {
  await page.getByRole('button', { name: message(locale, 'storefront', 'product.addToBag', { name: PRODUCT_NAME }), exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: message(locale, 'storefront', 'toast.added', { name: PRODUCT_NAME }) })).toBeVisible();
}

async function readBag(page: Page) {
  return page.evaluate(key => localStorage.getItem(key), CART_KEY);
}

test.describe('locale negotiation in the proxy (HTTP level)', () => {
  const cases: Array<{ name: string; headers: Record<string, string>; expected: Locale }> = [
    { name: 'no preference falls back to the installation default', headers: {}, expected: 'en' },
    { name: 'English browsers go to /en', headers: { 'accept-language': 'en-US,en;q=0.9' }, expected: 'en' },
    { name: 'Argentine Spanish maps to /es', headers: { 'accept-language': 'es-AR,es;q=0.9,en;q=0.8' }, expected: 'es' },
    { name: 'the first supported language wins when the preferred one is not offered', headers: { 'accept-language': 'fr-FR,fr;q=0.9,es;q=0.8' }, expected: 'es' },
    { name: 'an unsupported language uses the default', headers: { 'accept-language': 'fr-FR,fr;q=0.9' }, expected: 'en' },
    { name: 'a saved choice beats the browser language (es over en)', headers: { cookie: 'NEXT_LOCALE=es', 'accept-language': 'en-US,en;q=0.9' }, expected: 'es' },
    { name: 'a saved choice beats the browser language (en over es)', headers: { cookie: 'NEXT_LOCALE=en', 'accept-language': 'es-AR,es;q=0.9' }, expected: 'en' },
    { name: 'an invalid saved choice is ignored', headers: { cookie: 'NEXT_LOCALE=zz', 'accept-language': 'es-AR,es;q=0.9' }, expected: 'es' },
  ];
  for (const item of cases) {
    test(item.name, async ({ request }) => {
      const { response, location } = await firstHop(request, '/', item.headers);
      expect(response.status()).toBe(307);
      expect(location?.origin).toBe(BASE_URL);
      expect(location?.pathname).toBe(`/${item.expected}`);
      // The target depends on the visitor, so a shared cache must never reuse it.
      expect(response.headers()['cache-control']).toBe('private, no-store');
      expect(response.headers()['vary']?.toLowerCase()).toContain('accept-language');
      expect(response.headers()['vary']?.toLowerCase()).toContain('cookie');
    });
  }

  test('a nested path keeps its tail and an already prefixed URL is not redirected', async ({ request }) => {
    const nested = await firstHop(request, '/cart', { 'accept-language': 'es-AR,es;q=0.9' });
    expect(nested.response.status()).toBe(307);
    expect(nested.location?.pathname).toBe('/es/cart');
    for (const path of ['/en', '/es', '/en/cart', '/es/cart']) {
      const prefixed = await firstHop(request, path, { 'accept-language': 'es-AR,es;q=0.9' });
      expect(prefixed.response.status(), path).toBe(200);
      expect(prefixed.location, path).toBeNull();
    }
  });
});

test('GET / with the default browser language ends on /en, in English', async ({ page }) => {
  const errors = observeErrors(page);
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  expect(response?.request().redirectedFrom()?.url()).toBe(`${BASE_URL}/`);
  await expect(page).toHaveURL(`${BASE_URL}/en`);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page).toHaveTitle(message('en', 'common', 'meta.title', { brand: templateConfig.name }));
  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading).toContainText(message('en', 'storefront', 'hero.title.line1'));
  await expect(heading).toContainText(message('en', 'storefront', 'hero.title.line2'));
  await expect(page.getByRole('button', { name: message('en', 'storefront', 'product.view', { name: PRODUCT_NAME }), exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: message('en', 'common', 'language.label') })).toHaveValue('en');
  expect(errors).toEqual([]);
});

test.describe('a browser that asks for Argentine Spanish', () => {
  test.use({ locale: 'es-AR' });

  test('GET / ends on /es with the Spanish storefront', async ({ page }) => {
    const errors = observeErrors(page);
    const sent: string[] = [];
    page.on('request', request => { if (request.isNavigationRequest() && request.url() === `${BASE_URL}/`) sent.push(request.headers()['accept-language'] ?? ''); });
    const response = await page.goto('/');
    // The redirect is decided by the header the browser really sent, not by a stub.
    expect(sent[0]).toMatch(/^es-AR/i);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(`${BASE_URL}/es`);
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page).toHaveTitle(message('es', 'common', 'meta.title', { brand: templateConfig.name }));
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toContainText(message('es', 'storefront', 'hero.title.line1'));
    await expect(heading).toContainText(message('es', 'storefront', 'hero.title.line2'));
    // The product name is catalog data written by the merchant, so it is not translated.
    await expect(page.getByRole('button', { name: message('es', 'storefront', 'product.view', { name: PRODUCT_NAME }), exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: message('es', 'common', 'language.label') })).toHaveValue('es');
    expect(errors).toEqual([]);
  });
});

test('the language switcher changes /en to /es, remembers the choice and keeps the bag', async ({ page, context }) => {
  const errors = observeErrors(page);
  await page.goto('/en');
  await addToBagFromCard(page, 'en');
  await expect.poll(() => readBag(page)).not.toBeNull();
  const bag = (await readBag(page))!;
  expect(JSON.parse(bag)).toHaveLength(1);

  await page.getByRole('combobox', { name: message('en', 'common', 'language.label') }).selectOption('es');
  await expect(page).toHaveURL(`${BASE_URL}/es`);
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(message('es', 'storefront', 'hero.title.line1'));

  const cookie = (await context.cookies()).find(item => item.name === 'NEXT_LOCALE');
  expect(cookie).toMatchObject({ value: 'es', path: '/', sameSite: 'Lax' });
  expect(cookie!.expires).toBeGreaterThan(Date.now() / 1000 + 360 * 24 * 3600);

  // The bag lives in localStorage of the same origin, so the full navigation must not lose it.
  await expect(page.getByRole('link', { name: message('es', 'common', 'header.bagCount.one', { count: 1 }) })).toBeVisible();
  await expect.poll(() => readBag(page)).toBe(bag);

  // The saved choice now beats the browser's English Accept-Language on every unprefixed URL.
  await page.goto('/');
  await expect(page).toHaveURL(`${BASE_URL}/es`);
  await page.goto('/cart');
  await expect(page).toHaveURL(`${BASE_URL}/es/cart`);
  await expect(page.getByRole('heading', { name: new RegExp(`^${message('es', 'cart', 'heading.title')}`) })).toBeVisible();
  await expect(page.getByRole('heading', { name: PRODUCT_NAME, exact: true })).toBeVisible();

  // Query string and hash are kept when switching on a deeper page, and the choice can be reverted.
  await page.goto('/es/cart?cancelled=1#top');
  await page.getByRole('combobox', { name: message('es', 'common', 'language.label') }).selectOption('en');
  await expect(page).toHaveURL(`${BASE_URL}/en/cart?cancelled=1#top`);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  expect((await context.cookies()).find(item => item.name === 'NEXT_LOCALE')?.value).toBe('en');
  await page.goto('/');
  await expect(page).toHaveURL(`${BASE_URL}/en`);
  await expect.poll(() => readBag(page)).toBe(bag);
  expect(errors).toEqual([]);
});

test.describe('an unprefixed query string survives the redirect', () => {
  const query = '?client_id=x&sig=y';

  test('at the HTTP level, in both languages and with encoded and repeated values', async ({ request }) => {
    const english = await firstHop(request, `/sign-in${query}`);
    expect(english.response.status()).toBe(307);
    expect(english.location?.pathname).toBe('/en/sign-in');
    expect(english.location?.search).toBe(query);

    const spanish = await firstHop(request, `/sign-in${query}`, { cookie: 'NEXT_LOCALE=es' });
    expect(spanish.location?.pathname).toBe('/es/sign-in');
    expect(spanish.location?.search).toBe(query);

    // Next.js re-serializes the Location query (a space may become "+", repeated names are grouped), so the
    // guarantee is that every decoded name/value pair arrives unchanged. The OAuth provider verifies its
    // signature over the decoded, canonicalized parameters, never over the raw text.
    const signed = '?client_id=x&scope=openid%20profile&redirect_uri=https%3A%2F%2Fclient.example%2Fcb%3Fa%3D1&state=a%2Bb&sig=AbC-_%3D&scope=email';
    const encoded = await firstHop(request, `/consent${signed}`, { cookie: 'NEXT_LOCALE=es' });
    expect(encoded.location?.pathname).toBe('/es/consent');
    const pairs = (search: string) => [...new URLSearchParams(search)].map(([name, value]) => `${name}=${value}`).sort();
    expect(pairs(encoded.location!.search)).toEqual(pairs(signed));
    expect(pairs(signed)).toContain('state=a+b');
  });

  test('in the browser, and the sign-in page keeps the parameters for the OAuth continuation', async ({ page, context }) => {
    const errors = observeErrors(page);
    await page.goto(`/sign-in${query}`);
    await expect(page).toHaveURL(`${BASE_URL}/en/sign-in${query}`);
    await expect(page.getByRole('heading', { level: 1, name: message('en', 'auth', 'signIn.title.signIn') })).toBeVisible();

    await context.addCookies([{ name: 'NEXT_LOCALE', value: 'es', url: BASE_URL }]);
    await page.goto(`/sign-in${query}`);
    await expect(page).toHaveURL(`${BASE_URL}/es/sign-in${query}`);
    await expect(page.getByRole('heading', { level: 1, name: message('es', 'auth', 'signIn.title.signIn') })).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('unknown URLs', () => {
  const notFound = (locale: Locale) => ({
    title: message(locale, 'common', 'boundaries.notFound.title'),
    action: message(locale, 'common', 'boundaries.notFound.action'),
  });

  for (const path of ['/xx/anything', '/fr']) {
    test(`${path} is a real 404 page (the unknown prefix is treated as part of the path)`, async ({ page }) => {
      const errors = observeErrors(page, { expectedFailures: expectNotFound(`/en${path}`) });
      const response = await page.goto(path);
      // The proxy gives an unprefixed URL the default language; there the path matches nothing.
      expect(response?.status()).toBe(404);
      expect(response?.request().redirectedFrom()?.url()).toBe(`${BASE_URL}${path}`);
      await expect(page).toHaveURL(`${BASE_URL}/en${path}`);
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(page.getByRole('heading', { level: 1, name: notFound('en').title })).toBeVisible();
      expect(errors).toEqual([]);
    });
  }

  for (const locale of LOCALES) {
    test(`/${locale}/nope shows the translated 404 with a link back to the store`, async ({ page, request }) => {
      const errors = observeErrors(page, { expectedFailures: expectNotFound(`/${locale}/nope`) });
      expect((await request.get(`/${locale}/nope`)).status()).toBe(404);
      const response = await page.goto(`/${locale}/nope`);
      expect(response?.status()).toBe(404);
      await expect(page).toHaveURL(`${BASE_URL}/${locale}/nope`);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.getByRole('heading', { level: 1, name: notFound(locale).title })).toBeVisible();
      await expect(page.getByText(message(locale, 'common', 'boundaries.notFound.eyebrow'), { exact: true })).toBeVisible();
      // Next.js' own English fallback must not appear: this page is the localized one.
      await expect(page.getByText('This page could not be found')).toHaveCount(0);
      await expect(page.getByRole('link', { name: notFound(locale).action })).toHaveAttribute('href', `/${locale}`);
      expect(errors).toEqual([]);
    });
  }

  test('nested unknown paths under a language prefix are also translated 404s', async ({ page }) => {
    const paths = ['/es/admin/nope', '/en/cart/a/b/c', '/es/checkout/nothing'];
    const errors = observeErrors(page, { expectedFailures: expectNotFound(...paths) });
    for (const path of paths) {
      const locale = path.startsWith('/es') ? 'es' : 'en';
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
      await expect(page.locator('html'), path).toHaveAttribute('lang', locale);
      await expect(page.getByRole('heading', { level: 1, name: notFound(locale).title }), path).toBeVisible();
    }
    expect(errors).toEqual([]);
  });

  test('the translated 404 differs between languages', () => {
    translated('common', 'boundaries.notFound.title');
    translated('common', 'boundaries.notFound.action');
  });
});

test.describe('prices follow the default currency and the active language', () => {
  const usd = (locale: Locale, amount: number) => plainSpaces(new Intl.NumberFormat(localeDefinition(locale)!.formatLocale, { style: 'currency', currency: 'USD' }).format(amount));

  test('USD is the default product currency in the admin product editor', async ({ page, request }) => {
    const errors = observeErrors(page);
    expect(templateConfig.currency).toBe('USD');
    await page.goto('/en/admin');
    await page.getByRole('navigation', { name: message('en', 'admin', 'shell.navLabel') }).getByRole('button', { name: message('en', 'admin', 'nav.products'), exact: true }).click();
    await page.getByRole('button', { name: message('en', 'admin', 'products.newProduct') }).click();
    const dialog = page.getByRole('dialog');
    const currency = dialog.getByLabel(message('en', 'admin', 'editor.fields.currency'));
    await expect(currency).toHaveValue('USD');
    const options = (await currency.locator('option').allTextContents()).map(text => text.trim());
    // The configured list, default first, with no duplicate of the default.
    expect(options).toEqual(['USD', ...templateConfig.currencies.filter(code => code !== 'USD')]);
    expect(options.length).toBeGreaterThan(1);
    expect(options[0]).toBe('USD');

    // A price typed in the default currency becomes integer minor units on the server.
    const sku = `I18N-USD-${Date.now()}`;
    await dialog.getByLabel(message('en', 'admin', 'editor.fields.name')).fill('I18n currency check');
    await dialog.getByLabel(message('en', 'admin', 'editor.fields.sku')).fill(sku);
    await dialog.getByLabel(message('en', 'admin', 'editor.fields.price')).fill('12.34');
    const created = page.waitForResponse(response => response.url().endsWith('/api/admin/products') && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: message('en', 'admin', 'editor.create') }).click();
    const response = await created;
    expect(response.status()).toBe(201);
    const product = (await response.json()).data.product as { id: string; version: number; priceMinor: number; currency: string };
    try {
      expect(product).toMatchObject({ priceMinor: 1234, currency: 'USD' });
      await expect(page.getByRole('row').filter({ hasText: sku })).toContainText('$12.34');
    } finally {
      // Hide the check product so it never appears on the storefront of later tests.
      expect((await request.patch(`/api/admin/products/${product.id}`, { data: { version: product.version, active: false } })).status()).toBe(200);
    }
    expect(errors).toEqual([]);
  });

  test('the storefront shows $29.00 in /en and the Spanish format in /es', async ({ page }) => {
    const errors = observeErrors(page);
    const english = usd('en', 29);
    const spanish = usd('es', 29);
    expect(english).toBe('$29.00');
    // Whatever the Spanish ICU data produces, it is not the English string and uses the decimal comma.
    expect(spanish).not.toBe(english);
    expect(spanish).toMatch(/29,00$/);

    for (const [locale, expected] of [['en', english], ['es', spanish]] as const) {
      await page.goto(`/${locale}`);
      // The page is formatted by the browser's own Intl; it must agree with the expected string.
      const browser = await page.evaluate(([tag]) => new Intl.NumberFormat(tag, { style: 'currency', currency: 'USD' }).format(29).replace(/[\s\u00a0\u202f]+/g, ' '), [localeDefinition(locale)!.formatLocale]);
      expect(browser, `browser ICU for ${locale}`).toBe(expected);
      const card = page.getByRole('article').filter({ hasText: PRODUCT_NAME });
      await expect(card.locator('.product-price')).toHaveText(expected);
      await page.getByRole('button', { name: message(locale, 'storefront', 'product.view', { name: PRODUCT_NAME }), exact: true }).click();
      await expect(page.getByRole('dialog').locator('.detail-price')).toHaveText(expected);
      await page.keyboard.press('Escape');
    }

    // The cart total is formatted the same way as the card the item came from.
    await page.goto('/es');
    await addToBagFromCard(page, 'es');
    await page.goto('/es/cart');
    await expect(page.locator('.summary-total strong')).toHaveText(spanish);
    await page.goto('/en/cart');
    await expect(page.locator('.summary-total strong')).toHaveText(english);
    expect(errors).toEqual([]);
  });

  test('the admin product table formats the same price per language', async ({ page }) => {
    const errors = observeErrors(page);
    for (const locale of LOCALES) {
      await page.goto(`/${locale}/admin`);
      await page.getByRole('navigation', { name: message(locale, 'admin', 'shell.navLabel') }).getByRole('button', { name: message(locale, 'admin', 'nav.products'), exact: true }).click();
      await expect(page.getByRole('row').filter({ hasText: PRODUCT_SKU })).toContainText(usd(locale, 29));
    }
    expect(errors).toEqual([]);
  });
});

test('the Spanish admin renders Spanish navigation and order status pills', async ({ page, request }) => {
  const errors = observeErrors(page);
  const product = await storeProduct(request);
  const pending = await placeOrder(request, product, 'pending');
  const completed = await placeOrder(request, product, 'completed');
  const toCancel = await placeOrder(request, product, 'cancel');
  const created = [pending, completed, toCancel];
  try {
    expect((await request.patch(`/api/admin/orders/${completed.id}`, { data: { status: 'completed' } })).status()).toBe(200);

    await page.goto('/es/admin');
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    const nav = page.getByRole('navigation', { name: message('es', 'admin', 'shell.navLabel') });
    for (const view of ['overview', 'products', 'orders', 'agents', 'settings']) {
      await expect(nav.getByRole('button', { name: startingWith(translated('admin', `nav.${view}`).es) })).toBeVisible();
      await expect(nav.getByRole('button', { name: startingWith(message('en', 'admin', `nav.${view}`)) })).toHaveCount(0);
    }
    await expect(page.getByRole('heading', { level: 1, name: message('es', 'admin', 'views.overview.title') })).toBeVisible();

    await nav.getByRole('button', { name: message('es', 'admin', 'nav.orders'), exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: message('es', 'admin', 'views.orders.title') })).toBeVisible();
    for (const status of ['pending', 'completed', 'cancelled'] as const) {
      await expect(page.getByRole('button', { name: message('es', 'admin', `orders.filters.${status}`), exact: true })).toBeVisible();
    }
    const row = (order: { id: string }) => page.getByRole('row').filter({ hasText: `#${order.id.slice(-8)}` });
    await expect(row(pending).getByText(message('es', 'admin', 'orderStatus.pending'), { exact: true })).toBeVisible();
    await expect(row(completed).getByText(message('es', 'admin', 'orderStatus.completed'), { exact: true })).toBeVisible();

    // The native confirmation is worded in Spanish too, and the result is a Spanish "cancelled" pill.
    await row(toCancel).getByRole('button', { name: message('es', 'admin', 'orders.view') }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: message('es', 'admin', 'orders.detail.confirm'), exact: true })).toBeVisible();
    let confirmation = '';
    page.once('dialog', native => { confirmation = native.message(); void native.accept(); });
    const changed = page.waitForResponse(response => response.url().endsWith(`/api/admin/orders/${toCancel.id}`) && response.request().method() === 'PATCH');
    await dialog.getByRole('button', { name: message('es', 'admin', 'orders.detail.cancel'), exact: true }).click();
    expect((await changed).status()).toBe(200);
    expect(confirmation).toBe(message('es', 'admin', 'orders.detail.confirmCancelled'));
    await expect(row(toCancel).getByText(message('es', 'admin', 'orderStatus.cancelled'), { exact: true })).toBeVisible();

    // No status falls back to the raw English code.
    for (const code of ['pending', 'completed', 'cancelled']) await expect(page.locator('.status-pill', { hasText: new RegExp(`^${code}$`) })).toHaveCount(0);
    await expect(page.getByText('Orders', { exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    // Pending orders hold stock; cancelling returns it. A completed order cannot be reverted.
    for (const order of created) await request.patch(`/api/admin/orders/${order.id}`, { data: { status: 'cancelled' } });
  }
});

for (const locale of LOCALES) {
  test(`no page error, console error or hydration warning on any page in ${locale}`, async ({ page }) => {
    test.setTimeout(300_000);
    // Expected, and the only ones: the deliberate 404 page, and the auth API's 401 for a visitor without a session.
    const errors = observeErrors(page, { expectedFailures: [...expectNotFound(`/${locale}/nope`), { status: 401, path: '/api/auth/organization/list' }] });
    const language = (path: string) => `/${locale}${path}`;
    const heading = (namespace: 'storefront' | 'cart' | 'auth' | 'common', key: string) => page.getByRole('heading', { level: 1 }).filter({ hasText: message(locale, namespace, key) });
    const settled = async () => { await page.waitForLoadState('networkidle'); await expect(page.locator('html')).toHaveAttribute('lang', locale); };

    // Storefront with the grid loaded, then the product detail dialog.
    await page.goto(language(''));
    await expect(page.getByRole('button', { name: message(locale, 'storefront', 'product.view', { name: PRODUCT_NAME }), exact: true })).toBeVisible();
    await page.getByRole('button', { name: message(locale, 'storefront', 'product.view', { name: PRODUCT_NAME }), exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('button', { name: message(locale, 'storefront', 'detail.add') })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: message(locale, 'storefront', 'detail.add') }).click();
    await page.getByRole('dialog').getByRole('link', { name: message(locale, 'storefront', 'detail.goToBag') }).click();
    await expect(page).toHaveURL(`${BASE_URL}${language('/cart')}`);

    // Cart with a product, the empty cart and the checkout return page.
    await expect(page.getByLabel(message(locale, 'cart', 'customer.name'))).toBeVisible();
    await expect(heading('cart', 'heading.title')).toBeVisible();
    await settled();
    await page.evaluate(key => localStorage.removeItem(key), CART_KEY);
    await page.reload();
    await expect(page.getByRole('heading', { name: message(locale, 'cart', 'empty.title') })).toBeVisible();
    await settled();
    await page.goto(language('/checkout/return'));
    await expect(page.getByText(message(locale, 'cart', 'paymentReturn.noReference'))).toBeVisible();
    await settled();

    // Every admin view.
    await page.goto(language('/admin'));
    const nav = page.getByRole('navigation', { name: message(locale, 'admin', 'shell.navLabel') });
    for (const view of ['overview', 'products', 'orders', 'agents', 'settings'] as const) {
      await nav.getByRole('button', { name: startingWith(message(locale, 'admin', `nav.${view}`)) }).click();
      await expect(page.getByRole('heading', { level: 1, name: message(locale, 'admin', `views.${view}.title`) })).toBeVisible();
    }
    await expect(page.getByRole('heading', { name: message(locale, 'runtime', 'settings.title') })).toBeVisible();
    await settled();

    // Authentication pages, including the invalid OAuth consent link rendered on the server.
    await page.goto(language('/sign-in'));
    await expect(heading('auth', 'signIn.title.signIn')).toBeVisible();
    await page.getByRole('button', { name: message(locale, 'auth', 'signIn.toggle.toCreate') }).click();
    await expect(heading('auth', 'signIn.title.create')).toBeVisible();
    await settled();
    await page.goto(language('/consent?client_id=x&sig=y'));
    await expect(page.getByRole('heading', { level: 1, name: message(locale, 'auth', 'consent.invalid.title') })).toBeVisible();
    await settled();
    // Without a session the onboarding pages send the visitor back to sign-in, in the same language. The first
    // visit also compiles the page and the auth API in `next dev`, so allow far more than the default 15 s.
    for (const path of ['/onboarding', '/onboarding/connections']) {
      await page.goto(language(path));
      await expect(page).toHaveURL(`${BASE_URL}${language('/sign-in')}`, { timeout: 90_000 });
      await expect(heading('auth', 'signIn.title.signIn')).toBeVisible();
      await settled();
    }

    // Unknown path: the 404 itself must not log errors either.
    await page.goto(language('/nope'));
    await expect(heading('common', 'boundaries.notFound.title')).toBeVisible();
    await settled();
    expect(errors).toEqual([]);
  });
}

test.describe('APIs are not touched by the language proxy', () => {
  test('health, catalog and static files answer directly, whatever the language headers say', async ({ request }) => {
    const headers = { cookie: 'NEXT_LOCALE=es', 'accept-language': 'es-AR,es;q=0.9' };
    const health = await request.get('/api/health', { maxRedirects: 0, headers });
    expect(health.status()).toBe(200);
    expect(health.headers()['location']).toBeUndefined();
    expect(await health.json()).toMatchObject({ status: 'ok' });

    const products = await request.get('/api/store/products', { maxRedirects: 0, headers });
    expect(products.status()).toBe(200);
    expect(products.headers()['location']).toBeUndefined();
    // Catalog data is merchant content, returned as stored.
    expect((await products.json()).data.products.map((item: { name: string }) => item.name)).toContain(PRODUCT_NAME);

    // /favicon.ico is the browsers' implicit icon probe; it must not be a 404 (see rewrites in next.config.ts).
    for (const path of ['/demo/tee.svg', '/icon.svg', '/favicon.ico']) {
      const file = await request.get(path, { maxRedirects: 0, headers });
      expect(file.status(), path).toBe(200);
      expect(file.headers()['content-type'], path).toContain('image/svg+xml');
    }

    // An unknown API path is a plain 404, not a localized page and not a redirect.
    const missing = await request.get('/api/nope', { maxRedirects: 0, headers });
    expect(missing.status()).toBe(404);
    expect(missing.headers()['location']).toBeUndefined();
    // OAuth discovery lives outside the language prefix by design.
    const discovery = await request.get('/.well-known/oauth-authorization-server', { maxRedirects: 0, headers });
    expect(discovery.status()).not.toBe(307);
    expect(discovery.headers()['location'] ?? '').not.toMatch(/\/(en|es)\//);
  });

  test('API errors stay English with a stable code even when the caller asks for Spanish', async ({ request }) => {
    const spanishHeaders = { 'accept-language': 'es-AR,es;q=0.9', cookie: 'NEXT_LOCALE=es', 'x-checkout-protocol': 'hosted-v1' };
    const invalid = await request.post('/api/store/orders', { data: {}, headers: spanishHeaders });
    expect(invalid.status()).toBe(400);
    const body = await invalid.json();
    expect(body.error.code).toBe('INVALID_INPUT');
    expect(body.error.message).toBe(message('en', 'errors', 'codes.INVALID_INPUT'));
    expect(body.error.message).not.toBe(message('es', 'errors', 'codes.INVALID_INPUT'));
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/i);

    const missing = await request.get(`/api/store/products/${randomUUID()}`, { headers: spanishHeaders });
    expect(missing.status()).toBe(404);
    const notFound = (await missing.json()).error;
    expect(notFound.code).toBe('NOT_FOUND');
    expect(notFound.message).not.toBe(message('es', 'errors', 'codes.NOT_FOUND'));
  });

  for (const locale of LOCALES) {
    test(`paused orders: the API says ORDERS_PAUSED in English and the ${locale} UI words it from errors.json`, async ({ page, request }) => {
      // The refused order is the point of this test, so Chromium's console line for that 409 is expected.
      const errors = observeErrors(page, { expectedFailures: [{ status: 409, path: '/api/store/orders' }] });
      const initial = (await (await request.get('/api/admin/settings')).json()).data.settings;
      const product = await storeProduct(request);
      const failure = { en: message('en', 'errors', 'codes.ORDERS_PAUSED'), shown: message(locale, 'errors', 'codes.ORDERS_PAUSED') };
      try {
        expect((await request.patch('/api/admin/settings', { data: { ...initial, acceptingOrders: false, notice: '' } })).status()).toBe(200);

        // The wire contract: HTTP 409, a stable code and an English message, whatever language is asked for.
        const orderInput = { items: [{ productId: product.id, quantity: 1 }], idempotencyKey: randomUUID(), expectedTotalMinor: product.priceMinor, expectedCurrency: product.currency, customer: { name: 'Paused QA', email: 'paused-qa@example.invalid' } };
        const denied = await request.post('/api/store/orders', { data: orderInput, headers: { 'x-checkout-protocol': 'hosted-v1', 'accept-language': locale === 'es' ? 'es-AR,es;q=0.9' : 'en-US' } });
        expect(denied.status()).toBe(409);
        const { error } = await denied.json();
        expect(error.code).toBe('ORDERS_PAUSED');
        expect(error.message).toBe(failure.en);

        // A screen that was opened before the pause still offers the button; the server refuses and the UI words it.
        await page.route('**/api/store/settings', route => route.fulfill({ json: { data: { settings: { version: 1, acceptingOrders: true, notice: '' } } } }));
        await page.goto(`/${locale}`);
        await addToBagFromCard(page, locale);
        await page.goto(`/${locale}/cart`);
        await page.getByLabel(message(locale, 'cart', 'customer.name')).fill('Paused QA');
        await page.getByLabel(message(locale, 'cart', 'customer.email'), { exact: true }).fill('paused-qa@example.invalid');
        const submitted = page.waitForResponse(response => response.url().endsWith('/api/store/orders') && response.request().method() === 'POST');
        await page.getByRole('button', { name: message(locale, 'cart', 'checkout.placeOrder'), exact: true }).click();
        const refused = await submitted;
        expect(refused.status()).toBe(409);
        expect((await refused.json()).error.code).toBe('ORDERS_PAUSED');
        const alert = page.getByRole('alert').filter({ hasText: failure.shown });
        await expect(alert).toBeVisible();
        if (locale === 'es') await expect(page.getByText(failure.en)).toHaveCount(0);
        // The refused order reserved nothing.
        expect((await (await request.get(`/api/store/products/${product.id}`)).json()).data.product.stock).toBe(product.stock);

        // With the real settings, the open page shows the paused notice in its own language.
        await page.unroute('**/api/store/settings');
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await expect(page.getByRole('status').filter({ hasText: message(locale, 'runtime', 'notice.paused') })).toBeVisible();
        expect(errors).toEqual([]);
      } finally {
        const current = (await (await request.get('/api/admin/settings')).json()).data.settings;
        expect((await request.patch('/api/admin/settings', { data: { ...initial, version: current.version } })).status()).toBe(200);
      }
    });
  }
});
