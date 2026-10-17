import http from 'k6/http';
import { check, fail } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// All traffic is GET. No seed, checkout, inventory adjustment, payment or mutation.
const KIND = 'ecommerce';
function integer(name, fallback, min, max) {
  const raw = __ENV[name] === undefined ? String(fallback) : __ENV[name];
  if (!/^[0-9]+$/.test(raw)) throw new Error(`${name} must be an integer.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} is out of range.`);
  return value;
}
const base = (__ENV.BASE_URL || '').replace(/\/$/, '');
const origin = /^(https?):\/\/(\[[0-9a-fA-F:]+\]|[a-zA-Z0-9.-]+)(:\d{1,5})?$/.exec(base);
if (!origin || (origin[1] !== 'https' && !['localhost', '127.0.0.1', '[::1]'].includes(origin[2]))) {
  throw new Error('BASE_URL must be an HTTPS origin, or HTTP localhost. No credentials, path or query.');
}
const targetRate = integer('RATE', 5, 1, 1000);
const rampSeconds = integer('RAMP_SECONDS', 10, 1, 300);
const holdSeconds = integer('HOLD_SECONDS', 30, 1, 1800);
const downSeconds = integer('DOWN_SECONDS', 10, 1, 300);
const preAllocatedVUs = integer('PREALLOCATED_VUS', 5, 1, 2000);
const maxVUs = integer('MAX_VUS', 25, preAllocatedVUs, 2000);
const timeoutSeconds = integer('TIMEOUT_SECONDS', 5, 1, 30);
const pageSize = integer('PAGE_SIZE', 20, 1, 100);
const catalogPages = integer('CATALOG_PAGES', 1, 1, 1000);
const p95Milliseconds = integer('P95_MS', 750, 1, 60000);
const journeyP95Milliseconds = integer('JOURNEY_P95_MS', 1500, 1, 120000);
const errorRate = __ENV.MAX_ERROR_RATE === undefined ? 0.01 : Number(__ENV.MAX_ERROR_RATE);
if (!Number.isFinite(errorRate) || errorRate < 0 || errorRate > 0.1 || __ENV.MAX_ERROR_RATE === '') {
  throw new Error('MAX_ERROR_RATE must be between 0 and 0.1.');
}
const runId = __ENV.RUN_ID || 'read-baseline';
if (!/^[a-zA-Z0-9_-]{1,64}$/.test(runId)) throw new Error('RUN_ID must contain 1..64 letters, numbers, underscores or hyphens.');

