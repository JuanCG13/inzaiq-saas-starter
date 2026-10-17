import {route,service,requireModule} from '@/lib/http';
import {storeActor} from '@/lib/request-actor';
import {templateConfig} from '@/template.config';
import {AppError} from '@/core/contracts';
export const runtime='nodejs';
export function GET(request:Request,context:{params:Promise<{id:string}>}){return route(request,'api.store.product','/api/store/products/:id',async()=>{requireModule('catalog');if(templateConfig.kind!=='ecommerce')throw new AppError('NOT_FOUND','Producto no encontrado.',404);const product=await service().getProduct(storeActor(),(await context.params).id);if(!product.active)throw new AppError('NOT_FOUND','Producto no encontrado.',404);return {product};});}
