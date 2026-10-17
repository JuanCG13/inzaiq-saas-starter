export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (process.env.DEMO_MODE === 'true' && process.env.NODE_ENV === 'production') throw new Error('DEMO_MODE is forbidden in production');
    const { startTelemetry } = await import('./lib/telemetry-sdk');
    startTelemetry();
  }
}
