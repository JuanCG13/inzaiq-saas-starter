import { route,jsonBody,service,requireModule } from '@/lib/http';
import { requestActor } from '@/lib/request-actor';
import { z } from 'zod';
export const runtime='nodejs';
export function POST(request:Request){return route(request,'api.inventory.adjust','/api/admin/inventory',async()=>{requireModule('inventory');const actor=await requestActor(request);const input=z.object({productId:z.string().min(1),delta:z.number().int(),reason:z.string().min(3).max(200),version:z.number().int().optional(),idempotencyKey:z.string().min(16).max(128)}).strict().parse(await jsonBody(request));const {productId,...change}=input;return {product:await service().adjustStock(actor,productId,change)};});}
