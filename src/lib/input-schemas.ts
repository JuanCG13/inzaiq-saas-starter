import {z} from 'zod';
export const productInput=z.object({sku:z.string().min(1).max(64),name:z.string().min(1).max(160),description:z.string().max(2000).optional(),category:z.string().max(80).optional(),priceMinor:z.number().int().nonnegative().safe(),currency:z.string().regex(/^[A-Z]{3}$/),stock:z.number().int().min(0).max(1000000000).optional(),imageUrl:z.string().max(2048).nullable().optional(),active:z.boolean().optional()}).strict();
export const productPatch=productInput.omit({stock:true}).partial().extend({version:z.number().int().min(1)}).strict();
