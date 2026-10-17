import { test, expect, type Page } from '@playwright/test';

function observeErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && (!message.location().url || message.location().url.startsWith('http://localhost:3000'))) errors.push(message.text());
  });
  return errors;
}
async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}
async function checkout(page: Page, suffix: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Ver Camiseta esencial', exact: true }).click();
  const detail = page.getByRole('dialog');
  await expect(detail.getByRole('heading', { name: 'Camiseta esencial' })).toBeVisible();
  await detail.getByRole('button', { name: 'Añadir a mi bolsa' }).click();
  await detail.getByRole('link', { name: 'Ir a mi bolsa' }).click();
  await page.getByLabel('Nombre completo').fill(`QA Customer ${suffix}`);
  await page.getByLabel('Email', { exact: true }).fill('qa-checkout@example.invalid');
  const saved = page.waitForResponse(response => response.url().endsWith('/api/store/orders') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Confirmar pedido', exact: true }).click();
  const response = await saved;
  expect(response.status()).toBe(201);
  const { data } = await response.json();
  await expect(page.getByRole('heading', { name: 'Ya es casi tuyo.' })).toBeVisible();
  await expect(page.getByText('Pendiente de pago', { exact: true })).toBeVisible();
  expect(data.order.status).toBe('pending');
  return data.order as { id: string; totalMinor: number };
}

test('customer checkout persists, admin cancels once and confirms a second order', async ({ page, request }, testInfo) => {
  const errors = observeErrors(page);
  const initial = await (await request.get('/api/store/products')).json();
  const product = initial.data.products.find((item: { sku: string }) => item.sku === 'NOMA-TEE-01');
  expect(product).toBeTruthy();
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Ver Camiseta esencial', exact: true })).toBeVisible();
  await noHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('ecommerce-desktop.png'), fullPage: true });

  for (const status of ['cancelled', 'completed'] as const) {
    const order = await checkout(page, status);
    expect(order.totalMinor).toBe(product.priceMinor);
    const reserved = await (await request.get(`/api/store/products/${product.id}`)).json();
    expect(reserved.data.product.stock).toBe(product.stock - 1);
    await page.goto('/admin');
    await page.getByRole('navigation', { name: 'Administración' }).getByRole('button', { name: 'Pedidos', exact: true }).click();
    const row = page.getByRole('row').filter({ hasText: `#${order.id.slice(-8)}` });
    await row.getByRole('button', { name: 'Ver pedido' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('qa-checkout@example.invalid', { exact: true })).toBeVisible();
    page.once('dialog', confirmation => confirmation.accept());
    const changed = page.waitForResponse(response => response.url().endsWith(`/api/admin/orders/${order.id}`) && response.request().method() === 'PATCH');
    await dialog.getByRole('button', { name: status === 'cancelled' ? 'Cancelar pedido' : 'Confirmar pago recibido', exact: true }).click();
    expect((await changed).status()).toBe(200);
    await expect(row.getByText(status === 'cancelled' ? 'Cancelado' : 'Completado', { exact: true })).toBeVisible();
    await page.reload();
    const current = await (await request.get(`/api/store/products/${product.id}`)).json();
    expect(current.data.product.stock).toBe(status === 'cancelled' ? product.stock : product.stock - 1);
  }
  await noHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('ecommerce-admin-desktop.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('mobile storefront, detail and cart remain usable without horizontal overflow', async ({ page }, testInfo) => {
  const errors = observeErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Ver Camiseta esencial', exact: true })).toBeVisible();
  await noHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('ecommerce-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Ver Camiseta esencial', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Añadir a mi bolsa' })).toBeVisible();
  await noHorizontalOverflow(page);
  await page.getByRole('dialog').getByRole('button', { name: 'Añadir a mi bolsa' }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'Ir a mi bolsa' }).click();
  await expect(page.getByLabel('Nombre completo')).toBeVisible();
  await noHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('ecommerce-cart-mobile.png'), fullPage: true });
  expect(errors).toEqual([]);
});
