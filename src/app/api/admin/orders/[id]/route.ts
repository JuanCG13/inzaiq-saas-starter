import { route,jsonBody,service,requireModule } from '@/lib/http';
import { requestActor } from '@/lib/request-actor';
import { z } from 'zod';
export const runtime='nodejs';
export function PATCH(request:Request,context:{params:Promise<{id:string}>}){return route(request,'api.orders.status','/api/admin/orders/:id',async()=>{requireModule('orders');const actor=await requestActor(request);const input=z.object({status:z.enum(['completed','cancelled'])}).strict().parse(await jsonBody(request));return {order:await service().updateOrderStatus(actor,(await context.params).id,input)};});}
