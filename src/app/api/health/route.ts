export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Process liveness: database incidents must not cause a restart loop. */
export async function GET() {
  return Response.json({ status: 'ok', version: '0.1.0' }, { headers: { 'cache-control': 'no-store' } });
}
