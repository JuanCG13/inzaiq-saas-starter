import {pagination} from "@/lib/http";
import {route,service,requireModule} from '@/lib/http';
import {storeActor} from '@/lib/request-actor';
import {templateConfig} from '@/template.config';
import {AppError} from '@/core/contracts';
export const runtime='nodejs';
export function GET(request:Request){return route(request,'api.store.products','/api/store/products',async()=>{requireModule('catalog');if(templateConfig.kind!=='ecommerce')throw new AppError('MODULE_DISABLED','Tienda pública no habilitada.',404);return {products:await service().listProducts(storeActor(),{activeOnly:true,...pagination(request)})};});}
