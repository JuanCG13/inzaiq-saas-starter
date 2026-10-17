import { getDatabase } from '@/db';
import type { Actor } from '@/core/contracts';
import { emitEvent } from '@/lib/telemetry';
import { createRuntimeSettingsService } from './service';

export function runtimeSettings() {
  return createRuntimeSettingsService(getDatabase(), { telemetry: event => emitEvent(event.name, {
    'event.outcome': event.outcome, operation: event.operation, duration_ms: event.durationMs, 'error.code': event.errorCode,
  }) });
}

/** Check new admissions; already accepted operations retain their original lifecycle. */
export function assertAcceptingOrders(actor: Actor) { return runtimeSettings().assertAcceptingOrders(actor); }
