import { test, expect, type Page } from '@playwright/test';

const host = 'https://checkout.stripe.com/c/pay/cs_test_recovered';

async function prepareCart(page: Page) {
  await page.route('**/api/store/payment-options', route => route.fulfill({ json: { data: { provider: 'stripe', label: 'Pago seguro con Stripe', mode: 'redirect' } } }));
  await page.route('**/api/store/settings', route => route.fulfill({ json: { data: { settings: { version: 1, acceptingOrders: true, notice: '' } } } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Ver Camiseta esencial', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Añadir a mi bolsa' }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'Ir a mi bolsa' }).click();
  await page.getByLabel('Nombre completo').fill('Private Hosted Customer');
  await page.getByLabel('Email', { exact: true }).fill('private-hosted@example.invalid');
}

test('unknown hosted checkout survives reload and cancel return, resuming the same order without another POST', async ({ page }) => {
  let createCount = 0;
  let submittedKey = '';
  const resumedKeys: string[] = [];
  await page.route('**/api/store/orders', async route => {
    createCount += 1;
    expect(route.request().headers()['x-checkout-protocol']).toBe('hosted-v1');
    submittedKey = route.request().postDataJSON().idempotencyKey;
    // Simulate a committed server request whose response was lost.
    await route.abort('failed');
  });
  await page.route('**/api/store/checkout/resume', async route => {
    const body = route.request().postDataJSON();
    expect(Object.keys(body)).toEqual(['idempotencyKey']);
    resumedKeys.push(body.idempotencyKey);
    await route.fulfill({ json: { data: { state: 'pending', checkout: { kind: 'redirect', url: host } } } });
  });
  await page.route('https://checkout.stripe.com/**', route => route.fulfill({ contentType: 'text/html', body: '<title>Hosted checkout test</title><p>Provider test page</p>' }));
  await prepareCart(page);
  await page.getByRole('button', { name: 'Continuar al pago seguro', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retomar pago', exact: true })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'No pudimos conectar' })).toBeVisible();
  const stored = await page.evaluate(() => sessionStorage.getItem('commerce.checkout.v1'));
  expect(stored).toContain(submittedKey);
  expect(stored).not.toContain('Private Hosted Customer');
  expect(stored).not.toContain('private-hosted@example.invalid');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Retomar pago', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Retomar pago', exact: true }).click();
  await expect(page).toHaveURL(host);
  await page.goto('/cart?cancelled=1');
  await expect(page.getByRole('heading', { name: 'Camiseta esencial', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retomar pago', exact: true })).toBeVisible();
  await page.goto('/checkout/return?status=success&session_id=forged');
  await expect(page.getByRole('heading', { name: 'La confirmación está pendiente.', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pago confirmado.', exact: true })).toHaveCount(0);
  expect(createCount).toBe(1);
  expect(resumedKeys.length).toBeGreaterThanOrEqual(2);
  expect(resumedKeys.every(key => key === submittedKey)).toBe(true);
});

test('a verified payment settles only submitted quantities and clears the recovery capability', async ({ page }) => {
  await prepareCart(page);
  await page.evaluate(() => {
    const cart = JSON.parse(localStorage.getItem('commerce.cart.v1') || '[]');
    const product = cart[0].product;
    cart[0].quantity = 3;
    localStorage.setItem('commerce.cart.v1', JSON.stringify(cart));
    sessionStorage.setItem('commerce.checkout.v1', JSON.stringify({
      version: 1, idempotencyKey: '37391f69-9764-4b47-9a16-8f33f7a82c78', provider: 'stripe',
      items: [{ productId: product.id, quantity: 1 }], expectedTotalMinor: product.priceMinor, expectedCurrency: product.currency,
    }));
  });
  await page.route('**/api/store/checkout/resume', route => route.fulfill({ json: { data: { state: 'completed' } } }));
  await page.goto('/checkout/return?status=cancelled');
  await expect(page.getByRole('heading', { name: 'Pago confirmado.', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('commerce.cart.v1') || '[]')[0]?.quantity)).toBe(2);
  expect(await page.evaluate(() => sessionStorage.getItem('commerce.checkout.v1'))).toBeNull();
});

test('an older server without payment discovery blocks checkout with an actionable upgrade message', async ({ page }) => {
  await prepareCart(page);
  await page.route('**/api/store/payment-options', route => route.fulfill({ status: 404, json: { error: { message: 'Missing route' } } }));
  await page.reload();
  await expect(page.getByRole('alert').filter({ hasText: 'La tienda se está actualizando.' })).toContainText('Recargá esta página antes de confirmar un pedido.');
  await expect(page.getByRole('button', { name: 'Confirmar pedido', exact: true })).toBeDisabled();
});
