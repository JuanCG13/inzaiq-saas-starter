import { route,jsonBody,service,requireModule } from '@/lib/http';
import { requestActor } from '@/lib/request-actor';
import { z } from 'zod';
export const runtime='nodejs';
export function GET(request:Request){return route(request,'api.audit.read','/api/admin/audit',async()=>({events:await service().listAudit(await requestActor(request),{limit:100})}));}
