# Database and commerce contract

The application assembles Kysely, `pg`, and the Turso-maintained `@libsql/kysely-libsql` dialect. Business rules use one service across HTTP, admin UI, and MCP. They do not call an LLM and do not accept arbitrary SQL.

## Providers

| DATABASE_PROVIDER | DATABASE_URL | Driver | Notes |
| --- | --- | --- | --- |
| `supabase` | PostgreSQL connection URL | `pg` | Server connection only; never use the Supabase anonymous client to write commerce tables. |
| `neon` | PostgreSQL connection URL | `pg` | Use the provider's pooled runtime URL; run migration as the trusted table owner. |
| `postgres` | PostgreSQL connection URL | `pg` | PostgreSQL compatible host; TLS certificate checks remain enabled. |
| `turso` | `libsql://...` plus TURSO_AUTH_TOKEN | libSQL | Token and URL remain server-only. Provider transaction limits apply. |
| `sqlite` | `file:./commerce.db` | libSQL local | Node runtime, durable local volume required. Development default. |

`createDatabase(config)` returns a Kysely instance. `getDatabase()` lazily creates one singleton per process. `migrateDatabase(db, { provider? })` runs versioned migrations; the optional provider argument exists for external dialects such as PostgreSQL WASM in tests. No request runs migrations or seeds automatically. Production requires an explicit DATABASE_URL.

Use a temporary **file** for SQLite integration tests. Do not rely on `file::memory:` with multiple connections: ephemeral database lifetime/pooling differs by client version. The factory uses the explicitly installed current `@libsql/client` through the official exported `LibsqlDriver` and closes it with `db.destroy()`, avoiding the dialect's older transitive client. Local files enable WAL during driver initialization. A regression test with two independent clients demonstrated a residual SQLITE_BUSY lock with the default journal; WAL plus the current client preserves database usability after concurrent checkout. A local SQLite file is unsuitable for independently scaled serverless instances. Use a managed network provider for that deployment model. Transactions are online; this template does not implement disconnected POS synchronization.

## PostgreSQL pool budget

Each Node process owns one lazy application pool. `postgres`, `supabase`, and `neon` accept these server environment settings; SQLite/Turso ignore them:

| Setting | Default | Allowed integer range | Purpose |
| --- | --- | --- | --- |
| `PG_POOL_MAX` | `5` | `1`–`100` | Maximum clients in this process's pool. |
| `PG_CONNECTION_TIMEOUT_MS` | `10000` | `100`–`60000` | Bounded wait for acquisition/connection, in milliseconds. |
| `PG_IDLE_TIMEOUT_MS` | `30000` | `1000`–`600000` | Close unused clients after this idle period, in milliseconds. |

Unset values use the defaults. Empty values, whitespace, signs, fractions, exponential notation and out-of-range numbers fail before pool construction. Zero is rejected so connection and idle waits cannot silently become unlimited. The explicit factory accepts the equivalent numeric options `maxConnections`, `connectionTimeoutMillis`, and `idleTimeoutMillis`; it does not read environment overrides. Changes require restarting the process. These are pool limits, not SQL statement timeouts; the factory does not force `statement_timeout` or session-level SQL on transaction poolers.

Budget **peak replicas × Node processes per replica × PG_POOL_MAX + worker pools + migration/admin connections**, with reserve capacity below the provider limit. Include old and new replicas during rolling deployments and autoscaling bursts. For example, 8 peak replicas with 1 process and pool size 5 consume at most 40 application connections; two workers with pools of 3 add 6, before migrations, monitoring and operational reserve. This example is capacity arithmetic, not a recommended production pool size. Every additional `createDatabase()` call creates another pool, so scripts and workers must close their instance with `db.destroy()` and be counted separately.

When a managed transaction pooler is used, application client connections and the pooler's upstream PostgreSQL connections have separate limits. Verify both limits and the plan's actual quotas; increasing this process's maximum is not evidence of greater database throughput. Load-test expected concurrency and inspect wait times, database CPU/locks and provider metrics before increasing replicas or pool size. Local tests exercise configuration and driver construction without opening network connections; they do not establish cloud capacity.

