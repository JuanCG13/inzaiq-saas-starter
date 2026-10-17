import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { localizePath } from '../../src/i18n/routing';
import { translator, startingWith } from './messages';
import { IMAGE, VIEWPORTS, imagePath, screenList, type Language, type ScreenId, type ViewportName } from './screens';

/**
 * Documentation screenshot tour: one dev server, one browser, one context per viewport.
 *
 * Every state is reached with the product's own UI and APIs: customers place orders through the
 * storefront, the owner completes and cancels them in the admin, the account is created in the sign-in
 * form and the OAuth consent is reached with a dynamically registered client and PKCE. Nothing is mocked
 * and the DOM is never edited. The only deviations are listed in docs/screenshots/PROVENANCE.md.
 *
 * Images are encoded by Chromium itself (CDP Page.captureScreenshot), so the format is a manifest setting.
 *   SCREENSHOT_LOCALE=es       run against the Spanish interface and write docs/screenshots/es/ (not committed)
 *   SCREENSHOT_PROBE_DIR=dir   also write PNG / WebP q85 / WebP q92 of three screens there, to compare formats
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ORIGIN = 'http://localhost:3000';
const LOCALE: Language = (() => {
  const value = process.env.SCREENSHOT_LOCALE ?? 'en';
  if (value !== 'en' && value !== 'es') throw new Error(`SCREENSHOT_LOCALE must be en or es, got "${value}"`);
  return value;
})();
const PROBE_DIR = process.env.SCREENSHOT_PROBE_DIR;
const PROBE_IDS: readonly ScreenId[] = ['storefront-collection', 'admin-orders', 'consent'];
const OUT_DIR = path.join(ROOT, 'docs', 'screenshots', LOCALE);

const t = translator(LOCALE);
const at = (route: string) => localizePath(route, LOCALE);
const definitions = new Map(screenList.map(screen => [screen.id, screen]));

/** Fictional people on the reserved .invalid domain (RFC 2606); 555-01xx numbers are reserved for fiction. */
const customers = {
  ada: { name: 'Ada Example', email: 'ada.example@example.invalid', phone: '+1 555 0101', address: '12 Sample Street, Exampleville' },
  grace: { name: 'Grace Sample', email: 'grace.sample@example.invalid', phone: '', address: '' },
  linus: { name: 'Linus Placeholder', email: 'linus.placeholder@example.invalid', phone: '', address: '' },
};
const owner = { name: 'Olivia Owner', email: 'olivia.owner@example.invalid', password: 'demo-passphrase-2026' };
const business = { name: 'NOMA Studio', slug: 'noma-studio' };

interface SavedOrder { id: string; totalMinor: number }
const results: Array<{ id: string; bytes: number }> = [];
const problems: string[] = [];

/**
 * Application defects the tour met and reports instead of hiding. They are matched exactly, so any other
 * console error still fails the run, and they are printed at the end of every run in which they occur.
 */
const KNOWN_APP_ISSUES: Array<{ pattern: RegExp; summary: string }> = [
  {
    pattern: /Pattern attribute value \[a-z0-9-\]\{3,60\} is not a valid regular expression/,
    summary: 'src/app/[lang]/onboarding/page.tsx: pattern="[a-z0-9-]{3,60}" is invalid under the regular-expression "v" flag browsers use for the pattern attribute (escape the hyphen), so Chromium logs an error and skips the check.',
  },
];
const knownIssues = new Set<string>();

function contextOptions(name: ViewportName) {
  return {
    baseURL: ORIGIN,
    viewport: VIEWPORTS[name],
    deviceScaleFactor: 1,
    isMobile: name === 'mobile',
    hasTouch: name === 'mobile',
    locale: LOCALE === 'es' ? 'es-ES' : 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'light' as const,
    reducedMotion: 'reduce' as const,
  };
}

