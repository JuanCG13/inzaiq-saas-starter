import {pagination} from "@/lib/http";
import { route,jsonBody,service,requireModule } from '@/lib/http';
import { requestActor } from '@/lib/request-actor';
import { z } from 'zod';
export const runtime='nodejs';
import { templateConfig } from '@/template.config';
import { AppError } from '@/core/contracts';
export function GET(request:Request){return route(request,'api.orders.list','/api/admin/orders',async()=>{requireModule('orders');return {orders:await service().listOrders(await requestActor(request),pagination(request))};});}
export function POST(request:Request){return route(request,'api.orders.create','/api/admin/orders',async()=>{requireModule('orders');if(templateConfig.kind!=='pos')throw new AppError('UNSUPPORTED_OPERATION','Use the storefront checkout',404);const actor=await requestActor(request);const input=z.object({items:z.array(z.object({productId:z.string(),quantity:z.number().int().positive()}).strict()).min(1).max(100),idempotencyKey:z.string().uuid(),expectedTotalMinor:z.number().int().nonnegative().safe(),expectedCurrency:z.string().regex(/^[A-Z]{3}$/),paymentMethod:z.literal('cash')}).strict().parse(await jsonBody(request));return {order:await service().createOrder(actor,{...input,channel:'pos'})};},201);}
