# Changelog

[English](CHANGELOG.md) · [Español](CHANGELOG.es.md)

## Unreleased

### Documentation

- Adopt the renamed InzaiQ starter repository identity in project documentation and clone instructions.
- Replace the landing README with a structured English overview and a complete Spanish counterpart.
- Add real desktop and mobile interface screenshots, a visual gallery and a documentation index with language labels.

## 0.1.0 — 2026-10-17

- Initial modular Next.js template with real SQL-backed catalog, inventory, orders, audit, tenant isolation, roles and safe money handling.
- Official MCP SDK, Better Auth OAuth/PKCE, tenant-bound consent, granular scopes and immediate revocation.
- Server-derived prices, approved total/currency validation, versioned updates, durable idempotency and atomic cancellation/restocking.
- Supabase/Neon PostgreSQL and Turso/libSQL adapters, portable migrations, default-deny RLS and development-only seed.
- Structured redacted telemetry, optional OpenTelemetry, diagnostics and CI.
- Functional responsive UI and agent assembly documentation.
- Regressions covered: cross-tenant access, audit failure rollback, competing stock sales, stale prices/currency and duplicate writes.
- Tenant-scoped runtime configuration, compare-and-swap updates, auditing and MCP settings tools.
- Standalone Docker configuration, schema-aware readiness, gradual deployments and agent/rollback runbooks.
- Interchangeable payment contract and official Stripe Checkout integration: signatures, idempotency, recovery, webhooks and explicit reconciliation.

### Scaling and extensibility

- Batch order-line loading and a tenant/name/ID catalog index.
- Validated PostgreSQL pool configuration and per-replica connection budgeting.
- Scaling and module-extension guides with an agent-facing map of files and contracts.
