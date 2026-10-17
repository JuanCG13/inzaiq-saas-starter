# Changelog

[English](CHANGELOG.md) · [Español](CHANGELOG.es.md)

## Unreleased

### Added

- English and Spanish interface with locale-prefixed routes (`/en`, `/es`), a language selector, and a proxy that picks the saved choice, then the browser language, then the installation default while preserving query strings (OAuth continuations included).
- Internationalization foundation for more languages: per-feature message catalogs with plural support, a one-line language registry, server-rendered `<html lang>` and metadata, and parity tests that report missing keys, placeholders and plural forms for every registered language.
- Server messages are English with stable error codes; the browser shows the localized text from `errors.codes.<CODE>`, and a test requires every new code to be translated.
- Default currency is USD and configurable: `npm run configure -- --currency EUR --currencies EUR,USD,GBP` validates ISO 4217 codes with the same code the app uses, `npm run doctor` checks the settings, and the product editor offers the configured list. Existing prices are never converted.
- Automated screenshot tour of 23 screens (`npm run screenshots`), compact WebP images, and a generated English/Spanish gallery.
- First-party demo artwork in `public/demo` replaces third-party photo URLs, so the demo and the screenshots work offline.
- Browser scenarios for language negotiation, switching, translated 404s, currency formatting and API/proxy boundaries (36 browser tests in total).

### Changed

- The demo catalog and every default screen are in English. `template.config.ts` replaces `locale` with `i18n.defaultLocale`/`i18n.locales`, adds `currencies`, and accepts a per-language `description`. `npm run configure` now takes `--locale`, `--locales` and `--currencies`.
- Number placeholders in messages are grouped for the active language.
- Unknown paths under a language prefix answer with a real 404; loading boundaries moved to the page routes for that reason.
- `/favicon.ico` is served from the declared icon instead of returning 404.

### Fixed

- Hydration mismatch on the connected-agents page (the origin was read during render).
- The business identifier pattern on onboarding was an invalid regular expression for browsers and skipped client-side validation.
- Money in the metric cards no longer breaks inside the amount on narrow phones.

### Documentation

- Adopt the renamed InzaiQ starter repository identity in project documentation and clone instructions.
- Replace the landing README with a structured English overview and a complete Spanish counterpart.
- Add real interface screenshots of every screen, a visual gallery and a documentation index with language labels.
- Add the languages and currency guide (`docs/i18n.md`, `docs/i18n.es.md`) and update the contract guides for the proxy, message catalogs and English server messages.

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
