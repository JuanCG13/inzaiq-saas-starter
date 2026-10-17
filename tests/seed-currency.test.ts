import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Kysely } from 'kysely';
import { createDatabase, migrateDatabase, type Database } from '../src/db';
import { demoCatalog, seedDemo } from '../src/db/seed';
import { createCommerceService, type Actor, type Product } from '../src/core';
import { templateConfig } from '../src/template.config';

const publicDirectory = fileURLToPath(new URL('../public', import.meta.url));
const owner: Actor = { userId: 'demo-owner', tenantId: 'demo-store', role: 'owner' };
// Intended storefront prices in major units, independent of the seed implementation.
const ecommerceMajor = { 'NOMA-TEE-01': 29, 'NOMA-BAG-01': 79, 'NOMA-SHOE-01': 89, 'NOMA-LAMP-01': 65, 'NOMA-KNIT-01': 59, 'NOMA-CHAIR-01': 149 } as const;
const stock = { 'NOMA-TEE-01': 48, 'NOMA-BAG-01': 18, 'NOMA-SHOE-01': 24, 'NOMA-LAMP-01': 8, 'NOMA-KNIT-01': 4, 'NOMA-CHAIR-01': 6 } as const;

let db: Kysely<Database>;
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'commerce-seed-'));
  db = createDatabase({ provider: 'sqlite', url: `file:${join(directory, 'seed.db')}` });
  await migrateDatabase(db);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await db.destroy();
  await rm(directory, { recursive: true, force: true });
});

const seeded = async (): Promise<Product[]> => (await createCommerceService(db).listProducts(owner)).sort((a, b) => a.sku.localeCompare(b.sku));
const bySku = (products: Product[]) => Object.fromEntries(products.map(product => [product.sku, product]));

describe('demo catalog currency', () => {
  it('ships USD as the installation currency', () => {
    expect(templateConfig.currency).toBe('USD');
  });

  it('seeds the English ecommerce catalog in USD minor units by default', async () => {
    await seedDemo(db, owner);
    const products = bySku(await seeded());
    expect(Object.keys(products).sort()).toEqual(Object.keys(ecommerceMajor).sort());
    for (const [sku, major] of Object.entries(ecommerceMajor)) {
      expect(products[sku], sku).toMatchObject({ currency: 'USD', priceMinor: major * 100, stock: stock[sku as keyof typeof stock], active: true });
    }
    expect(products['NOMA-TEE-01']).toMatchObject({ name: 'Essential tee', category: 'Clothing', priceMinor: 2900 });
    expect([...new Set(Object.values(products).map(product => product.category))].sort()).toEqual(['Accessories', 'Bags', 'Clothing', 'Home']);
    expect(Object.values(products).map(product => product.name).sort()).toEqual(['Design chair', 'Essential tee', 'Everyday sneakers', 'Knit sweater', 'Table lamp', 'Urban backpack']);
  });

  it('uses first-party SVG images that exist in public/demo, never remote URLs', async () => {
    for (const variant of ['ecommerce', 'pos'] as const) {
      for (const product of demoCatalog(variant)) {
        if (!product.imageUrl) continue;
        expect(product.imageUrl, product.sku).toMatch(/^\/demo\/[a-z-]+\.svg$/);
        expect(existsSync(join(publicDirectory, product.imageUrl)), `${product.imageUrl} must exist in public/demo`).toBe(true);
      }
    }
  });

  it('keeps no Spanish or Paraguayan demo data', () => {
    const text = JSON.stringify([...demoCatalog('ecommerce'), ...demoCatalog('pos')]);
    expect(text).not.toMatch(/[áéíóúñ¿¡]/i);
    expect(text).not.toContain('PYG');
  });

  it.each([
    ['EUR', 2, 100],
    ['GBP', 2, 100],
    ['JPY', 0, 1],
    ['KWD', 3, 1000],
  ])('scales major-unit prices for %s (%i decimals) and stores that currency', async (currency, _digits, factor) => {
    await seedDemo(db, owner, 'ecommerce', currency);
    const products = bySku(await seeded());
    for (const [sku, major] of Object.entries(ecommerceMajor)) {
      expect(products[sku], sku).toMatchObject({ currency, priceMinor: major * factor });
    }
    expect(Number.isSafeInteger(products['NOMA-CHAIR-01']!.priceMinor)).toBe(true);
  });

  it('seeds the POS variant in the configured currency with whole minor units', async () => {
    await seedDemo(db, owner, 'pos', 'USD');
    const usd = bySku(await seeded());
    expect(Object.keys(usd).sort()).toEqual(['ACC-001', 'BEB-001', 'DES-001', 'DES-002', 'LIM-001', 'ROP-001']);
    expect(usd['DES-001']).toMatchObject({ name: 'Ground coffee 1 kg', currency: 'USD', priceMinor: 1250 });
    expect(usd['DES-002']).toMatchObject({ currency: 'USD', priceMinor: 280 });
    expect(usd['BEB-001']).toMatchObject({ currency: 'USD', priceMinor: 120 });
    expect(usd['ROP-001']).toMatchObject({ currency: 'USD', priceMinor: 2900, imageUrl: '/demo/tee.svg' });
    expect(Object.values(usd).every(product => Number.isSafeInteger(product.priceMinor) && product.priceMinor > 0)).toBe(true);
    for (const currency of ['JPY', 'KWD']) {
      for (const product of demoCatalog('pos', currency)) {
        expect(product.currency).toBe(currency);
        expect(Number.isSafeInteger(product.priceMinor) && product.priceMinor > 0, `${currency} ${product.sku}`).toBe(true);
      }
    }
  });

  it('builds the catalog without a database and does not depend on the global config when a currency is injected', () => {
    expect(demoCatalog('ecommerce', 'EUR').every(product => product.currency === 'EUR')).toBe(true);
    expect(demoCatalog().map(product => product.priceMinor)).toEqual([2900, 7900, 8900, 6500, 5900, 14900]);
    expect(demoCatalog('ecommerce', 'JPY').map(product => product.priceMinor)).toEqual([29, 79, 89, 65, 59, 149]);
    expect(templateConfig.currency).toBe('USD');
  });
});

