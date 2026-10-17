import { route } from '@/lib/http';
import { storeActor } from '@/lib/request-actor';
import { runtimeSettings } from '@/runtime/server';
import { templateConfig } from '@/template.config';
import { AppError } from '@/core/contracts';

export const runtime = 'nodejs';
export function GET(request: Request) {
  return route(request, 'api.store.settings', '/api/store/settings', async () => {
    if (templateConfig.kind !== 'ecommerce') throw new AppError('MODULE_DISABLED', 'Tienda pública no habilitada.', 404);
    return { settings: await runtimeSettings().getOperationalSettings(storeActor()) };
  });
}
