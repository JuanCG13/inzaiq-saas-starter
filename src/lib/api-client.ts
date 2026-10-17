'use client';
export class ApiError extends Error {
  constructor(message: string, public status: number, public requestId?: string) { super(message); this.name='ApiError'; }
}
export async function api<T>(path:string, init:RequestInit = {}):Promise<T> {
  const requestId = crypto.randomUUID();
  const headers = new Headers(init.headers); headers.set('x-request-id',requestId);
  if(init.body) headers.set('content-type','application/json');
  const start=performance.now();
  let status=0;
  try {
    const response=await fetch(path,{...init,headers,credentials:'same-origin',cache:'no-store'});status=response.status;
    const payload=await response.json();
    if(!response.ok) throw new ApiError(payload.error?.message ?? 'No se pudo completar la operación.',status,payload.requestId ?? requestId);
    return payload.data as T;
  } catch(error) {
    if(error instanceof ApiError) throw error;
    throw new ApiError('No pudimos conectar. Revisá tu conexión y volvé a intentar.',status,requestId);
  } finally {
    // Safe correlation fallback. Never logs form values, customer data or bodies.
    const route=path.replace(/\/[0-9a-f-]{36}(?=\/|$|\?)/g,'/:id').split('?')[0];
    try { window.dispatchEvent(new CustomEvent('app:telemetry',{detail:{'event.name':'ui.request.completed','event.schema_version':1,'event.outcome':status>=200&&status<300?'success':status>=400&&status<500?'rejected':'failure','http.route':route,'http.response.status_code':status,'request.id':requestId,duration_ms:performance.now()-start}})); } catch {}
  }
}