Invalid pool settings expose only a fixed setting name/range and `DATABASE_POOL_CONFIG_INVALID`. Existing HTTP/MCP operation boundaries emit the normalized error code with request correlation; the factory does not log configuration objects, supplied values or connection strings. Tests capture success/failure terminal events at that boundary and verify secret redaction. Driver behavior reference: [node-postgres Pool](https://node-postgres.com/apis/pool).

An idle-client failure emits one `db.pool.connection.failed` event with `DB_POOL_IDLE_ERROR`; a listener prevents that background EventEmitter error from terminating Node. The driver removes the failed idle client. This adds no transaction replay or query retry, and a failing telemetry exporter cannot change the handler's behavior. Background failures may have no active request context; no request or trace ID is fabricated. Tests inject a pool error without contacting a database and assert one redacted event and safe exporter failure.

## Isolation and access

Every business query filters by `tenant_id`, resolved from authenticated organization membership. Product SKU uniqueness is `(tenant_id, sku)`. Order-item foreign keys include both tenant and resource IDs, preventing cross-tenant links even if an application query is incorrect. Business tables are prefixed `commerce_`; Better Auth owns its own unprefixed tables. Tenant IDs deliberately have no foreign key into the auth schema, allowing independent migrations and test fixtures. Authenticated membership must therefore be verified by the transport before constructing an Actor.

PostgreSQL migrations enable row-level security with **no client policy** on all commerce and migration tables. This denies ordinary direct client/PostgREST access. The server uses the trusted table-owner connection, which can bypass RLS and must enforce the service's tenant checks. This is not database-enforced isolation against a compromised backend. Do not grant untrusted roles ownership, BYPASSRLS, or the backend connection string. PostgreSQL RLS behavior is independently tested with PGlite; managed Supabase/Neon role grants still need deployment verification.

Role and OAuth scope checks both apply. Undefined scopes mean an authenticated first-party session; an explicit empty scope list grants nothing. Owner/admin can operate all authorized domain methods. Cashier can read products/orders/dashboard and create sales. Viewer can read products/orders/dashboard. Only owner/admin can mutate products/stock, inspect audit records, confirm/cancel manual orders, or administer runtime settings. Hosted-payment orders cannot be manually confirmed or cancelled through those order endpoints. Runtime administration additionally requires `settings:read` or `settings:write` for OAuth actors. Route/MCP adapters must not construct tenant or role from arbitrary submitted JSON.

## Money, inventory, and order lifecycle

- All amounts are nonnegative safe JavaScript integers in the currency's smallest unit. PYG has no decimal subdivision; USD uses cents. PostgreSQL `bigint` results are converted explicitly, without global `pg` type-parser changes. Maximum supported line and order total: `Number.MAX_SAFE_INTEGER`.
- Maximum stock: 1,000,000,000 units per product. Maximum requested quantity: 1,000,000 units per product per order. Maximum 100 submitted order lines. Duplicate product lines are combined and sorted before hashing and locking.
- Product prices are read atomically from server rows while stock is decremented. Client line prices are rejected. `expectedTotalMinor` and `expectedCurrency` are confirmation assertions, not client-provided prices. HTTP checkout and MCP order creation require both; the domain accepts them optionally for internal callers. A stale total produces PRICE_CHANGED; a stale currency produces CURRENCY_CHANGED even when the integer total is unchanged. Either rejection rolls back the entire transaction.
- Stock decrement uses conditional SQL `stock >= quantity`; product creation, edits, stock adjustment, checkout, and order status transitions write audit records in the same transaction.
- A `web` order or manual POS payment starts `pending` and immediately reserves stock by decrementing available units. An owner/admin explicitly confirms/cancels orders without a payment provider. Cash POS sales complete immediately. Hosted orders retain the compatible `payment_method=manual` storage value and are distinguished by `payment_provider`; their lifecycle is managed only by verified payment events. Manual reservations have no automatic timeout. Hosted expiry/failure releases stock only when its verified event is processed; there is no background expiry/reconciliation sweep.
- Only pending orders can transition. Repeating the same terminal status is idempotent. Cancelling twice cannot restore twice. Completed sales require a separate future refund/return workflow; they cannot be cancelled through this API.
- `updateProduct` requires the last observed version. `adjustStock` can include an expected version. Stock changes and checkout increment product versions, making stale admin changes visible.
- Customer name/email and optional phone/address are persisted only as order business data. They never enter diagnostic events or audit payloads. Protect order access and define customer retention before accepting real personal data. Audit reason text is intentional business audit data and should not include secrets.

## Persistent idempotency and concurrency

Orders are unique by `(tenant_id, idempotency_key)`. A SHA-256 hash covers normalized products/quantities, channel, payment method, customer, optional expected total, and optional expected currency. The transaction claims the key before decrementing stock. Repeating the same request returns the existing order; changing any hashed field returns IDEMPOTENCY_CONFLICT. Failed transactions leave no key or stock mutation behind. Keys are retained with orders; reuse them only for retries of the same operation.

Hosted requests also bind the payment provider into their hash; legacy manual hashes remain compatible. The order transaction commits before the provider network call. A timeout after order reservation therefore leaves a pending order for recovery with the same checkout key, not an automatically cancelled order or a fresh payment attempt.

Stock adjustments use their own persistent idempotency table and store the original response snapshot. Hash covers product, delta, reason, and optional version. The domain and MCP allow stock reasons up to 240 characters; the HTTP inventory endpoint uses a stricter 200-character limit. The same key cannot apply a second delta or switch products. A replay returns the original snapshot, which can be older than current inventory; reload the product when current inventory is needed.

Deadlocks, transaction serialization failures, and SQLite busy errors are retried at most twice after rollback (10 ms, then 20 ms). Unknown commit outcomes are **not** blindly retried. A client can safely retry orders/stock adjustments with the original idempotency key. Paginated domain reads default to 50 results and allow at most 200, with offsets up to 1,000,000. HTTP product/order listing defaults to 100 and caps pages at 100, with offsets up to 100,000; HTTP audit currently returns the latest 100. MCP caps requested pages at 100 and inherits the domain default of 50 when omitted; its offset is ultimately bounded by the domain. Dashboard recent orders are fixed at five. High-volume exports require a separate cursor/export module.

## Rate limiting storage

`commerce_rate_limits` contains `key`, `count`, `expires_at`. The HTTP adapter owns atomic bucket updates and request policy; it stores no raw IP or request body. Expired buckets require periodic deletion. This table does not replace upstream WAF, per-source abuse controls, or provider capacity limits.

## Hosted payments and runtime migrations

Additive migration `202610170002_payments` adds `payment_provider` to orders and creates `commerce_payment_attempts` and `commerce_payment_events`. Attempts are unique by tenant/order, provider/session and provider/idempotency key; events are unique by provider/event ID and bind a hash of normalized signed fields. Foreign keys include tenant and order. No raw webhook body or card data is stored.

The provider call runs outside a SQL transaction. Its session binding becomes durable before a webhook may apply. A verified event must match tenant, order, provider, session, total and currency; event deduplication, status transition, stock restoration and audit commit together. Failure/expiry only cancels pending orders. Paid-after-cancelled events flag `reconciliation_required`; they do not automatically refund, reopen the order or decrement stock. A timeout past the conservative provider retry window also requires operator reconciliation. Follow [payments](payments.md); no automated reconciliation worker is implemented.

Migration `202610170003_runtime` adds `commerce_runtime_settings`: one tenant row with version, accepting-orders state, notice and update time. Missing rows read as version 0, accepting orders, empty notice. Settings changes use atomic compare-and-swap plus `settings.updated` audit; stale edits return 409 and audit failure rolls back the change. Notice text is excluded from diagnostics/audit metadata. New-order creation checks admission after idempotent replay detection. See [runtime settings](runtime-settings.md).

The payment and runtime tables receive PostgreSQL default-deny RLS with the same trusted-backend boundary as the existing commerce tables. Apply migrations explicitly before rollout. `/api/readiness` checks required migration records and configured auth tables; it does not migrate or prove cloud-provider behavior. `/api/health` intentionally does not depend on database connectivity.

## Errors

| Code | HTTP | Meaning / safe response |
| --- | --- | --- |
| UNAUTHENTICATED | 401 | Obtain a valid authenticated actor. |
| FORBIDDEN | 403 | Role or scope is insufficient. |
| INVALID_INPUT | 400 | Correct the validated field. |
| NOT_FOUND | 404 | Resource does not exist inside the selected tenant. |
| CONFLICT | 409 | SKU/resource uniqueness conflict. |
| VERSION_CONFLICT | 409 | Reload the current product/settings and review the proposed change. |
| ORDERS_PAUSED | 409 | New-order admission is paused; accepted orders retain their lifecycle. |
| PAYMENT_PROVIDER_MANAGED | 409 | Hosted orders require verified provider events instead of manual status changes. |
| PAYMENT_RECONCILIATION_REQUIRED | 409 | Review persisted payment/provider state; do not create a replacement charge. |
| INSUFFICIENT_STOCK | 409 | An item is unavailable, inactive, foreign, or lacks stock. |
| STOCK_LIMIT | 409 | Adjustment/restoration would violate stock limits. |
| IDEMPOTENCY_CONFLICT | 409 | A retry key was reused with a different payload. |
| CURRENCY_CHANGED | 409 | Refresh the approved currency and review the new total. |
| PRICE_CHANGED | 409 | Refresh prices and have the client confirm the new total. |
| ORDER_STATUS_CONFLICT | 409 | A terminal order cannot change to another status. |
| RETRY_REQUIRED | 409 | Known transaction conflict exceeded bounded retries. |
| MIXED_CURRENCY | 422 | Split the order into one order per currency. |
| MONEY_OVERFLOW | 422 | Amount exceeds exact supported arithmetic. |

Unexpected database errors propagate to the owning HTTP/MCP telemetry boundary. Never return raw SQL, connection strings, provider errors, or stack traces to clients.

## Telemetry plan and integration

| Stage | Signal | Context / verification |
| --- | --- | --- |
| Permission and validation | terminal `commerce.operation.completed` rejected | Bounded operation/error code; role/scope and malformed input tests. |
| Transaction dependency | `commerce.operation.retry` | Retry count and normalized concurrency reason only. |
| Commit | transactional `commerce_audit` row | Opaque actor/tenant/resource IDs and allowlisted business facts. Rollback and duplicate tests assert exactly one mutation. |
| Domain outcome | `commerce.operation.completed` | Schema version, stable operation, success/rejected/failure, monotonic duration. |
| Transport exception | HTTP/MCP owning boundary | Correlated exception capture, redaction, and request response are adapter responsibilities. |

Pass `createCommerceService(db, { telemetry })` from transport adapters; the hook lets their OpenTelemetry/Pino context attach active trace/request fields. The domain never fabricates trace IDs. A missing hook means no diagnostic export. Synchronous exporter exceptions are isolated. Audit writes intentionally do not fail open: an unaudited mutation rolls back.

Domain tests exercise real libSQL files, success and rejection telemetry, unexpected DB failure, exporter failure, cross-tenant queries, roles/scopes, rollback, idempotency, money overflow, customer redaction, version conflicts, and terminal order transitions. Independent tests exercise PostgreSQL dialect and constraints using PGlite; production network/connection pooling/Turso quotas still require provider staging checks.

## Demo and extension boundaries

`seedDemo(db, actor, variant)` in `src/db/seed.ts` is an explicit nonproduction operation. It inserts six products by missing SKU and never overwrites price or stock. Ecommerce uses NOMA sample products in USD; POS uses sample retail/grocery products in PYG. Sample image URLs reference external Unsplash imagery; replace with owned customer assets before launch.

Stripe hosted Checkout is implemented; its SDK and domain tests do not establish a connection to an external Stripe account. Not implemented: tax rules/invoicing, shipping quotes/labels, refunds, multi-location inventory, purchase orders, variants, offline sync, hardware fiscal printers, automatic manual-reservation expiry and background payment reconciliation. Those require separate modules and acceptance tests. Database provider configuration is prepared; a live Supabase/Neon/Turso credentialed deployment has not been verified by these local tests.

References checked for assembly: [Kysely migrations](https://kysely.dev/docs/migrations), [Kysely PostgreSQL setup](https://kysely.dev/docs/getting-started), [Turso Kysely dialect](https://github.com/tursodatabase/kysely-libsql). Installed package source was inspected to resolve stale indexed documentation around local `file:` support.
