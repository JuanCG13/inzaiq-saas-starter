import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

test('owner pauses new checkout live, updates an open storefront and resumes without a deployment', async ({ page: owner, context, request }, testInfo) => {
  const errors: string[] = [];
  owner.on('pageerror', error => errors.push(error.message));
  const initial = (await (await request.get('/api/admin/settings')).json()).data.settings;
  const product = (await (await request.get('/api/store/products')).json()).data.products.find((item: { sku: string }) => item.sku === 'NOMA-TEE-01');
  const customer = await context.newPage();
  customer.on('pageerror', error => errors.push(error.message));
  let acceptedId: string | undefined;
  try {
    if (!initial.acceptingOrders) expect((await request.patch('/api/admin/settings', { data: { ...initial, acceptingOrders: true } })).status()).toBe(200);
    await customer.goto('/en');
    await customer.getByRole('button', { name: 'View Essential tee', exact: true }).click();
    await customer.getByRole('dialog').getByRole('button', { name: 'Add to my bag' }).click();
    await customer.getByRole('dialog').getByRole('link', { name: 'Go to my bag' }).click();
    await expect(customer.getByRole('button', { name: 'Place order', exact: true })).toBeEnabled();
    await owner.goto('/en/admin');
    await owner.getByRole('navigation', { name: 'Administration' }).getByRole('button', { name: 'Settings', exact: true }).click();
    const accepting = owner.getByRole('checkbox', { name: /Accept new operations/ });
    await accepting.uncheck();
    await owner.getByLabel('Business notice', { exact: true }).fill('Temporary QA pause');
    let saved = owner.waitForResponse(response => response.url().endsWith('/api/admin/settings') && response.request().method() === 'PATCH');
    await owner.getByRole('button', { name: 'Save settings', exact: true }).click();
    expect((await saved).status()).toBe(200);
    await customer.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(customer.getByText('Temporary QA pause', { exact: true })).toBeVisible();
    await expect(customer.getByRole('button', { name: 'Place order', exact: true })).toBeDisabled();
    const orderInput = { items: [{ productId: product.id, quantity: 1 }], idempotencyKey: randomUUID(), expectedTotalMinor: product.priceMinor, expectedCurrency: product.currency, customer: { name: 'Runtime QA', email: 'runtime-qa@example.invalid' } };
    const denied = await request.post('/api/store/orders', { data: orderInput, headers: { 'x-checkout-protocol': 'hosted-v1' } });
    expect(denied.status()).toBe(409); expect((await denied.json()).error.code).toBe('ORDERS_PAUSED');
    expect((await (await request.get(`/api/store/products/${product.id}`)).json()).data.product.stock).toBe(product.stock);
    await owner.screenshot({ path: testInfo.outputPath('ecommerce-runtime-paused.png'), fullPage: true });
    await accepting.check();
    await owner.getByLabel('Business notice', { exact: true }).fill('Service resumed QA');
    saved = owner.waitForResponse(response => response.url().endsWith('/api/admin/settings') && response.request().method() === 'PATCH');
    await owner.getByRole('button', { name: 'Save settings', exact: true }).click();
    expect((await saved).status()).toBe(200);
    await customer.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(customer.getByText('Service resumed QA', { exact: true })).toBeVisible();
    await expect(customer.getByRole('button', { name: 'Place order', exact: true })).toBeEnabled();
    const accepted = await request.post('/api/store/orders', { data: orderInput, headers: { 'x-checkout-protocol': 'hosted-v1' } });
    expect(accepted.status()).toBe(201);
    acceptedId = (await accepted.json()).data.order.id;
    expect((await (await request.get(`/api/store/products/${product.id}`)).json()).data.product.stock).toBe(product.stock - 1);
    expect(errors).toEqual([]);
  } finally {
    if (acceptedId) expect((await request.patch(`/api/admin/orders/${acceptedId}`, { data: { status: 'cancelled' } })).status()).toBe(200);
    const current = (await (await request.get('/api/admin/settings')).json()).data.settings;
    expect((await request.patch('/api/admin/settings', { data: { ...initial, version: current.version } })).status()).toBe(200);
    await customer.close();
  }
});
