# Agent assembly contract
Read README.md, docs/architecture.md, docs/database.md and docs/mcp.md before changing code. Research official installed-version APIs first. Keep core business services shared by UI/API/MCP; never grant an agent SQL access. Derive tenant from verified membership, never a client header. Keep money in integer minor units and resolve prices server-side. Stock/orders/audit/idempotency must commit atomically. No global mutable request/tenant state. Pin dependencies and lockfile. Add meaningful tests including failure paths and telemetry. Run npm run verify; update CHANGELOG.md + README latest changes. Never log secrets/PII or raw payloads. Never claim cloud providers or ChatGPT/Claude tested without actual connection evidence. Demo mode is explicitly local and forbidden in production. Modules must expose documented contracts; do not add placeholders that pretend to work. User-facing text lives in `src/i18n/messages` in both locales (en, es; [guide](docs/i18n.md)); server messages stay English, and every new AppError code needs `errors.codes` entries in both. Default currency and locales come from `src/template.config.ts`.

Before adding a feature, follow [the extension recipe](docs/extending.md) and the `extensions` navigation index in `template.manifest.json`. Define one testable slice, reuse actor/auth/telemetry/database contracts, assign ownership of shared files, and keep service rules separate from HTTP/MCP/UI. The manifest is descriptive; adding an entry does not implement permissions, dependency checks or a module. Use bounded indexed queries and persistent concurrency/idempotency controls suitable for multiple replicas; add infrastructure only for a demonstrated need.

For physical-delivery, digital-goods or SaaS adaptations, read [business model contracts](docs/business-models.md). `src/extensions/contracts.ts` defines provider/outbox interfaces and validated immutable context/money/order references; it does not implement logistics, protected downloads, subscriptions or durable workers. Verify authorization and persisted payment/resource ownership before using a port. Keep `extensionProfiles` status honest and require deployment/load/recovery evidence before capacity or enterprise-readiness claims.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->


## Production-safe agent changes

Read `docs/agent-workflow.md` and `docs/production.md` before changing a deployed installation. Use isolated branches/worktrees, name file ownership when collaborating, inspect installed-version official docs, and deliver a concrete testable change. Use the existing authorized runtime settings for tenant notices/order pauses; code and compiled-brand changes require a new immutable image, never edits inside live containers.

Keep API/MCP and database compatibility with the previous deployment throughout rollout/rollback. Append new migrations only; separate expand, resumable backfill, switch, and later contract. Run reviewed migrations once before new traffic, never per replica. Do not use automatic down migrations or database resets as rollback. Preserve monetary/tenant/idempotency/audit invariants and bounded redacted telemetry.

Before release, use existing verification/E2E gates, review the PR template, update version/CHANGELOG/README, and record exact image digest, schema prerequisites, evidence, rollback and outstanding cloud tests. Keep auth secrets stable, previous immutable assets accessible, readiness schema-aware, and graceful draining tested. Follow the user's existing authorization; preparation does not authorize unrequested provisioning, billing or production deployment. Never claim uninterrupted production updates without infrastructure-specific transition evidence.
