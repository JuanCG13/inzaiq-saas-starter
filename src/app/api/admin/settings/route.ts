import { route, jsonBody } from '@/lib/http';
import { requestActor } from '@/lib/request-actor';
import { runtimeSettings } from '@/runtime/server';
import type { UpdateRuntimeSettings } from '@/runtime/contracts';

export const runtime = 'nodejs';
export function GET(request: Request) {
  return route(request, 'api.settings.read', '/api/admin/settings', async () => ({ settings: await runtimeSettings().getSettings(await requestActor(request)) }));
}
export function PATCH(request: Request) {
  return route(request, 'api.settings.update', '/api/admin/settings', async () => {
    const actor = await requestActor(request);
    return { settings: await runtimeSettings().updateSettings(actor, await jsonBody(request) as UpdateRuntimeSettings) };
  });
}
