# Diagnostics and audit

`src/lib/telemetry.ts` owns the signal contract. Pino emits structured JSON to stdout. Optional OTLP exporters start through Next's `src/instrumentation.ts` when `OTEL_EXPORTER_OTLP_ENDPOINT` is configured. There is no mandatory paid telemetry vendor.

Stable signals:
- `api.<feature>.<operation>.completed`: terminal API outcome with request ID, route template, duration and normalized error code.
- `commerce.operation.completed` and `commerce.operation.retry`: domain outcomes and bounded transaction retries.
- `commerce.payment.*.completed`: hosted checkout, resume, provider creation and webhook verification/application. `commerce.payment.retry` identifies known transactional retries; `commerce.payment.reconciliation_required` marks a paid-after-cancelled exception for operator review.
- `mcp.request.completed` and `mcp.tool.<operation>.completed`: connection and tool execution.
- `ui.request.completed`: browser CustomEvent with the same request ID as the API response. Subscribe in the customer RUM adapter if persistent frontend diagnostics are required.
- `ui.settings.viewed`, `ui.settings.submitted`, `ui.settings.saved`, `ui.settings.reloaded`: runtime settings stages/outcomes without field values. Backend settings operations use `commerce.operation.completed`; see [runtime settings](runtime-settings.md).
- `api.readiness.check.completed`: migration/auth-schema and local provider-configuration readiness result. `/api/health` is process liveness and intentionally avoids database probes and feature logging.
- `app.feature.operation.count` and `app.feature.operation.duration`: OpenTelemetry aggregate metrics, operation/outcome labels only.

The browser sends a safe `x-request-id`. This is a documented correlation fallback, not an invented distributed trace: browser spans/OTLP and W3C trace propagation are not yet configured. Server logs include active trace/span IDs when the OTLP SDK is enabled. No automatic SQL instrumentation is installed because database bind values may contain PII.

Attributes are allowlisted before serialization. Bodies, raw headers, cookies, tokens, connection strings, emails, customer contact information and arbitrary exception messages are not emitted. Expected validation failures are rejections; unexpected errors receive safe codes. Tests cover redaction, shared correlation, normalized outcomes and a throwing telemetry sink.

Business audit lives separately in `commerce_audit` and is committed with the mutation. Audit is tenant-scoped and requires `audit:read`; it contains operation/resource identifiers and bounded change metadata, not customer contact details. Restrict audit retention/export to the client's policy.

`settings.updated` records versions, admission state and notice presence, never notice text. Payment status/reconciliation audit rows commit with event deduplication and stock/status changes. Provider raw errors, webhook bodies, checkout URLs, API keys and signature headers must not enter diagnostics. The official Stripe SDK adapter is locally tested; these events are not evidence of an external account transaction.

## Operating procedure

1. Ask for the request ID shown in the error; search structured stdout for `request.id`.
2. Inspect the last successful domain stage and `error.code`. Never paste secrets into diagnostics.
3. Run `npm run doctor`, `npm run typecheck`, and the failing feature test.
4. Use the audit trail to confirm whether a mutation committed. Retry a transaction only with the original idempotency key.
5. For an unknown payment/commit outcome, inspect the persisted attempt and Stripe state before retrying. Resume with the original key within the documented retry window. `PAYMENT_RECONCILIATION_REQUIRED` requires operator review; there is no automatic reconciliation/refund worker. Never double-charge to compensate for a timeout.
6. If readiness returns 503, check reviewed migrations, auth tables, database connectivity and local provider configuration. A healthy liveness response does not mean traffic readiness or prove a live Stripe connection. For a planned release follow [production](production.md); runtime pause only controls new-order admission.

Suggested deployment alerts: API unexpected failure ratio, checkout rejection ratio by code, P95 operation latency, database connectivity, and failed audit writes. Thresholds require a production baseline; no live dashboards or alerts are claimed to be configured. Size OTLP queues and collector retention to the customer's budget; exporters are optional and fail open.
