import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { AppError } from '../src/core/contracts';
import { jsonBody, pagination, route } from '../src/lib/http';
import { withTelemetrySink } from '../src/lib/telemetry';
import { createTranslator, type MessageTree } from '../src/i18n/translate';
import en from '../src/i18n/messages/en/errors.json';
import es from '../src/i18n/messages/es/errors.json';

/**
 * Error contract: the server always answers in English with a stable machine-readable `code`.
 * The browser picks localized text from `errors.codes.<CODE>`, so every code a person can
 * receive needs a message in every shipped language.
 */
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');
const posix = (path: string) => relative(ROOT, path).split(sep).join('/');

function walk(directory: string, files: string[] = []): string[] {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) walk(path, files);
    else if (/\.(ts|tsx)$/.test(name)) files.push(path);
  }
  return files;
}
const sources = walk(SRC).map(path => ({ file: posix(path), text: readFileSync(path, 'utf8') }));
const line = (text: string, index: number) => text.slice(0, index).split('\n').length;

/** Codes a person can receive. `INTERNAL_ERROR` and `NETWORK_ERROR` are produced without an AppError literal. */
const CODE = '[A-Z][A-Z0-9_]{2,}';
const discovery = [
  new RegExp(`\\bAppError\\(\\s*['"](${CODE})['"]`, 'g'), // new AppError('CODE', ...)
  new RegExp(`\\bcode:\\s*['"](${CODE})['"]`, 'g'), // { error: { code: 'CODE' } } responses
  new RegExp(`\\bApiError\\([^;]*?,\\s*['"](${CODE})['"]\\s*\\)`, 'g'), // client-side NETWORK_ERROR
  new RegExp(`[?:]\\s*['"](INTERNAL_ERROR)['"]`, 'g'), // fallback for failures that are not AppErrors
];
function discoverCodes() {
  const found = new Map<string, string>();
  for (const { file, text } of sources) {
    for (const pattern of discovery) {
      for (const match of text.matchAll(pattern)) if (!found.has(match[1]!)) found.set(match[1]!, `${file}:${line(text, match.index!)}`);
    }
  }
  return found;
}
const codes = discoverCodes();

function leaves(node: unknown, path: string[] = []): [string, unknown][] {
  if (node && typeof node === 'object') return Object.entries(node).flatMap(([key, value]) => leaves(value, [...path, key]));
  return [[path.join('.'), node]];
}
const placeholders = (message: string) => [...message.matchAll(/\{(\w+)\}/g)].map(match => match[1]!).sort().join(',');

describe('error code catalogue', () => {
  it('finds the codes the server and client can produce', () => {
    // A broken scan must fail loudly instead of passing with nothing to check.
    expect(codes.size).toBeGreaterThanOrEqual(45);
    for (const known of ['INVALID_INPUT', 'FORBIDDEN', 'ORDERS_PAUSED', 'INSUFFICIENT_STOCK', 'PAYMENT_PROVIDER_UNAVAILABLE', 'INTERNAL_ERROR', 'NETWORK_ERROR', 'AUTH_UNAVAILABLE']) {
      expect([...codes.keys()], `the scan no longer finds ${known}`).toContain(known);
    }
  });

  for (const [name, catalogue] of [['en', en], ['es', es]] as const) {
    it(`${name}: every error code has a message under errors.codes`, () => {
      const missing = [...codes].filter(([code]) => !Object.hasOwn(catalogue.codes, code));
      expect(
        missing.map(([code, where]) => `${code} (first used at ${where})`),
        `src/i18n/messages/${name}/errors.json is missing errors.codes entries. Add one message per code:\n${missing.map(([code, where]) => `  - ${code}  <- ${where}`).join('\n')}\n`,
      ).toEqual([]);
    });

    it(`${name}: no message is empty`, () => {
      const empty = leaves(catalogue).filter(([, value]) => typeof value !== 'string' || value.trim() === '').map(([path]) => path);
      expect(empty, `empty or non-string messages in errors.json (${name})`).toEqual([]);
    });
  }

  it('keeps en and es aligned key by key and placeholder by placeholder', () => {
    const english = new Map(leaves(en).map(([path, value]) => [path, String(value)]));
    const spanish = new Map(leaves(es).map(([path, value]) => [path, String(value)]));
    expect([...english.keys()].filter(key => !spanish.has(key)), 'keys only in en').toEqual([]);
    expect([...spanish.keys()].filter(key => !english.has(key)), 'keys only in es').toEqual([]);
    const drift = [...english].filter(([key, message]) => placeholders(message) !== placeholders(spanish.get(key) ?? '')).map(([key]) => key);
    expect(drift, 'messages whose {placeholders} differ between en and es').toEqual([]);
  });

  it('resolves a code to its message with the translator the browser uses', () => {
    const t = createTranslator<'errors'>(en as unknown as MessageTree, 'en');
    expect(t.has('codes.ORDERS_PAUSED')).toBe(true);
    expect(t.has('codes.NOT_A_REAL_CODE')).toBe(false);
    expect((t as unknown as (key: string) => string)('codes.ORDERS_PAUSED')).toBe('New orders are paused. Try again later.');
    const spanish = createTranslator<'errors'>(es as unknown as MessageTree, 'es');
    expect((spanish as unknown as (key: string) => string)('codes.ORDERS_PAUSED')).toBe('Las nuevas operaciones están pausadas. Intentá más tarde.');
  });
});

