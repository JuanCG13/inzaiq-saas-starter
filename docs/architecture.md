# Architecture and assembly decisions

## Product contract

A coding agent clones a template, changes brand configuration and chooses modules, configures a database, runs migrations, verifies, and deploys. A business owner signs in, selects an organization, and authorizes a ChatGPT/Claude MCP connection. The assistant calls named domain operations; the same service enforces UI/API/MCP permissions and invariants.

| Layer | Implementation | Responsibility |
|---|---|---|
| Interface | Next.js App Router, React, Radix Dialog, Lucide | Accessible store/admin or POS workbench |
| HTTP | Next route handlers, Zod | Input limits, validation, same-origin checks, safe errors |
| Identity | Better Auth organization + JWT + MCP/CIMD plugins | Sessions, organization membership, OAuth 2.1/PKCE, consent |
| Agent transport | Official MCP TypeScript SDK | Streamable HTTP, capability discovery, typed tools |
| Domain | `src/core` | Money, inventory transactions, role/scope policy, audit and idempotency |
| Hosted payments | `src/payments`, official `stripe@23.0.0` SDK | Provider contract, persisted checkout attempts, signature verification and transactional payment events |
| Operational settings | `src/runtime` | Tenant notice and new-order admission control, version checks and audit |
| Persistence | Kysely, node-postgres, libSQL | Parameterized typed queries, migrations, database transactions |
| Diagnostics | Pino + OpenTelemetry | Correlated allowlisted events, spans and low-cardinality metrics |

No LLM runs inside the template, and no model API subscription is required by the application. The client's chosen agent performs reasoning through its own account. Availability of custom MCP connections depends on the client application's account/workspace settings.

## Why these pieces

Supabase and Neon both expose PostgreSQL; Turso/libSQL has SQLite semantics. A single domain service is feasible, a pretend universal connection string is not. Database adapters are explicit; portable migrations are executed on both SQLite and PostgreSQL WASM in tests. Cloud connectivity, TLS, pooler behavior and multi-node load must be tested in the chosen deployment.

We assemble established identity, protocol, SQL, validation and tracing packages instead of implementing a custom OAuth server, JSON-RPC protocol, ORM or password hashing. The business service is deliberately small application glue: it uses real transactions, guarded updates and database constraints. It is not presented as a complete commercial ERP or payment processor.

## Invariants

- Tenant context is derived from verified session membership or verified OAuth claims plus current membership/consent. A tenant header or model argument never grants access.
- Scope and role are intersected on every operation. Viewing data does not confer mutation privileges.
- Money is integer minor units; PYG uses zero decimal digits, USD uses two. Never multiply all currencies by 100. Different currencies cannot be combined in one sale.
- Product price and currency are read from the server at commit. HTTP checkout and MCP order creation require `expectedTotalMinor` and `expectedCurrency` to bind confirmation to both amount and currency; stale values roll back the transaction. These assertions never set the server price.
- Order, lines, stock changes and audit commit together. If audit persistence fails, the business transaction fails too. Diagnostic export failures do not affect the business result.
- Idempotency keys survive restarts and are bound to normalized request content. The order hash includes the expected total and expected currency, as well as items, channel, payment method and customer. Reusing a key with changed content is rejected.
- Pending orders reserve stock. Owner/admin confirms or cancels manual orders; hosted-payment orders change only through verified provider events. A failed or expired hosted session cancels a pending order and restores stock once. Completed orders cannot be cancelled through the pending-order endpoint.
- A browser payment return is not payment evidence. Hosted events must match the persisted tenant, order, session, amount and currency. Duplicate events do not repeat stock changes; a late payment after cancellation requires operational reconciliation.
- `acceptingOrders` is checked during new-order creation after existing idempotent requests are recognized. Pausing blocks new admissions; it does not cancel accepted orders or stop payment webhooks. Notice/settings writes require owner/admin, current version and transactional audit.
- Product edits require the current version. Stock changes require a separate adjustment reason: at most 240 characters in the domain/MCP and 200 through HTTP.
- Paginated domain reads allow up to 200 rows (50 by default); HTTP and MCP expose a stricter maximum of 100. HTTP list routes default to 100, while MCP inherits 50 when omitted. Dashboard recent orders are fixed at five.
- Demo access is restricted to development on loopback and is rejected in production. MCP always requires real OAuth, even in demo mode.

## Boundaries and extension points

See `template.manifest.json`. `src/template.config.ts` owns build-time branding, locale, currency and module switches. `npm run configure -- --name "Client" --currency PYG --locale es-PY` updates branding without modifying existing amounts. Only the tenant notice and new-order admission setting change live through the [runtime settings contract](runtime-settings.md); they do not modify executable code or credentials. Extend modules by adding a domain method with tests, then expose a schema-validated HTTP route and a scoped MCP tool. The transport must not contain business rules.

Ecommerce supports manual payment coordination and optional Stripe hosted Checkout through an explicit provider interface. The adapter uses `stripe@23.0.0` and API `2026-09-30.endive`; card data stays with Stripe. Provider tests use real SDK signature verification and simulated responses, without an external Stripe account test or live charge. See [payments](payments.md). Additional gateways, shipping carriers, fiscal invoices, returns/refunds, discounts, weighted/fractional stock, multi-warehouse transfers and offline synchronization remain separate modules. Each size/color variant can initially be a distinct SKU.

Application code is deployed as a new immutable release, not modified in running processes. `/api/health` reports process liveness independently of the database. `/api/readiness` checks required migration records and configured auth tables, plus local payment-provider configuration, before accepting traffic; it does not make a Stripe account/network validation call. See the [production runbook](production.md) for rollout and rollback.

## Design

Clear hierarchy, generous whitespace, a restrained accent, familiar controls and progressive disclosure are inspired by Apple HIG. Chris Do's clarity/typographic hierarchy and COLLINS' coherent visual systems inform the communication. This is not an Apple clone; no proprietary fonts or Apple assets are bundled. Monetary totals use tabular numerals, focus is visible, dialogs support keyboard interaction and motion respects reduced-motion preferences. Demo photos are external Unsplash samples, replace them with licensed customer assets for delivery.

## Read before extending

Verified during implementation, 2026-10-17:
- https://nextjs.org/docs/app/getting-started/installation
- https://better-auth.com/docs/adapters/other-relational-databases
- https://better-auth.com/docs/plugins/organization
- https://better-auth.com/docs/plugins/mcp
- https://modelcontextprotocol.io/docs/sdk
- https://kysely.dev/docs/getting-started
- https://docs.turso.tech/sdk/ts/reference
- https://supabase.com/docs/guides/database/connecting-to-postgres
- https://developer.apple.com/design/human-interface-guidelines
- https://opentelemetry.io/docs/languages/js/
