import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
import { trace, metrics, SpanStatusCode } from '@opentelemetry/api';
import pino from 'pino';

export interface OperationContext { requestId?: string; route?: string; method?: string }
type Sink = (record: Record<string, unknown>) => void;
const context = new AsyncLocalStorage<OperationContext>();
const logger = pino({ level: process.env.LOG_LEVEL ?? 'info', base: undefined });
const tracer = trace.getTracer('agentic-commerce', '0.1.0');
const meter = metrics.getMeter('agentic-commerce', '0.1.0');
const count = meter.createCounter('app.feature.operation.count');
const duration = meter.createHistogram('app.feature.operation.duration', { unit: 'ms' });
const sinks = new AsyncLocalStorage<Sink>();
const allowed = new Set(['event.outcome','event.reason','operation','duration_ms','request.id','http.route','http.request.method','http.response.status_code','error.type','error.code','retry.count','feature.stage','item.count','dependency.name']);
const safeOperations = /^(api|commerce|mcp|auth|ui|db)\.[a-z._]{1,80}$/;
export function sanitizeAttributes(attrs: Record<string, unknown>) {
  const clean: Record<string, string | number | boolean> = {};
  for (const [key,value] of Object.entries(attrs)) {
    if (!allowed.has(key)) continue;
    if (typeof value === 'string') clean[key] = value.replace(/[\x00-\x1f\x7f]/g, '').slice(0,160);
    else if (typeof value === 'number' && Number.isFinite(value) || typeof value === 'boolean') clean[key] = value;
  }
  return clean;
}
export function emitEvent(name: string, attrs: Record<string, unknown> = {}) {
  try {
    const ctx = context.getStore();
    const span = trace.getActiveSpan()?.spanContext();
    const eventName = safeOperations.test(name) ? name : 'commerce.operation.completed';
    const record = {
      'event.name': eventName, 'event.schema_version': 1, 'event.outcome': 'success',
      'feature.name': eventName.split('.')[0], 'feature.stage': eventName.split('.').at(-1),
      'service.name': process.env.OTEL_SERVICE_NAME ?? 'agentic-commerce', 'service.version': '0.1.0',
      'deployment.environment.name': process.env.NODE_ENV ?? 'development',
      ...sanitizeAttributes(attrs),
      ...(ctx?.requestId ? { 'request.id': ctx.requestId } : {}),
      ...(span?.traceId && span.traceId !== '00000000000000000000000000000000' ? { trace_id:span.traceId,span_id:span.spanId } : {}),
    };
    const sink = sinks.getStore();
    if (sink) sink(record); else logger.info(record);
  } catch { /* Diagnostics must never change business outcomes. */ }
}
export function withTelemetrySink<T>(sink: Sink, fn: () => T): T { return sinks.run(sink, fn); }
export async function withOperation<T>(operation: string, ctx: OperationContext, fn:()=>Promise<T>):Promise<T> {
  const name = safeOperations.test(operation) ? operation : 'commerce.operation';
  const mergedContext={...context.getStore(),...ctx};
  return context.run(mergedContext, () => tracer.startActiveSpan(name, async span => {
    const start = performance.now(); let outcome = 'success'; let code = 'none';
    try { const result=await fn(); if(result instanceof Response && result.status>=400) { outcome=result.status<500?'rejected':'failure';code=result.status===401?'UNAUTHORIZED':result.status===403?'FORBIDDEN':'HTTP_ERROR';span.setAttribute('http.response.status_code',result.status);span.setStatus({code:SpanStatusCode.ERROR,message:code}); } return result; }
    catch(error) {
      const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 500;
      outcome = status < 500 ? 'rejected' : 'failure';
      const candidate = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'INTERNAL_ERROR';
      code = /^[A-Z_]{2,50}$/.test(candidate) ? candidate : 'INTERNAL_ERROR';
      span.setStatus({ code: SpanStatusCode.ERROR, message: code });
      // Raw exception messages/stacks may contain SQL, tokens or customer data.
      span.setAttribute('error.type',code);
      throw error;
    } finally {
      const durationMs = performance.now()-start;
      try { const labels = { operation:name, outcome }; count.add(1,labels); duration.record(durationMs,labels); } catch {}
      emitEvent(name+'.completed', {'event.outcome':outcome,'error.code':code,'duration_ms':durationMs,'http.route':ctx.route,'http.request.method':ctx.method});
      span.end();
    }
  }));
}
