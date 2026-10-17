# Runtime operational settings

Owners and administrators can change a small, explicit set of tenant settings without rebuilding the application. This does not edit executable code, deployment variables, payment credentials, monetary configuration or the module list.

| Field | Contract |
| --- | --- |
| `version` | Integer compare-and-swap token. An unsaved tenant reads version `0`; each successful save increments it. |
| `acceptingOrders` | Boolean admission control for new orders/sales. Default `true`. |
| `notice` | Plain text, at most 200 characters; empty removes the notice. Public for the ecommerce store, authenticated within POS. Never enter secrets or personal information. It is shown exactly as typed in every language; it is not translated. |

Settings belong to the actor's verified tenant. A body, query string or header cannot choose a different tenant. `GET /api/admin/settings` requires owner/admin plus `settings:read` for OAuth actors. `PATCH /api/admin/settings` requires owner/admin plus `settings:write` and the entire `{version, acceptingOrders, notice}` object. Unknown fields are rejected. First-party sessions have role checks without an OAuth scope list.

The ecommerce public `GET /api/store/settings` uses only the configured `STORE_TENANT_ID`. POS exposes authenticated `GET /api/runtime/settings` for operational displays, including cashiers/viewers with `products:read`; it grants no configuration privileges. Responses use `Cache-Control: no-store`.

## Persistence and conflict handling

`commerce_runtime_settings` stores one row per tenant. The migration is additive: ecommerce `202610170003_runtime`, POS `202610170002_runtime`. PostgreSQL RLS denies untrusted direct clients; the trusted backend still filters by tenant. Reads do not create rows or run migrations.

The settings mutation and its `settings.updated` audit record commit in one database transaction. An insert or update succeeds only for the supplied version; a stale version returns `VERSION_CONFLICT` (409). A failed audit write rolls the setting back. The audit stores version, accepting-orders status and whether a notice exists; it deliberately excludes the notice text. There is no force-write endpoint.

Admin forms preserve the current draft when a newer version arrives, disable stale saves and offer **Reload values** (**Recargar valores** in Spanish). The user must review the reloaded values before saving again. Every open operational display checks the server every 30 seconds while visible and on window focus. Same-window saves also trigger refresh. There is no shared browser/server tenant cache.

Pausing is admission control. It rejects new submissions with `ORDERS_PAUSED` (409; the API message is English and the browser shows the `errors.codes.ORDERS_PAUSED` text of the active language, see [languages](i18n.md)); it does not cancel orders, release inventory, invalidate sessions, stop payment reconciliation or replace infrastructure draining. An operation already admitted can finish. Retries of an already persisted idempotent operation remain subject to the original payload validation and do not create a new sale.

## Module contracts

- `createRuntimeSettingsService(db, {telemetry?})` exports `getSettings`, `getOperationalSettings`, `updateSettings`, and `assertAcceptingOrders`.
- `runtimeSettings()` in `src/runtime/server.ts` wires the service to the database and existing server telemetry.
- `assertAcceptingOrders(actor)` is the admission helper used by order transports.
- `RuntimeNotice`, `AdminRuntimeSettings`, and `useRuntimeSettings` are in `src/runtime/components.tsx`; their labels come from the `runtime` namespace (`src/i18n/messages/<language>/runtime.json`), loaded by the root layout. A notice component can report loaded settings through `onSettingsChange` to avoid a second poller in checkout.

## Telemetry and verification

| Stage | Signal | Safe context and verification |
| --- | --- | --- |
| Admin view and submit | `ui.settings.viewed`, `ui.settings.submitted` | Stable outcome/stage only; never field values. |
| Browser HTTP | Existing `ui.request.completed` | Request ID, route, status, duration; same ID propagated to backend. |
| Read/update/admission | `commerce.operation.completed` | `settings.read`, `settings.operational.read`, `settings.update`, `settings.orders.check`; outcome, duration and normalized error code. |
| HTTP boundary | `api.settings.*.completed`, `api.store.settings.completed` | Existing request correlation, safe errors and latency metrics. |
| Commit | `settings.updated` audit | Transactional versions/status, no notice contents. |
| Form outcome | `ui.settings.saved`, `ui.settings.reloaded` | Success/rejected/failure without payload. |

Diagnostic failures cannot change business results. Browser correlation uses the existing safe request-ID fallback; it is not claimed as complete W3C browser tracing. No new telemetry exporter is introduced.

`tests/runtime-settings.test.ts` exercises real SQLite and PostgreSQL WASM: migration idempotence, defaults, persistence, tenant isolation, roles/scopes, strict validation, concurrent compare-and-swap, rollback, pause/resume, RLS and diagnostic redaction/exporter failure. `tests/runtime-settings-http.test.ts` checks transport authorization, origin protection, conflict responses, cache headers and correlated diagnostics. These local engines do not certify cloud connectivity or cross-region consistency.