/** Records uncaught errors and failed same-origin requests, so the tour never documents a broken page. */
function watch(page: Page, label: string, expected: Array<{ status: number; path: string }> = []) {
  page.on('pageerror', error => problems.push(`${label} pageerror: ${error.message}`));
  page.on('console', message => {
    const where = message.location().url;
    const own = !where || where.startsWith(ORIGIN);
    const status = /status of (\d{3})/.exec(message.text())?.[1];
    const allowed = status !== undefined && expected.some(item => item.status === Number(status) && where === `${ORIGIN}${item.path}`);
    const known = KNOWN_APP_ISSUES.find(issue => issue.pattern.test(message.text()));
    if (message.type() === 'error' && known) knownIssues.add(known.summary);
    else if (message.type() === 'error' && own && !allowed) problems.push(`${label} console.error: ${message.text()}`);
    if (message.type() === 'warning' && /hydrat|did not match|server rendered/i.test(message.text())) problems.push(`${label} console.warning: ${message.text()}`);
  });
}

/** Parks the pointer, drops focus (no caret or focus ring) and waits for fonts and visible images. */
async function settle(page: Page) {
  await page.mouse.move(1, 1);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.waitForFunction(() => [...document.images].filter(image => {
    const box = image.getBoundingClientRect();
    return box.bottom > 0 && box.right > 0 && box.top < innerHeight && box.left < innerWidth;
  }).every(image => image.complete));
  await page.evaluate(() => document.fonts.ready.then(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())))));
  // A product without its picture would show the generic fallback; that is a broken capture, not a screen.
  await expect(page.locator('.image-fallback')).toHaveCount(0);
}

async function encode(page: Page, format: 'png' | 'webp', quality: number | undefined, fullPage: boolean): Promise<Buffer> {
  const cdp = await page.context().newCDPSession(page);
  try {
    // PNG is lossless, so only the encoder effort is chosen; WebP takes a quality from 0 to 100.
    const encoder = quality === undefined ? { optimizeForSpeed: false } : { quality };
    const { cssContentSize } = await cdp.send('Page.getLayoutMetrics');
    const wholePage = { captureBeyondViewport: true, clip: { x: 0, y: 0, width: Math.ceil(cssContentSize.width), height: Math.ceil(cssContentSize.height), scale: 1 } };
    const { data } = await cdp.send('Page.captureScreenshot', { format, fromSurface: true, ...encoder, ...(fullPage ? wholePage : {}) });
    return Buffer.from(data, 'base64');
  } finally { await cdp.detach(); }
}

/** Pages start at the top unless the screen is about a scrolled position (the collection anchor). */
async function shot(page: Page, id: ScreenId, { keepScroll = false }: { keepScroll?: boolean } = {}) {
  const definition = definitions.get(id)!;
  if (!keepScroll) await page.evaluate(() => scrollTo(0, 0));
  await settle(page);
  const image = await encode(page, IMAGE.format, IMAGE.quality, definition.fullPage === true);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(path.join(OUT_DIR, `${id}.${IMAGE.extension}`), image);
  results.push({ id, bytes: image.length });
  if (PROBE_DIR && PROBE_IDS.includes(id)) {
    mkdirSync(PROBE_DIR, { recursive: true });
    const variants: Array<[string, 'png' | 'webp', number | undefined]> = [['png', 'png', undefined], ['q85.webp', 'webp', 85], ['q92.webp', 'webp', 92]];
    for (const [suffix, format, quality] of variants) {
      const bytes = await encode(page, format, quality, definition.fullPage === true);
      writeFileSync(path.join(PROBE_DIR, `${id}.${suffix}`), bytes);
      console.info(`probe ${id}.${suffix}: ${bytes.length} bytes`);
    }
  }
}

/** Resolves once the document scrolled to an anchor stops moving (smooth scrolling is disabled by reduced motion). */
async function scrollSettled(page: Page) {
  let previous = -1;
  await expect.poll(async () => { const now = await page.evaluate(() => Math.round(scrollY)); const same = now === previous; previous = now; return same && now > 0; }, { intervals: [150] }).toBe(true);
}

