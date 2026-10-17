import { handleAuthRequest } from '@/lib/auth-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Forward original issuer-inserted discovery paths to the provider; do not rewrite the issuer. */
export const GET = (request: Request) => handleAuthRequest(request, true);
