import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
let sdk: NodeSDK | undefined;
export function startTelemetry() {
  if (sdk || !process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return;
  // Opt-in exporter. No automatic SQL/HTTP body capture; domain spans are explicit.
  sdk = new NodeSDK({ serviceName: process.env.OTEL_SERVICE_NAME ?? 'agentic-commerce',
    traceExporter: new OTLPTraceExporter({ timeoutMillis: 3000 }),
    metricReader: new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter({ timeoutMillis:3000 }), exportIntervalMillis:30000 }),
    instrumentations: [] });
  sdk.start();
}