const productCard = (page: Page, name: string) => page.getByRole('button', { name: t('storefront', 'product.view', { name }), exact: true });

async function addFromCard(page: Page, name: string) {
  await page.getByRole('button', { name: t('storefront', 'product.addToBag', { name }), exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: t('storefront', 'toast.added', { name }) })).toBeVisible();
}

async function fillCustomer(page: Page, customer: { name: string; email: string; phone: string; address: string }) {
  await page.getByLabel(t('cart', 'customer.name')).fill(customer.name);
  await page.getByLabel(t('cart', 'customer.email'), { exact: true }).fill(customer.email);
  if (customer.phone) await page.getByLabel(startingWith(t('cart', 'customer.phone'))).fill(customer.phone);
  if (customer.address) await page.getByLabel(startingWith(t('cart', 'customer.address'))).fill(customer.address);
}

/** Submits the checkout form and returns the order the server saved. */
async function placeOrder(page: Page) {
  const saved = page.waitForResponse(response => response.url().endsWith('/api/store/orders') && response.request().method() === 'POST');
  await page.getByRole('button', { name: t('cart', 'checkout.placeOrder'), exact: true }).click();
  const response = await saved;
  expect(response.status()).toBe(201);
  return (await response.json()).data.order as SavedOrder;
}

/** Goes from the storefront to the bag with the header link, as a visitor would. */
async function openBag(page: Page, count: number) {
  await page.getByRole('link', { name: t('common', 'header.bagCount', { count }) }).click();
  await expect(page).toHaveURL(`${ORIGIN}${at('/cart')}`);
  // Payment options load after hydration, so an enabled button also proves the form is interactive.
  await expect(page.getByRole('button', { name: t('cart', 'checkout.placeOrder'), exact: true })).toBeEnabled();
}

async function orderFromStorefront(page: Page, products: string[], customer: (typeof customers)[keyof typeof customers]) {
  await page.goto(at('/'));
  await expect(productCard(page, products[0])).toBeVisible();
  for (const name of products) await addFromCard(page, name);
  await openBag(page, products.length);
  await fillCustomer(page, customer);
  return placeOrder(page);
}

const adminNav = (page: Page, view: 'overview' | 'products' | 'orders' | 'agents' | 'settings') =>
  page.getByRole('navigation', { name: t('admin', 'shell.navLabel') }).getByRole('button', { name: startingWith(t('admin', `nav.${view}`)) });

async function changeOrder(page: Page, orderId: string, status: 'completed' | 'cancelled') {
  const row = page.getByRole('row').filter({ hasText: `#${orderId.slice(-8)}` });
  await row.getByRole('button', { name: startingWith(t('admin', 'orders.view')) }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(orderId, { exact: true })).toBeVisible();
  page.once('dialog', confirmation => confirmation.accept());
  const changed = page.waitForResponse(response => response.url().endsWith(`/api/admin/orders/${orderId}`) && response.request().method() === 'PATCH');
  await dialog.getByRole('button', { name: t('admin', status === 'completed' ? 'orders.detail.confirm' : 'orders.detail.cancel'), exact: true }).click();
  expect((await changed).status()).toBe(200);
  await expect(row.getByText(t('admin', `orderStatus.${status}`), { exact: true })).toBeVisible();
}

/** The "agent" in this flow is a local HTTP listener that plays the redirect URI of a native OAuth client. */
async function startClientCallback() {
  const received: URL[] = [];
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    // Browsers also ask for /favicon.ico; only the redirect URI itself counts as the client's callback.
    if (url.pathname !== '/callback') { response.writeHead(404).end(); return; }
    received.push(url);
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Demo assistant: authorization code received. You can close this tab.');
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  return { redirectUri: `http://127.0.0.1:${port}/callback`, received, close: () => new Promise<void>(done => server.close(() => done())) };
}

