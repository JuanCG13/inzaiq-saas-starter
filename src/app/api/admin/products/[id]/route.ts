import { productPatch } from "@/lib/input-schemas";
import { route,jsonBody,service,requireModule } from '@/lib/http';
import { requestActor } from '@/lib/request-actor';
import { z } from 'zod';
export const runtime='nodejs';
export async function PATCH(request:Request,context:{params:Promise<{id:string}>}){return route(request,'api.products.update','/api/admin/products/:id',async()=>{requireModule('catalog');const actor=await requestActor(request);const {id}=await context.params;return {product:await service().updateProduct(actor,id,productPatch.parse(await jsonBody(request)))};});}