let cookies = [];
if (KIND === 'pos') {
  if (__ENV.AUTH_COOKIE && __ENV.AUTH_COOKIES_JSON) throw new Error('Supply AUTH_COOKIE or AUTH_COOKIES_JSON, not both.');
  try { cookies = __ENV.AUTH_COOKIES_JSON ? JSON.parse(__ENV.AUTH_COOKIES_JSON) : [__ENV.AUTH_COOKIE]; }
  catch { throw new Error('AUTH_COOKIES_JSON must be a JSON array of session cookie header strings.'); }
  if (!Array.isArray(cookies) || cookies.length < 1 || cookies.length > 500 || cookies.some(value => typeof value !== 'string' || !value.includes('=') || /[\r\n]/.test(value))) {
    throw new Error('Supply 1..500 valid session Cookie header strings through environment variables only.');
  }
}
const businessErrors = new Rate('business_errors');
const journeyDuration = new Trend('journey_duration', true);
export const options = {
  scenarios: {
    reads: {
      executor: 'ramping-arrival-rate', startRate: 1, timeUnit: '1s',
      preAllocatedVUs, maxVUs,
      stages: [
        { target: targetRate, duration: `${rampSeconds}s` },
        { target: targetRate, duration: `${holdSeconds}s` },
        { target: 0, duration: `${downSeconds}s` },
      ],
      gracefulStop: `${timeoutSeconds * 2 + 5}s`,
    },
  },
  setupTimeout: '45s',
  maxRedirects: 0, // Never forward an authentication cookie through a redirect.
  insecureSkipTLSVerify: false,
  systemTags: ['status', 'method', 'name', 'scenario', 'expected_response'],
  tags: { template: KIND, test_run: runId },
  thresholds: {
    'http_req_duration{phase:load}': [`p(95)<${p95Milliseconds}`],
    'http_req_failed{phase:load}': [`rate<=${errorRate}`],
    business_errors: [{ threshold: `rate<=${errorRate}`, abortOnFail: true, delayAbortEval: '10s' }],
    journey_duration: [`p(95)<${journeyP95Milliseconds}`],
    dropped_iterations: ['count==0'],
    'http_reqs{phase:load}': ['count>0'],
  },
};
function get(path, name, phase, cookie) {
  const headers = { Accept: 'application/json' };
  if (cookie) headers.Cookie = cookie;
  return http.get(`${base}${path}`, {
    headers, timeout: `${timeoutSeconds}s`, redirects: 0,
    tags: { name, phase },
  });
}
function data(response) {
  if (response.status !== 200) return undefined;
  try { return response.json().data; } catch { return undefined; }
}
function products(response) {
  const body = data(response);
  return body && Array.isArray(body.products) ? body.products : undefined;
}
function validProduct(product) {
  return product && typeof product.id === 'string' && product.id.length > 0
    && typeof product.name === 'string' && typeof product.currency === 'string'
    && Number.isSafeInteger(product.priceMinor) && product.priceMinor >= 0;
}
function result(valid, name) {
  check(valid, { [name]: value => value === true });
  businessErrors.add(!valid);
}
const catalogPath = KIND === 'pos' ? '/api/admin/products' : '/api/store/products';
export function setup() {
  const health = get('/api/health', 'GET /api/health', 'setup');
  let healthy = false;
  try { healthy = health.status === 200 && health.json().status === 'ok'; } catch { /* No response content in logs. */ }
  if (!healthy) fail('Process health failed. Check the target before load.');
  const ready = data(get('/api/readiness', 'GET /api/readiness', 'setup'));
  if (!ready || ready.status !== 'ready') fail('Readiness failed. Check configuration and migrations before load.');
  const list = products(get(`${catalogPath}?limit=${pageSize}&offset=0`, `GET ${catalogPath}`, 'setup', cookies[0]));
  if (!list || list.length === 0 || !list.every(validProduct)) fail('Catalog/auth check failed. Seed the staging tenant and select its organization before load.');
  if (KIND === 'pos') {
    const history = data(get('/api/admin/orders?limit=20&offset=0', 'GET /api/admin/orders', 'setup', cookies[0]));
    if (!history || !Array.isArray(history.orders)) fail('Order history/auth check failed before load.');
  }
  // Public product IDs only; credentials never enter setup data or metric tags.
  return { productIds: list.map(product => product.id) };
}
export default function (setupData) {
  const startedAt = Date.now();
  const cookie = KIND === 'pos' ? cookies[(__VU - 1) % cookies.length] : undefined;
  const offset = ((__ITER + __VU - 1) % catalogPages) * pageSize;
  const list = products(get(`${catalogPath}?limit=${pageSize}&offset=${offset}`, `GET ${catalogPath}`, 'load', cookie));
  const catalogValid = Boolean(list && list.length > 0 && list.every(validProduct));
  result(catalogValid, 'catalog response matches contract');
  if (KIND === 'pos') {
    const history = data(get('/api/admin/orders?limit=20&offset=0', 'GET /api/admin/orders', 'load', cookie));
    result(Boolean(history && Array.isArray(history.orders) && history.orders.every(order => typeof order.id === 'string' && Number.isSafeInteger(order.totalMinor))), 'order history response matches contract');
  } else {
    const candidates = catalogValid ? list.map(product => product.id) : setupData.productIds;
    const id = candidates[(__ITER + __VU - 1) % candidates.length];
    const detail = data(get(`/api/store/products/${encodeURIComponent(id)}`, 'GET /api/store/products/:id', 'load'));
    result(Boolean(detail && validProduct(detail.product) && detail.product.id === id), 'product detail response matches contract');
  }
  journeyDuration.add(Date.now() - startedAt);
}
