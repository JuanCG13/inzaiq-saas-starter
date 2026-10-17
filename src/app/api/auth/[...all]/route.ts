import { handleAuthRequest } from '@/lib/auth-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const handler = (request: Request) => handleAuthRequest(request);
export { handler as GET, handler as POST };
