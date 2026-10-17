import type { Kysely } from 'kysely';
import type { Database } from './schema';
import { AppError, type Actor, type CreateProductInput, createCommerceService } from '../core';

const catalog: CreateProductInput[] = [
  { sku: 'NOMA-TEE-01', name: 'Camiseta esencial', description: 'Algodón suave. Una pieza para todos los días.', category: 'Ropa', priceMinor: 2900, currency: 'USD', stock: 48, imageUrl: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800&q=80' },
  { sku: 'NOMA-BAG-01', name: 'Mochila urbana', description: 'Espacio para llevar lo que importa.', category: 'Bolsos', priceMinor: 7900, currency: 'USD', stock: 18, imageUrl: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=800&q=80' },
  { sku: 'NOMA-SHOE-01', name: 'Zapatillas de diario', description: 'Líneas simples. Comodidad todo el día.', category: 'Accesorios', priceMinor: 8900, currency: 'USD', stock: 24, imageUrl: 'https://images.unsplash.com/photo-1549298916-b41d501d3772?w=800&q=80' },
  { sku: 'NOMA-LAMP-01', name: 'Lámpara de mesa', description: 'Un detalle de luz para tu espacio.', category: 'Hogar', priceMinor: 6500, currency: 'USD', stock: 8, imageUrl: 'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=800&q=80' },
  { sku: 'NOMA-KNIT-01', name: 'Suéter de punto', description: 'Textura cálida y silueta relajada.', category: 'Ropa', priceMinor: 5900, currency: 'USD', stock: 4, imageUrl: 'https://images.unsplash.com/photo-1576566588028-4147f3842f27?w=800&q=80' },
  { sku: 'NOMA-CHAIR-01', name: 'Silla de diseño', description: 'Una pausa cómoda, en cualquier rincón.', category: 'Hogar', priceMinor: 14900, currency: 'USD', stock: 6, imageUrl: 'https://images.unsplash.com/photo-1598300042247-d088f8ab3a91?w=800&q=80' },
];
const posCatalog: CreateProductInput[] = [
  { sku: 'DES-001', name: 'Yerba mate 1 kg', category: 'Despensa', description: 'Paquete de un kilogramo.', priceMinor: 32000, currency: 'PYG', stock: 30 },
  { sku: 'DES-002', name: 'Arroz 1 kg', category: 'Despensa', description: 'Arroz largo fino.', priceMinor: 8500, currency: 'PYG', stock: 50 },
  { sku: 'BEB-001', name: 'Agua mineral 500 ml', category: 'Bebidas', priceMinor: 4500, currency: 'PYG', stock: 48 },
  { sku: 'ROP-001', name: 'Camiseta esencial', category: 'Ropa', priceMinor: 65000, currency: 'PYG', stock: 16, imageUrl: catalog[0]!.imageUrl },
  { sku: 'ACC-001', name: 'Mochila urbana', category: 'Accesorios', priceMinor: 180000, currency: 'PYG', stock: 4, imageUrl: catalog[1]!.imageUrl },
  { sku: 'LIM-001', name: 'Detergente 750 ml', category: 'Limpieza', priceMinor: 12000, currency: 'PYG', stock: 20 },
];

/** Explicit development setup only. Never seeds on application boot or overwrites stock. */
export async function seedDemo(db: Kysely<Database>, actor: Actor, variant: 'ecommerce' | 'pos' = 'ecommerce'): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new AppError('DEMO_DISABLED', 'Demo seeding is disabled in production.', 403);
  if (actor.role !== 'owner') throw new AppError('FORBIDDEN', 'Demo setup requires an owner.', 403);
  const service = createCommerceService(db);
  for (const input of variant === 'pos' ? posCatalog : catalog) {
    const existing = await db.selectFrom('commerce_products').select('id').where('tenant_id', '=', actor.tenantId).where('sku', '=', input.sku).executeTakeFirst();
    if (!existing) await service.createProduct(actor, input);
  }
}
