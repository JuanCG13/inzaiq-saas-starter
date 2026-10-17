import { productInput } from "@/lib/input-schemas";
import {pagination} from "@/lib/http";
import { route,jsonBody,service,requireModule } from '@/lib/http';
import { requestActor } from '@/lib/request-actor';
import { z } from 'zod';
export const runtime='nodejs';
export function GET(request:Request){return route(request,'api.products.list','/api/admin/products',async()=>{requireModule('catalog');const actor=await requestActor(request);const url=new URL(request.url);return {products:await service().listProducts(actor,{...pagination(request),search:url.searchParams.get('search')??undefined})};});}
export function POST(request:Request){return route(request,'api.products.create','/api/admin/products',async()=>{requireModule('catalog');const actor=await requestActor(request);return {product:await service().createProduct(actor,productInput.parse(await jsonBody(request)))};},201);}
