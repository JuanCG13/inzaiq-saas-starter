import { test, expect, type Page } from '@playwright/test';
import { PRODUCT_NAME, PRODUCT_SKU, noHorizontalOverflow, observeErrors } from './support';

async function checkout(page: Page, suffix: string) {
  await page.goto('/en');
  await page.getByRole('button', { name: `View ${PRODUCT_NAME}`, exact: true }).click();
  const detail = page.getByRole('dialog');
  await expect(detail.getByRole('heading', { name: PRODUCT_NAME })).toBeVisible();
  await detail.getByRole('button', { name: 'Add to my bag' }).click();
  await detail.getByRole('link', { name: 'Go to my bag' }).click();
  await expect(page).toHaveURL(/\/en\/cart$/);
  await page.getByLabel('Full name').fill(`QA Customer ${suffix}`);
  await page.getByLabel('Email', { exact: true }).fill('qa-checkout@example.invalid');
  const saved = page.waitForResponse(response => response.url().endsWith('/api/store/orders') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Place order', exact: true }).click();
  const response = await saved;
  expect(response.status()).toBe(201);
  const { data } = await response.json();
  await expect(page.getByRole('heading', { name: 'Almost yours.' })).toBeVisible();
  await expect(page.getByText('Payment pending', { exact: true })).toBeVisible();
  expect(data.order.status).toBe('pending');
  return data.order as { id: string; totalMinor: number };
}

test('customer checkout persists, admin cancels once and confirms a second order', async ({ page, request }, testInfo) => {
  const errors = observeErrors(page);
  const initial = await (await request.get('/api/store/products')).json();
  const product = initial.data.products.find((item: { sku: string }) => item.sku === PRODUCT_SKU);
  expect(product).toBeTruthy();
  expect(product.name).toBe(PRODUCT_NAME);
  await page.goto('/en');
  await expect(page.getByRole('button', { name: `View ${PRODUCT_NAME}`, exact: true })).toBeVisible();
  await noHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('ecommerce-desktop.png'), fullPage: true });

  for (const status of ['cancelled', 'completed'] as const) {
    const order = await checkout(page, status);
    expect(order.totalMinor).toBe(product.priceMinor);
    const reserved = await (await request.get(`/api/store/products/${product.id}`)).json();
    expect(reserved.data.product.stock).toBe(product.stock - 1);
    await page.goto('/en/admin');
    await page.getByRole('navigation', { name: 'Administration' }).getByRole('button', { name: 'Orders', exact: true }).click();
    const row = page.getByRole('row').filter({ hasText: `#${order.id.slice(-8)}` });
    await row.getByRole('button', { name: 'View order' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('qa-checkout@example.invalid', { exact: true })).toBeVisible();
    page.once('dialog', confirmation => confirmation.accept());
    const changed = page.waitForResponse(response => response.url().endsWith(`/api/admin/orders/${order.id}`) && response.request().method() === 'PATCH');
    await dialog.getByRole('button', { name: status === 'cancelled' ? 'Cancel order' : 'Confirm payment received', exact: true }).click();
    expect((await changed).status()).toBe(200);
    await expect(row.getByText(status === 'cancelled' ? 'Cancelled' : 'Completed', { exact: true })).toBeVisible();
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
  await page.goto('/en');
  await expect(page.getByRole('button', { name: `View ${PRODUCT_NAME}`, exact: true })).toBeVisible();
  await noHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('ecommerce-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: `View ${PRODUCT_NAME}`, exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Add to my bag' })).toBeVisible();
  await noHorizontalOverflow(page);
  await page.getByRole('dialog').getByRole('button', { name: 'Add to my bag' }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'Go to my bag' }).click();
  await expect(page.getByLabel('Full name')).toBeVisible();
  await noHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('ecommerce-cart-mobile.png'), fullPage: true });
  expect(errors).toEqual([]);
});
