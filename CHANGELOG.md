# Changelog

## 0.1.0 — 2026-10-17

- Initial modular Next.js template with real SQL-backed catalog, inventory, orders, audit, tenant isolation, roles and safe money handling.
- Official MCP SDK, Better Auth OAuth/PKCE, tenant-bound consent, granular scopes and immediate revocation.
- Server-derived prices, approved total/currency validation, versioned updates, durable idempotency and atomic cancellation/restocking.
- Supabase/Neon PostgreSQL and Turso/libSQL adapters, portable migrations, default-deny RLS and development-only seed.
- Structured redacted telemetry, optional OpenTelemetry, diagnostics and CI.
- Functional responsive UI and agent assembly documentation.
- Regressions covered: cross-tenant access, audit failure rollback, competing stock sales, stale prices/currency and duplicate writes.

- Configuración operativa por empresa en caliente, CAS, auditoría y herramientas MCP de ajustes.
- Docker standalone, readiness de esquema, despliegue gradual y runbook para agentes/rollback.
- Puerto intercambiable de pagos y Stripe Checkout oficial: firma, idempotencia, recuperación, webhook y conciliación explícita.

### Escala y extensibilidad

- Carga por lotes de las líneas de pedidos e índice de catálogo por empresa/nombre/ID.
- Pool PostgreSQL configurable con validación y presupuesto por réplica.
- Guías de escala y extensión por módulos, con mapa de archivos y contratos para agentes.
