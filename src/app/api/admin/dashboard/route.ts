import { route,jsonBody,service,requireModule } from '@/lib/http';
import { requestActor } from '@/lib/request-actor';
import { z } from 'zod';
export const runtime='nodejs';
export function GET(request:Request){return route(request,'api.dashboard.read','/api/admin/dashboard',async()=>service().getDashboard(await requestActor(request)));}
