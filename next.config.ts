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
  // Official option (docs: devIndicators). Only the documentation screenshot tour sets this variable, so the
  // development badge stays visible for everyone else. Compile and runtime errors are still reported.
  devIndicators: process.env.HIDE_DEV_INDICATOR === '1' ? false : undefined,
  // Browsers still probe /favicon.ico (for example while the client re-renders a 404 page). Answer with the
  // icon the layout declares instead of a 404 that would show up as a console error.
  async rewrites() { return [{ source: '/favicon.ico', destination: '/icon.svg' }]; },
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
