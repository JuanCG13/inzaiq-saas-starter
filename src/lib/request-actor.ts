import { AppError, type Actor } from '@/core/contracts';
import { getSessionActor } from './actor';
export function isLocalDemo(request: Request) {
  if (process.env.DEMO_MODE !== 'true') return false;
  if (process.env.NODE_ENV === 'production') throw new AppError('DEMO_DISABLED','Demo mode is disabled in production',503);
  const host = new URL(request.url).hostname;
  if (!['localhost','127.0.0.1','[::1]'].includes(host)) throw new AppError('DEMO_DISABLED','Demo is only available on localhost',403);
  const origin=request.headers.get('origin');
  if(origin && !['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname)) throw new AppError('FORBIDDEN','Invalid origin',403);
  return true;
}
export async function requestActor(request:Request):Promise<Actor> {
  if(isLocalDemo(request)) return {userId:'demo-owner',tenantId:process.env.STORE_TENANT_ID ?? 'demo-store',role:'owner'};
  return getSessionActor(request.headers);
}
export function storeActor():Actor {
  const tenantId=process.env.STORE_TENANT_ID;
  if(!tenantId) throw new AppError('STORE_NOT_CONFIGURED','The store is not configured yet.',503);
  return {userId:'storefront',tenantId,role:'cashier',scopes:['products:read','orders:write']};
}
