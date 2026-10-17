import type { Kysely } from 'kysely';
import type { Database } from './schema';
import { AppError, type Actor, type CreateProductInput, createCommerceService } from '../core';
import { isSupportedCurrency } from '../i18n/config';
import { currencyFactor } from '../i18n/format';
import { templateConfig } from '../template.config';

/** A demo product priced in major units (29 means 29.00 of the seed currency). */
type DemoProduct = Omit<CreateProductInput, 'priceMinor' | 'currency'> & { price: number };
export type DemoVariant = 'ecommerce' | 'pos';

// Demo catalogs are written in English, the default interface language. Product text is data, so
// it is not part of the message catalogs. Images are first-party SVGs served from public/demo.
const catalog: readonly DemoProduct[] = [
  { sku: 'NOMA-TEE-01', name: 'Essential tee', description: 'Soft cotton. A piece for every day.', category: 'Clothing', price: 29, stock: 48, imageUrl: '/demo/tee.svg' },
  { sku: 'NOMA-BAG-01', name: 'Urban backpack', description: 'Room for everything that matters.', category: 'Bags', price: 79, stock: 18, imageUrl: '/demo/backpack.svg' },
  { sku: 'NOMA-SHOE-01', name: 'Everyday sneakers', description: 'Clean lines. All-day comfort.', category: 'Accessories', price: 89, stock: 24, imageUrl: '/demo/sneakers.svg' },
  { sku: 'NOMA-LAMP-01', name: 'Table lamp', description: 'A touch of light for your space.', category: 'Home', price: 65, stock: 8, imageUrl: '/demo/lamp.svg' },
  { sku: 'NOMA-KNIT-01', name: 'Knit sweater', description: 'Warm texture and a relaxed fit.', category: 'Clothing', price: 59, stock: 4, imageUrl: '/demo/sweater.svg' },
  { sku: 'NOMA-CHAIR-01', name: 'Design chair', description: 'A comfortable pause, in any corner.', category: 'Home', price: 149, stock: 6, imageUrl: '/demo/chair.svg' },
];
const posCatalog: readonly DemoProduct[] = [
  { sku: 'DES-001', name: 'Ground coffee 1 kg', category: 'Pantry', description: 'One-kilogram bag.', price: 12.5, stock: 30 },
  { sku: 'DES-002', name: 'Long-grain rice 1 kg', category: 'Pantry', description: 'Long-grain white rice.', price: 2.8, stock: 50 },
  { sku: 'BEB-001', name: 'Mineral water 500 ml', category: 'Beverages', price: 1.2, stock: 48 },
  { sku: 'ROP-001', name: 'Essential tee', category: 'Clothing', price: 29, stock: 16, imageUrl: '/demo/tee.svg' },
  { sku: 'ACC-001', name: 'Urban backpack', category: 'Accessories', price: 79, stock: 4, imageUrl: '/demo/backpack.svg' },
  { sku: 'LIM-001', name: 'Laundry detergent 750 ml', category: 'Cleaning', price: 6.5, stock: 20 },
];

/**
 * Demo products with prices in integer minor units of `currency` (the installation's currency by
 * default). Each price is a major-unit amount times the currency's factor, so two-decimal
 * currencies keep the intended amounts (USD 29.00 = 2900) and three-decimal ones scale to 29000.
 * Zero-decimal currencies (JPY, PYG, ...) have factor 1, so the same numbers become small
 * amounts: demo data only, never a realistic price list for that currency.
 */
export function demoCatalog(variant: DemoVariant = 'ecommerce', currency: string = templateConfig.currency): CreateProductInput[] {
  if (!isSupportedCurrency(currency)) throw new AppError('INVALID_INPUT', 'Demo currency must be a supported ISO 4217 code such as USD.');
  const factor = currencyFactor(currency);
  return (variant === 'pos' ? posCatalog : catalog).map(({ price, ...product }) => ({ ...product, priceMinor: Math.round(price * factor), currency }));
}

/** Explicit development setup only. Never seeds on application boot or overwrites stock. */
export async function seedDemo(db: Kysely<Database>, actor: Actor, variant: DemoVariant = 'ecommerce', currency: string = templateConfig.currency): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new AppError('DEMO_DISABLED', 'Demo seeding is disabled in production.', 403);
  if (actor.role !== 'owner') throw new AppError('FORBIDDEN', 'Demo setup requires an owner.', 403);
  const products = demoCatalog(variant, currency);
  const service = createCommerceService(db);
  for (const input of products) {
    const existing = await db.selectFrom('commerce_products').select('id').where('tenant_id', '=', actor.tenantId).where('sku', '=', input.sku).executeTakeFirst();
    if (!existing) await service.createProduct(actor, input);
  }
}
