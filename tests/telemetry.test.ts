import { describe,it,expect } from 'vitest';
import { emitEvent,sanitizeAttributes,withTelemetrySink,withOperation } from '../src/lib/telemetry';
describe('telemetry contract',()=>{
 it('allowlists attributes and drops nested secrets and PII',()=>{
  const result=sanitizeAttributes({password:'secret',authorization:'bearer-secret',nested:{email:'customer@example.com'},'event.outcome':'success','duration_ms':12,'error.code':'BAD\nINPUT'});
  expect(JSON.stringify(result)).not.toMatch(/secret|customer|password|authorization/);expect(result['error.code']).toBe('BADINPUT');
 });
 it('correlates success and rejects without leaking exception data',async()=>{
  const rows:Record<string,unknown>[]=[];
  await withTelemetrySink(r=>rows.push(r),async()=>{
   await withOperation('api.products',{requestId:'safe-id',route:'/api/admin/products'},async()=>42);
   await expect(withOperation('api.products',{requestId:'safe-id'},async()=>{throw Object.assign(new Error('secret-password'),{status:403,code:'FORBIDDEN'});})).rejects.toThrow();
  });
  expect(rows).toHaveLength(2);expect(rows[0]['request.id']).toBe('safe-id');expect(rows[0]['event.schema_version']).toBe(1);expect(rows[1]['event.outcome']).toBe('rejected');expect(JSON.stringify(rows)).not.toContain('secret-password');
 });
 it('does not change outcomes when telemetry sink fails',async()=>{
  expect(await withTelemetrySink(()=>{throw new Error('sink offline')},()=>withOperation('api.products',{},async()=>7))).toBe(7);
  expect(()=>withTelemetrySink(()=>{throw new Error('offline')},()=>emitEvent('auth.login',{}))).not.toThrow();
 });
});