describe('server text policy', () => {
  /** Server-side code: API routes, HTTP helpers, MCP, domain services, payments. Demo seed data is product copy, not server text. */
  const serverFiles = sources.filter(({ file }) =>
    /^src\/(app\/api|core|payments|extensions)\//.test(file)
    || /^src\/lib\/[^/]+\.ts$/.test(file)
    || /^src\/runtime\/(service|contracts|server)\.ts$/.test(file));

  it('covers the files the policy is about', () => {
    const names = serverFiles.map(({ file }) => file);
    for (const expected of ['src/lib/http.ts', 'src/lib/request-actor.ts', 'src/core/service.ts', 'src/payments/providers/stripe.ts', 'src/runtime/service.ts', 'src/app/api/store/orders/route.ts']) expect(names).toContain(expected);
  });

  it('keeps Spanish accents and inverted punctuation out of API routes and the HTTP helper', () => {
    const offenders: string[] = [];
    for (const { file, text } of serverFiles) {
      text.split('\n').forEach((content, index) => {
        if (/[áéíóúüñÁÉÍÓÚÜÑ¿¡]/.test(content)) offenders.push(`${file}:${index + 1}  ${content.trim().slice(0, 120)}`);
      });
    }
    expect(offenders, `Server responses, logs and MCP output are English. Move localized wording to src/i18n/messages/<locale>/errors.json (keyed by code):\n${offenders.join('\n')}\n`).toEqual([]);
  });

  it('keeps unaccented Spanish voseo and the old Spanish labels out of server messages', () => {
    const voseo = /(?<![\p{L}])(Intentá|Revisá|Usá|Recargá|Iniciá|Conservá|Volvé|Reintentá|Esperá|Consultá|Seleccioná|tenés|pasarela|solicitud|pedido|tienda|usuario|empresa)(?![\p{L}])/iu;
    const oldLabels = ['Administrador demo', 'Pago seguro con Stripe', 'Pago a coordinar', 'Pago online', 'Pedido de tienda', 'Tienda pública'];
    const messageLiteral = /(?:AppError\(\s*['"][A-Z0-9_]+['"]\s*,|invalidInput\(|\bmessage:)\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
    const offenders: string[] = [];
    for (const { file, text } of serverFiles) {
      for (const match of text.matchAll(messageLiteral)) if (voseo.test(match[2]!)) offenders.push(`${file}:${line(text, match.index!)}  ${match[2]}`);
      for (const label of oldLabels) if (text.includes(label)) offenders.push(`${file}  contains the old Spanish text "${label}"`);
    }
    expect(offenders).toEqual([]);
  });
});

describe('HTTP error envelope', () => {
  const origin = 'http://localhost:3000';
  const id = '12345678-1234-1234-1234-123456789012';
  beforeEach(() => { vi.stubEnv('APP_URL', origin); vi.stubEnv('BETTER_AUTH_URL', origin); });
  afterEach(() => { vi.unstubAllEnvs(); });
  const completed = (records: Record<string, unknown>[]) => records.filter(record => record['event.name'] === 'api.test.failure.completed');
  function thrown(fn: () => unknown): unknown { try { fn(); } catch (error) { return error; } throw new Error('expected the call to throw'); }
  const request = (init: RequestInit = {}) => new Request(`${origin}/api/test`, { headers: { origin, 'x-request-id': id }, ...init });
  async function failure(fn: () => Promise<unknown>) {
    const records: Record<string, unknown>[] = [];
    const response = await withTelemetrySink(record => records.push(record), () => route(request(), 'api.test.failure', '/api/test', fn));
    return { response, body: await response.json() as { data?: unknown; error: { code: string; message: string }; requestId: string }, records };
  }

  it('answers a domain failure in English with its stable code and status', async () => {
    const { response, body, records } = await failure(async () => { throw new AppError('ORDERS_PAUSED', 'New orders are paused. Try again later.', 409); });
    expect(response.status).toBe(409);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-request-id')).toBe(id);
    expect(body).toEqual({ error: { code: 'ORDERS_PAUSED', message: 'New orders are paused. Try again later.' }, requestId: id });
    expect(completed(records)).toEqual([expect.objectContaining({ 'request.id': id, 'event.outcome': 'rejected', 'error.code': 'ORDERS_PAUSED' })]);
  });

  it('turns schema validation failures into INVALID_INPUT without echoing the submitted values', async () => {
    const { response, body, records } = await failure(async () => z.object({ email: z.string().email() }).strict().parse({ email: 'secret-customer@@bad', extra: 1 }));
    expect(response.status).toBe(400);
    expect(body.error).toEqual({ code: 'INVALID_INPUT', message: 'Review the information entered.' });
    expect(JSON.stringify([body, records])).not.toContain('secret-customer');
  });

  it('hides unexpected failures behind INTERNAL_ERROR and keeps the raw message out of telemetry', async () => {
    const { response, body, records } = await failure(async () => { throw new Error('connect ECONNREFUSED db.internal:5432 password=SECRET_VALUE'); });
    expect(response.status).toBe(500);
    expect(body.error).toEqual({ code: 'INTERNAL_ERROR', message: 'We could not complete the operation. Keep the tracking code.' });
    expect(body.requestId).toBe(id);
    expect(JSON.stringify([body, records])).not.toMatch(/ECONNREFUSED|SECRET_VALUE|db\.internal/);
    expect(completed(records)).toEqual([expect.objectContaining({ 'event.outcome': 'failure', 'error.code': 'INTERNAL_ERROR' })]);
  });

  it('rejects cross-site writes before running the handler', async () => {
    let ran = false;
    const response = await withTelemetrySink(() => {}, () => route(request({ method: 'POST', headers: { origin: 'https://untrusted.test', 'x-request-id': id } }), 'api.test.origin', '/api/test', async () => { ran = true; }));
    expect(ran).toBe(false);
    expect(response.status).toBe(403);
    expect((await response.json()).error).toEqual({ code: 'FORBIDDEN', message: 'Origin not allowed.' });
  });

  it('reports malformed bodies with distinct codes', async () => {
    const post = (body: BodyInit | null, headers: Record<string, string>) => new Request(`${origin}/api/test`, { method: 'POST', body, headers });
    await expect(jsonBody(post('{}', { 'content-type': 'text/plain' }))).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE', status: 415, message: 'Use application/json.' });
    await expect(jsonBody(post('{nope', { 'content-type': 'application/json' }))).rejects.toMatchObject({ code: 'INVALID_INPUT', status: 400, message: 'Invalid JSON.' });
    await expect(jsonBody(post('{}', { 'content-type': 'application/json', 'content-length': '70000' }))).rejects.toMatchObject({ code: 'BODY_TOO_LARGE', status: 413, message: 'The request is too large.' });
    await expect(jsonBody(post(JSON.stringify({ blob: 'x'.repeat(70000) }), { 'content-type': 'application/json' }))).rejects.toMatchObject({ code: 'BODY_TOO_LARGE', status: 413 });
  });

  it('validates pagination with an English INVALID_INPUT', () => {
    expect(pagination(new Request(`${origin}/api/test?limit=10&offset=20`))).toEqual({ limit: 10, offset: 20 });
    expect(thrown(() => pagination(new Request(`${origin}/api/test?limit=1000`)))).toMatchObject({ code: 'INVALID_INPUT', status: 400, message: 'Invalid pagination.' });
  });
});
