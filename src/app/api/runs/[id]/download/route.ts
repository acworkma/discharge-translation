import { NextResponse } from 'next/server';
import { store } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  ctx: { params: { id: string } }
) {
  const url = new URL(req.url);
  const runnerId = url.searchParams.get('runner');
  if (!runnerId) {
    return NextResponse.json({ error: 'runner query param required' }, { status: 400 });
  }
  const run = await store.getRun(ctx.params.id);
  if (!run) return NextResponse.json({ error: 'run not found' }, { status: 404 });
  const result = run.results.find((r) => r.runnerId === runnerId);
  if (!result || !result.outputBlobPath) {
    return NextResponse.json({ error: 'output not available' }, { status: 404 });
  }
  const sasUrl = await store.getDownloadUrl(result.outputBlobPath, {
    ttlMinutes: 10,
    downloadFilename: result.outputFilename,
    contentType: result.outputContentType
  });
  return NextResponse.redirect(sasUrl, 302);
}
