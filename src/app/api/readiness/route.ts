import { getSchema } from 'better-auth/db';
import { getDatabase } from '@/db';
import { getAuth } from '@/lib/auth';
import { getPaymentProvider } from '@/payments/registry';
import { AppError } from '@/core/contracts';
import { route } from '@/lib/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { assertSchemaReady } from '@/lib/readiness';
export async function GET(request: Request) {
  return route(request, 'api.readiness.check', '/api/readiness', async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      getPaymentProvider();
      const check = assertSchemaReady(getDatabase(), Object.keys(getSchema(getAuth().options)));
      await Promise.race([check, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new AppError('DEPENDENCY_NOT_READY', 'Readiness check timed out.', 503)), 2500); })]);
      return { status: 'ready', version: '0.1.0' };
    } catch {
      throw new AppError('DEPENDENCY_NOT_READY', 'Service is not ready to receive traffic.', 503);
    } finally { if (timer) clearTimeout(timer); }
  });
}
