import type { NextConfig } from "next";
const assetPrefix = process.env.NEXT_ASSET_PREFIX || undefined;
const assetOrigin = assetPrefix ? new URL(assetPrefix).origin : '';
const development = process.env.NODE_ENV !== 'production';
const csp = [
  "default-src 'self'", `script-src 'self' 'unsafe-inline' ${development ? "'unsafe-eval'" : ''} ${assetOrigin}`,
  `style-src 'self' 'unsafe-inline' ${assetOrigin}`, "img-src 'self' data: https:", `font-src 'self' data: ${assetOrigin}`,
  `connect-src 'self' ${development ? 'ws: wss:' : ''}`, "frame-src 'none'", "object-src 'none'",
  "base-uri 'self'", "frame-ancestors 'none'", "form-action 'self'",
].join('; ');
const config: NextConfig = {
  output: 'standalone',
  deploymentId: process.env.DEPLOYMENT_VERSION,
  assetPrefix,
  poweredByHeader: false,
  serverExternalPackages: ['@libsql/client', '@libsql/kysely-libsql', 'pg', 'pino'],
  experimental: { cpus: 2 },
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      { key: 'Content-Security-Policy', value: csp },
    ] }];
  },
};
export default config;
