import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { sql } from 'kysely';
import { getDatabase } from '@/db';
import { createCommerceService } from '@/core/service';
import { AppError } from '@/core/contracts';
import { withOperation,emitEvent } from './telemetry';
import { templateConfig } from '@/template.config';
export function service() { return createCommerceService(getDatabase(),{telemetry:event=>emitEvent(event.name,{'event.outcome':event.outcome,'operation':event.operation,'duration_ms':event.durationMs,'error.code':event.errorCode,'retry.count':event.retryCount})}); }
export function requireModule(name:keyof typeof templateConfig.modules) {
 if(!templateConfig.modules[name]) throw new AppError('MODULE_DISABLED','This module is not enabled.',404);
}
export function verifyOrigin(request:Request) {
 const origin=request.headers.get('origin');
 const configured=process.env.APP_URL ?? process.env.BETTER_AUTH_URL;
 const expected=configured ? new URL(configured).origin : new URL(request.url).origin;
 if(request.headers.get('sec-fetch-site')==='cross-site' || (origin && origin!==expected)) throw new AppError('FORBIDDEN','Origin not allowed.',403);
}
export async function jsonBody(request:Request):Promise<unknown> {
 if(!request.headers.get('content-type')?.startsWith('application/json')) throw new AppError('UNSUPPORTED_MEDIA_TYPE','Use application/json.',415);
 if(Number(request.headers.get('content-length'))>65536) throw new AppError('BODY_TOO_LARGE','The request is too large.',413);
 const reader=request.body?.getReader();if(!reader) throw new AppError('INVALID_INPUT','The request body is missing.');
 const chunks:Uint8Array[]=[];let size=0;
 try { for(;;) {const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536){await reader.cancel();throw new AppError('BODY_TOO_LARGE','The request is too large.',413);}chunks.push(value);} }
 finally { reader.releaseLock(); }
 try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new AppError('INVALID_INPUT','Invalid JSON.'); }
}
export async function route<T>(request:Request,operation:string,path:string,fn:()=>Promise<T>,status=200):Promise<Response> {
 const incoming=request.headers.get('x-request-id');const requestId=incoming && /^[0-9a-f-]{36}$/i.test(incoming)?incoming:randomUUID();
 try {
  const data=await withOperation(operation,{requestId,route:path,method:request.method},async()=>{
   if(!['GET','HEAD'].includes(request.method)) verifyOrigin(request);
   try { return await fn(); } catch (error) { if(error instanceof ZodError) throw new AppError('INVALID_INPUT','Review the information entered.'); throw error; }
  });
  return Response.json({data,requestId},{status,headers:{'x-request-id':requestId,'cache-control':'no-store'}});
 } catch(error) {
  const invalid=error instanceof ZodError;
  const code=error instanceof AppError?error.code:invalid?'INVALID_INPUT':'INTERNAL_ERROR';
  const safeMessage=error instanceof AppError?error.message:invalid?'Review the information entered.':'We could not complete the operation. Keep the tracking code.';
  return Response.json({error:{code,message:safeMessage},requestId},{status:error instanceof AppError?error.status:invalid?400:500,headers:{'x-request-id':requestId,'cache-control':'no-store'}});
 }
}
/** Atomic per-store budget across instances. Add edge/IP protections for hostile public traffic. */
export async function storefrontWriteBudget(tenantId:string) {
 const bucket=Math.floor(Date.now()/60000);const key=`store:${tenantId}:${bucket}`;
 const row=await getDatabase().insertInto('commerce_rate_limits').values({key,count:1,expires_at:new Date((bucket+2)*60000).toISOString()}).onConflict(oc=>oc.column('key').doUpdateSet({count:sql`commerce_rate_limits.count + 1`})).returning('count').executeTakeFirstOrThrow();
 if(row.count>120) throw new AppError('RATE_LIMITED','Too many requests. Try again in a minute.',429);
}

export function pagination(request:Request) { const url=new URL(request.url);const limit=Number(url.searchParams.get('limit')??100),offset=Number(url.searchParams.get('offset')??0);if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(offset)||offset<0||offset>100000)throw new AppError('INVALID_INPUT','Invalid pagination.');return {limit,offset}; }