/** Registers a public client the way an MCP client does (RFC 7591) and builds a PKCE authorization URL (RFC 7636). */
async function authorizationUrl(context: BrowserContext, redirectUri: string) {
  const scope = 'openid offline_access products:read products:write stock:write orders:read dashboard:read';
  const registration = await context.request.post('/api/auth/oauth2/register', {
    headers: { origin: ORIGIN },
    data: { client_name: 'Demo Assistant', redirect_uris: [redirectUri], token_endpoint_auth_method: 'none', application_type: 'native', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], scope },
  });
  expect(registration.status()).toBe(201);
  const { client_id: clientId } = await registration.json();
  const verifier = randomBytes(48).toString('base64url');
  const query = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope, state: randomBytes(12).toString('base64url'),
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', resource: `${ORIGIN}/api/mcp`,
  });
  return `${ORIGIN}/api/auth/oauth2/authorize?${query}`;
}

test(`screenshot tour (${LOCALE})`, async ({ browser }) => {
  const desktop = await browser.newContext(contextOptions('desktop'));
  const mobile = await browser.newContext(contextOptions('mobile'));
  for (const context of [desktop, mobile]) { context.setDefaultNavigationTimeout(120_000); context.setDefaultTimeout(45_000); }
  const page = await desktop.newPage();
  const phone = await mobile.newPage();
  watch(page, 'desktop', [{ status: 404, path: at('/this-page-does-not-exist') }]);
  watch(phone, 'mobile');
  // Orders the tour places through the storefront; each is given its final status in the admin later.
  let completedOrder!: SavedOrder; let cancelledOrder!: SavedOrder; let pendingOrder!: SavedOrder;

  await test.step('storefront: landing page and the empty bag', async () => {
    await page.goto(at('/'));
    await expect(page.getByRole('heading', { level: 1 })).toContainText(t('storefront', 'hero.title.line1'));
    await expect(page.getByText(t('storefront', 'demoStrip'))).toBeVisible();
    await shot(page, 'storefront-hero');
    await page.goto(at('/cart'));
    await expect(page.getByRole('heading', { name: t('cart', 'empty.title') })).toBeVisible();
    await shot(page, 'bag-empty');
  });

  await test.step('storefront: collection and product dialog', async () => {
    await page.goto(at('/#collection'));
    await expect(productCard(page, 'Essential tee')).toBeVisible();
    await scrollSettled(page);
    // The anchor jump leaves a sliver of the hero on top; a wheel turn, as a visitor would, brings the heading up.
    const anchored = await page.evaluate(() => scrollY);
    await page.mouse.wheel(0, 150);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(anchored + 100);
    await scrollSettled(page);
    await shot(page, 'storefront-collection', { keepScroll: true });
    await productCard(page, 'Essential tee').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Essential tee' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: t('storefront', 'detail.add') })).toBeEnabled();
    await shot(page, 'storefront-product', { keepScroll: true });
  });

  await test.step('bag: three products and the checkout form, then the first real order', async () => {
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: t('storefront', 'detail.add') }).click();
    await expect(page.getByRole('status').filter({ hasText: t('storefront', 'toast.added', { name: 'Essential tee' }) })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await addFromCard(page, 'Urban backpack');
    await addFromCard(page, 'Table lamp');
    await openBag(page, 3);
    await page.getByRole('button', { name: t('cart', 'item.increase', { name: 'Essential tee' }), exact: true }).click();
    await expect(page.getByText(t('cart', 'heading.itemCount', { count: 4 }))).toBeVisible();
    await fillCustomer(page, customers.ada);
    await shot(page, 'bag-checkout');
    completedOrder = await placeOrder(page);
    await expect(page.getByRole('heading', { name: t('cart', 'receipt.title') })).toBeVisible();
    await expect(page.getByText(completedOrder.id)).toBeVisible();
    await shot(page, 'order-received');
  });

  await test.step('storefront: two more orders, the return page and the 404', async () => {
    cancelledOrder = await orderFromStorefront(page, ['Everyday sneakers'], customers.grace);
    pendingOrder = await orderFromStorefront(page, ['Knit sweater', 'Table lamp'], customers.linus);
    await page.goto(at('/checkout/return'));
    await expect(page.getByText(t('cart', 'paymentReturn.noReference'))).toBeVisible();
    await shot(page, 'checkout-return');
    const missing = await page.goto(at('/this-page-does-not-exist'));
    expect(missing?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1, name: t('common', 'boundaries.notFound.title') })).toBeVisible();
    await shot(page, 'not-found');
  });

  await test.step('admin: orders in all three statuses, order detail and overview', async () => {
    await page.goto(at('/admin'));
    await expect(page.getByRole('heading', { level: 1, name: t('admin', 'views.overview.title') })).toBeVisible();
    await adminNav(page, 'orders').click();
    await changeOrder(page, completedOrder.id, 'completed');
    await changeOrder(page, cancelledOrder.id, 'cancelled');
    await expect(page.getByText(t('admin', 'orders.count', { count: 3 }))).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: t('admin', 'shell.notices.orderUpdated') })).toBeHidden({ timeout: 15_000 });
    await shot(page, 'admin-orders');
    const pending = page.getByRole('row').filter({ hasText: `#${pendingOrder.id.slice(-8)}` });
    await pending.getByRole('button', { name: startingWith(t('admin', 'orders.view')) }).click();
    await expect(page.getByRole('dialog').getByRole('button', { name: t('admin', 'orders.detail.confirm'), exact: true })).toBeVisible();
    await shot(page, 'admin-order-detail');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await adminNav(page, 'overview').click();
    await expect(page.getByRole('heading', { name: t('admin', 'overview.recent.title') })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: t('admin', 'orderStatus.completed') })).toBeVisible();
    await shot(page, 'admin-overview');
  });

  await test.step('admin: products, editor and stock dialogs', async () => {
    await adminNav(page, 'products').click();
    const tee = page.getByRole('row').filter({ hasText: 'Essential tee' });
    await expect(tee).toBeVisible();
    await shot(page, 'admin-products');
    await tee.getByRole('button', { name: t('admin', 'products.actions.edit'), exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('heading', { name: t('admin', 'editor.editTitle') })).toBeVisible();
    await expect(page.getByLabel(t('admin', 'editor.fields.name'))).toHaveValue('Essential tee');
    await shot(page, 'admin-product-editor');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await page.getByRole('row').filter({ hasText: 'Knit sweater' }).getByRole('button', { name: t('admin', 'products.actions.stock'), exact: true }).click();
    const stock = page.getByRole('dialog');
    await expect(stock.getByRole('heading', { name: t('admin', 'stock.title') })).toBeVisible();
    await stock.getByLabel(startingWith(t('admin', 'stock.fields.delta'))).fill('12');
    await stock.getByLabel(t('admin', 'stock.fields.reason')).fill('Supplier restock');
    await shot(page, 'admin-stock');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  await test.step('admin: agent connection guide and settings', async () => {
    await adminNav(page, 'agents').click();
    await expect(page.locator('.endpoint-field code')).toHaveText(`${ORIGIN}/api/mcp`);
    await shot(page, 'admin-agents');
    await adminNav(page, 'settings').click();
    await expect(page.getByRole('heading', { name: t('runtime', 'settings.title') })).toBeVisible();
    await expect(page.getByLabel(t('runtime', 'settings.notice.label'), { exact: true })).toBeVisible();
    await shot(page, 'admin-settings');
  });

  await test.step('mobile: storefront and administration', async () => {
    await phone.goto(at('/'));
    await expect(phone.getByRole('heading', { level: 1 })).toContainText(t('storefront', 'hero.title.line1'));
    await expect(phone.getByText(t('storefront', 'demoStrip'))).toBeVisible();
    await shot(phone, 'storefront-mobile');
    await phone.goto(at('/admin'));
    await expect(phone.getByRole('row').filter({ hasText: t('admin', 'orderStatus.pending') }).first()).toBeVisible();
    await shot(phone, 'admin-mobile');
  });

  await test.step('account: sign in, create the owner account and the business', async () => {
    await page.goto(at('/sign-in'));
    await expect(page.getByRole('heading', { level: 1, name: t('auth', 'signIn.title.signIn') })).toBeVisible();
    await shot(page, 'sign-in');
    // The mode switch only works once React has hydrated the page, so clicking it doubles as the readiness check.
    const name = page.getByLabel(t('auth', 'signIn.fields.name'));
    await expect(async () => {
      await page.getByRole('button', { name: t('auth', 'signIn.toggle.toCreate') }).click();
      await expect(name).toBeVisible({ timeout: 1_500 });
    }).toPass({ timeout: 30_000 });
    await name.fill(owner.name);
    await page.getByLabel(t('auth', 'signIn.fields.email')).fill(owner.email);
    await page.getByLabel(t('auth', 'signIn.fields.password')).fill(owner.password);
    await shot(page, 'create-account');
    await page.getByRole('button', { name: t('auth', 'signIn.submit.create'), exact: true }).click();
    await expect(page).toHaveURL(`${ORIGIN}${at('/onboarding')}`);
    await expect(page.getByRole('heading', { level: 1, name: t('auth', 'onboarding.title') })).toBeVisible();
    // The organization list is requested after hydration; once the form is idle it is safe to submit.
    await expect(page.getByRole('button', { name: t('auth', 'onboarding.create.submit'), exact: true })).toBeEnabled();
    await page.getByLabel(t('auth', 'onboarding.create.name'), { exact: true }).fill(business.name);
    await page.getByLabel(t('auth', 'onboarding.create.slug')).fill(business.slug);
    await shot(page, 'onboarding');
    await page.getByRole('button', { name: t('auth', 'onboarding.create.submit'), exact: true }).click();
    await expect(page).toHaveURL(`${ORIGIN}${at('/admin')}`);
  });

  await test.step('account: OAuth consent for a dynamically registered client, then the connection list', async () => {
    const client = await startClientCallback();
    try {
      await page.goto(await authorizationUrl(desktop, client.redirectUri));
      await expect(page).toHaveURL(new RegExp(`^${ORIGIN}${at('/consent')}\\?`));
      await expect(page.getByRole('heading', { level: 1, name: t('auth', 'consent.title', { client: 'Demo Assistant', organization: business.name }) })).toBeVisible();
      await shot(page, 'consent');
      await page.getByRole('button', { name: t('auth', 'consent.allow'), exact: true }).click();
      // The browser follows the server's redirect to the client's redirect URI; wait until that page has loaded.
      await page.waitForURL(url => url.href.startsWith(client.redirectUri));
      await expect(page.getByText('authorization code received')).toBeVisible();
      // Chromium may repeat the navigation request, so the count is not asserted; every request carries the same code.
      expect(client.received.length).toBeGreaterThan(0);
      expect(new Set(client.received.map(url => url.searchParams.get('code'))).size).toBe(1);
      expect(client.received[0].searchParams.get('code')).toBeTruthy();
    } finally { await client.close(); }
    await page.goto(at('/onboarding/connections'));
    await expect(page.getByRole('heading', { name: 'Demo Assistant' })).toBeVisible();
    await expect(page.locator('main code').first()).toHaveText(`${ORIGIN}/api/mcp`);
    await shot(page, 'connections');
  });

  await desktop.close();
  await mobile.close();

  const total = results.reduce((sum, item) => sum + item.bytes, 0);
  console.info(results.map(item => `${item.id.padEnd(24)} ${String(item.bytes).padStart(7)} bytes`).join('\n'));
  console.info(`${results.length} images, ${total} bytes in ${path.relative(ROOT, OUT_DIR)}`);
  expect(results.map(item => item.id).sort(), 'every manifest screen is captured exactly once').toEqual(screenList.map(item => item.id).sort());
  for (const summary of knownIssues) console.warn(`KNOWN APP ISSUE observed (reported, not hidden): ${summary}`);
  expect(problems, 'the tour must not see page errors or failed same-origin requests').toEqual([]);
});