describe('demo seeding safety', () => {
  it('is idempotent by SKU and never overwrites price, currency or stock', async () => {
    await seedDemo(db, owner);
    const service = createCommerceService(db);
    const tee = bySku(await seeded())['NOMA-TEE-01']!;
    await service.adjustStock(owner, tee.id, { delta: -8, reason: 'counted', idempotencyKey: 'seed-test-stock' });
    const adjusted = await service.getProduct(owner, tee.id);
    await service.updateProduct(owner, tee.id, { version: adjusted.version, priceMinor: 3100 });
    await seedDemo(db, owner, 'ecommerce', 'EUR');
    const after = await seeded();
    expect(after).toHaveLength(6);
    expect(bySku(after)['NOMA-TEE-01']).toMatchObject({ currency: 'USD', priceMinor: 3100, stock: 40 });
  });

  it('seeds each tenant separately', async () => {
    await seedDemo(db, owner);
    await seedDemo(db, { ...owner, tenantId: 'other-store' }, 'ecommerce', 'EUR');
    expect(await seeded()).toHaveLength(6);
    const other = await createCommerceService(db).listProducts({ ...owner, tenantId: 'other-store' });
    expect(other).toHaveLength(6);
    expect(new Set(other.map(product => product.currency))).toEqual(new Set(['EUR']));
  });

  it.each(['usd', 'US', 'ZZZ', '', 'DOLLARS'])('rejects the invalid currency %j before writing anything', async currency => {
    await expect(seedDemo(db, owner, 'ecommerce', currency)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(() => demoCatalog('pos', currency)).toThrow(/ISO 4217/);
    expect(await seeded()).toHaveLength(0);
  });

  it('requires an owner and refuses to run in production', async () => {
    await expect(seedDemo(db, { ...owner, role: 'viewer' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(seedDemo(db, { ...owner, role: 'cashier' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    vi.stubEnv('NODE_ENV', 'production');
    await expect(seedDemo(db, owner)).rejects.toMatchObject({ code: 'DEMO_DISABLED' });
    vi.unstubAllEnvs();
    expect(await seeded()).toHaveLength(0);
  });
});
